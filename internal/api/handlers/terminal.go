package handlers

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/cloudops/platform/internal/model"
	"github.com/cloudops/platform/internal/pkg/auth"
	"github.com/cloudops/platform/internal/service"
	"github.com/creack/pty"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"gorm.io/gorm"
)

// getDataDir 返回 CloudOps data 目录路径
// 优先级：1. CLOUDOPS_DATA_DIR 环境变量 2. 可执行文件同级 data/ 目录 3. 开发环境默认路径
func getDataDir() string {
	if dir := os.Getenv("CLOUDOPS_DATA_DIR"); dir != "" {
		return dir
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Join(filepath.Dir(exe), "data")
		if _, err := os.Stat(dir); err == nil {
			return dir
		}
	}
	// fallback to development path
	return "/data/projects/cloudops-v2/data"
}

// sanitizeClusterName 将集群名称安全化为合法的目录名
func sanitizeClusterName(name string) string {
	name = strings.ReplaceAll(name, "/", "-")
	name = strings.ReplaceAll(name, "\\", "-")
	name = strings.ReplaceAll(name, "\x00", "")
	name = strings.TrimSpace(name)
	if name == "" {
		return "unknown"
	}
	return name
}

// getUserHomeDir 返回指定用户在指定集群的终端家目录
func getUserHomeDir(clusterName string, userID uint) string {
	safeName := sanitizeClusterName(clusterName)
	return filepath.Join("/tmp/cloudops-home", safeName, strconv.Itoa(int(userID)))
}

// getClusterSharedDir 返回指定集群的共享目录
func getClusterSharedDir(clusterName string) string {
	safeName := sanitizeClusterName(clusterName)
	return filepath.Join("/tmp/cloudops-home", safeName, ".shared")
}

// resolveSafePath 解析并校验路径，防止目录遍历攻击
// 用户输入的是沙盒内路径（如 /root/xxx），沙盒内 /root 映射到用户家目录
func resolveSafePath(baseDir string, targetPath string) (string, error) {
	// 去掉 /root 前缀（沙盒内 /root 就是家目录根）
	relPath := strings.TrimPrefix(targetPath, "/root")
	// 如果路径不以 /root 开头，保留原始输入（相对路径处理）
	if relPath == targetPath {
		relPath = targetPath
	}
	// 去掉开头的 / 避免 filepath.Join 产生意外行为
	relPath = strings.TrimPrefix(relPath, "/")

	absBase, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	target := filepath.Join(absBase, relPath)
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	// 确保目标路径以 baseDir 为前缀
	if !strings.HasPrefix(absTarget, absBase+string(filepath.Separator)) && absTarget != absBase {
		return "", fmt.Errorf("path traversal detected")
	}
	return absTarget, nil
}

var terminalUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// TerminalHandler Web Terminal Handler
type TerminalHandler struct {
	db          *gorm.DB
	k8sManager  *service.K8sManager
	jwtManager  *auth.JWTManager
	rbacService *service.RBACService
}

// NewTerminalHandler 创建 Terminal Handler
func NewTerminalHandler(db *gorm.DB, k8sManager *service.K8sManager, jwtManager *auth.JWTManager) *TerminalHandler {
	return &TerminalHandler{db: db, k8sManager: k8sManager, jwtManager: jwtManager, rbacService: service.NewRBACService(db)}
}

// logAudit 写入终端审计日志（异步，失败不影响终端使用）
func (h *TerminalHandler) logAudit(userID uint, username string, clusterID uint, clusterName string, sessionID string, actionType string, command string, workingDir string, ip string) {
	log := model.TerminalAuditLog{
		UserID:      userID,
		Username:    username,
		ClusterID:   clusterID,
		ClusterName: clusterName,
		SessionID:   sessionID,
		ActionType:  actionType,
		Command:     command,
		WorkingDir:  workingDir,
		IPAddress:   ip,
	}
	_ = h.db.Create(&log).Error
}

// Terminal 建立 WebSocket 终端连接
// GET /ws/terminal?cluster_id=1&token=xxx
func (h *TerminalHandler) Terminal(c *gin.Context) {
	// 1. 认证
	tokenStr := c.Query("token")
	if tokenStr == "" {
		tokenStr = c.GetHeader("Authorization")
		if len(tokenStr) > 7 && tokenStr[:7] == "Bearer " {
			tokenStr = tokenStr[7:]
		}
	}
	claims, err := h.jwtManager.ValidateToken(tokenStr)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "未认证"})
		return
	}
	userID := claims.UserID
	username := claims.Username

	// 2. 解析 cluster_id
	clusterID, err := strconv.ParseUint(c.Query("cluster_id"), 10, 32)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的集群ID"})
		return
	}

	// 3. 权限校验：NS 级权限检查
	namespace := c.Query("namespace")
	if namespace == "" {
		namespace = "default"
	}

	effectiveRole, err := h.rbacService.GetEffectiveRole(c.Request.Context(), userID, uint(clusterID), namespace)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "您无权访问该命名空间的终端"})
		return
	}

	if !roleHasPermission(effectiveRole.Role, "terminal", "use") {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"success": false,
			"error":   "您的角色 " + effectiveRole.Role.DisplayName + " 没有终端使用权限",
		})
		return
	}

	// 4. 获取集群信息及健康状态
	var cluster model.Cluster
	if err := h.db.Where("id = ?", clusterID).First(&cluster).Error; err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "error": "集群不存在"})
		return
	}
	var clusterMeta model.ClusterMetadata
	if err := h.db.Where("cluster_id = ?", clusterID).First(&clusterMeta).Error; err == nil {
		if clusterMeta.HealthStatus != "healthy" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": fmt.Sprintf("集群当前状态为 %s，无法建立终端连接", clusterMeta.HealthStatus)})
			return
		}
	}

	// 5. 获取 kubeconfig 内容
	kubeconfigBytes, err := h.k8sManager.GetClusterKubeconfigContent(uint(clusterID))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"success": false, "error": "获取集群凭证失败: " + err.Error()})
		return
	}

	// 6. 用户专属家目录（按集群名称 + 用户ID隔离）
	userHomeDir := getUserHomeDir(cluster.Name, userID)
	_ = os.MkdirAll(userHomeDir, 0755)

	// 把 kubeconfig 放在家目录下
	kubeconfigPath := filepath.Join(userHomeDir, ".kubeconfig.yaml")
	if err := os.WriteFile(kubeconfigPath, kubeconfigBytes, 0600); err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"success": false, "error": "写入临时凭证失败"})
		return
	}
	_ = os.MkdirAll(filepath.Join(userHomeDir, ".kube"), 0755)
	_ = os.WriteFile(filepath.Join(userHomeDir, ".kube", "config"), kubeconfigBytes, 0600)

	// 从内嵌资源复制 kubectl 命令补全脚本到集群家目录
	kubectlCompPath := filepath.Join(userHomeDir, ".kubectl-completion.bash")
	dataDir := getDataDir()
	if compData, err := os.ReadFile(filepath.Join(dataDir, "kubectl-completion.bash")); err == nil {
		_ = os.WriteFile(kubectlCompPath, compData, 0644)
	}

	// 写入 readline 配置，显式绑定 Tab 到补全
	inputrcPath := filepath.Join(userHomeDir, ".inputrc")
	inputrcContent := "set editing-mode emacs\n\"\\t\": complete\n"
	_ = os.WriteFile(inputrcPath, []byte(inputrcContent), 0644)

	// 创建审计日志文件（空文件，bash DEBUG trap 会追加写入）
	auditLogPath := filepath.Join(userHomeDir, ".audit.log")
	_ = os.WriteFile(auditLogPath, []byte{}, 0644)

	// 创建集群共享目录
	sharedDir := getClusterSharedDir(cluster.Name)
	_ = os.MkdirAll(sharedDir, 0777)

	// 判断是否为管理员
	isAdmin := claims.IsSuperuser

	// 写入 .bashrc（备用，非 login shell 场景）
	bashrcPath := filepath.Join(userHomeDir, ".bashrc")
	bashrcContent := buildBashRC(namespace, false, isAdmin)
	_ = os.WriteFile(bashrcPath, []byte(bashrcContent), 0644)

	// 写入 .bash_profile（login shell 直接加载）
	bashProfilePath := filepath.Join(userHomeDir, ".bash_profile")
	bashProfileContent := buildBashRC(namespace, true, isAdmin)
	_ = os.WriteFile(bashProfilePath, []byte(bashProfileContent), 0644)

	// 7. 升级 WebSocket
	ws, err := terminalUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	// 生成会话ID
	sessionID := generateSessionID()
	clientIP := c.ClientIP()

	// 记录 login 审计日志
	h.logAudit(userID, username, uint(clusterID), cluster.Name, sessionID, "login", "", "", clientIP)

	// 欢迎消息直接通过 WebSocket 发给前端，避免被 bash 当作命令执行
	welcome := fmt.Sprintf("\r\n\033[1;32m[CloudOps Terminal]\033[0m 集群: %s\r\n", cluster.Name)
	welcome += fmt.Sprintf("\033[1;33m提示:\033[0m 已自动注入 KUBECONFIG，可直接执行 kubectl 命令。\r\n")
	welcome += fmt.Sprintf("\033[90m例如: kubectl get pods\033[0m\r\n\r\n")
	_ = ws.WriteMessage(websocket.TextMessage, []byte(welcome))

	// 8. 启动安全隔离终端
	ps1 := fmt.Sprintf("\\[\\e[32m\\]%s@\\h:~\\$\\[\\e[0m\\] ", cluster.Name)

	// 生成唯一的沙盒目录，避免同进程多会话冲突
	sandboxRoot := fmt.Sprintf("/var/lib/cloudops-sandbox/cluster-%d-%s", clusterID, sessionID)
	_ = os.RemoveAll(sandboxRoot)
	_ = os.MkdirAll(sandboxRoot, 0755)

	// 创建必要的目录结构
	for _, d := range []string{"bin", "sbin", "usr", "usr/local", "usr/local/bin", "lib", "lib64", "etc", "dev", "dev/pts", "tmp", "root", "proc"} {
		_ = os.MkdirAll(filepath.Join(sandboxRoot, d), 0755)
	}

	// 以只读方式 bind-mount 系统目录到沙盒
	for _, src := range []string{"/bin", "/sbin", "/usr", "/lib", "/lib64", "/etc"} {
		dst := filepath.Join(sandboxRoot, strings.TrimPrefix(src, "/"))
		if _, serr := os.Stat(src); os.IsNotExist(serr) {
			continue
		}
		_ = syscall.Mount(src, dst, "", syscall.MS_BIND|syscall.MS_RDONLY|syscall.MS_NOSUID|syscall.MS_NODEV, "")
	}

	// 挂载 /proc（CLONE_NEWPID 下 PID 1 是 bash，/proc/1/root 不会逃逸到宿主机）
	_ = syscall.Mount("proc", filepath.Join(sandboxRoot, "proc"), "proc", syscall.MS_NOSUID|syscall.MS_NOEXEC|syscall.MS_NODEV, "")

	// 创建 /dev/fd 符号链接（kubectl completion 使用进程替换 <(...) 需要它）
	_ = os.Symlink("/proc/self/fd", filepath.Join(sandboxRoot, "dev/fd"))

	// 复制 kubectl 到 chroot 内（避免 bind mount 文件需要目标文件预先存在的限制）
	if src, err := os.Open(filepath.Join(dataDir, "kubectl")); err == nil {
		defer src.Close()
		dstPath := filepath.Join(sandboxRoot, "usr/local/bin/kubectl")
		if dst, err := os.Create(dstPath); err == nil {
			_, _ = io.Copy(dst, src)
			dst.Close()
			_ = os.Chmod(dstPath, 0755)
		}
	}

	// 安全：不再使用 mknod 创建设备（防止用户创建设备节点直接读写宿主机磁盘）
	// 改为从宿主机 bind-mount 已知安全的字符设备
	// 注意：bind mount 文件时，目标文件必须预先存在
	safeDevices := []struct{ src, name string }{
		{"/dev/null", "null"},
		{"/dev/zero", "zero"},
		{"/dev/random", "random"},
		{"/dev/urandom", "urandom"},
		{"/dev/tty", "tty"},
	}
	for _, dev := range safeDevices {
		dstPath := filepath.Join(sandboxRoot, "dev", dev.name)
		_ = os.WriteFile(dstPath, []byte{}, 0644)
		_ = syscall.Mount(dev.src, dstPath, "", syscall.MS_BIND|syscall.MS_RDONLY, "")
	}
	_ = syscall.Mount("/dev/pts", filepath.Join(sandboxRoot, "dev/pts"), "", syscall.MS_BIND|syscall.MS_NOSUID|syscall.MS_NODEV|syscall.MS_NOEXEC, "")

	// 挂载 tmpfs 到 /tmp
	_ = syscall.Mount("tmpfs", filepath.Join(sandboxRoot, "tmp"), "tmpfs", syscall.MS_NOSUID|syscall.MS_NODEV|syscall.MS_NOEXEC, "")

	// 挂载用户家目录到沙盒 /root
	chrootHome := filepath.Join(sandboxRoot, "root")
	_ = syscall.Mount(userHomeDir, chrootHome, "", syscall.MS_BIND|syscall.MS_NOSUID|syscall.MS_NODEV, "")

	// 挂载集群共享目录到沙盒 /root/共享
	sandboxSharedDir := filepath.Join(sandboxRoot, "root", "共享")
	_ = os.MkdirAll(sandboxSharedDir, 0755)
	_ = syscall.Mount(sharedDir, sandboxSharedDir, "", syscall.MS_BIND|syscall.MS_NOSUID|syscall.MS_NODEV, "")

	cmd := exec.Command("/bin/bash", "-l")
	cmd.Dir = "/root"
	// 过滤掉代理环境变量（沙盒内 127.0.0.1 不是宿主机的代理地址）
	env := make([]string, 0, len(os.Environ()))
	for _, e := range os.Environ() {
		lower := strings.ToLower(e)
		if strings.HasPrefix(lower, "http_proxy=") || strings.HasPrefix(lower, "https_proxy=") ||
			strings.HasPrefix(lower, "all_proxy=") || strings.HasPrefix(lower, "no_proxy=") ||
			strings.HasPrefix(lower, "ftp_proxy=") || strings.HasPrefix(lower, "socks_proxy=") {
			continue
		}
		env = append(env, e)
	}
	cmd.Env = append(env,
		"TERM=xterm-256color",
		"KUBECONFIG=/root/.kubeconfig.yaml",
		"HOME=/root",
		"INPUTRC=/root/.inputrc",
		"PS1="+ps1,
	)
	// 关键安全加固：使用 Linux Namespace 隔离
	// CLONE_NEWNS  : 新的 Mount Namespace，防止影响宿主机挂载表
	// CLONE_NEWPID : 新的 PID Namespace，隔离进程视图
	// CLONE_NEWUSER: 新的 User Namespace，限制特权（即使映射为root，在宿主机视角下也是普通用户）
	// CLONE_NEWIPC : 新的 IPC Namespace，隔离信号量和共享内存
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Chroot:  sandboxRoot,
		Setsid:  true,
		Setctty: true,
		Cloneflags: syscall.CLONE_NEWNS | syscall.CLONE_NEWPID | syscall.CLONE_NEWUSER | syscall.CLONE_NEWIPC,
		UidMappings: []syscall.SysProcIDMap{
			{ContainerID: 0, HostID: os.Getuid(), Size: 1},
		},
		GidMappings: []syscall.SysProcIDMap{
			{ContainerID: 0, HostID: os.Getgid(), Size: 1},
		},
	}
	ptmx, err := pty.Start(cmd)
	if err != nil {
		_ = cleanupSandboxMounts(sandboxRoot)
		_ = os.RemoveAll(sandboxRoot)
		_ = ws.WriteMessage(websocket.TextMessage, []byte("启动终端失败: "+err.Error()+"\r\n"))
		return
	}
	activeProc := cmd.Process

	// done channel 用于通知 goroutine 退出
	done := make(chan struct{}, 3)

	defer func() {
		_ = ptmx.Close()
		if activeProc != nil {
			_ = activeProc.Signal(syscall.SIGTERM)
		}
		time.Sleep(100 * time.Millisecond)
		if activeProc != nil {
			_ = activeProc.Kill()
			_ = cmd.Wait()
		}
		// 读取剩余审计日志
		h.flushAuditLog(userHomeDir, userID, username, uint(clusterID), cluster.Name, sessionID, clientIP)
		// 记录 logout
		h.logAudit(userID, username, uint(clusterID), cluster.Name, sessionID, "logout", "", "", clientIP)
		// 删除审计日志文件
		_ = os.Remove(auditLogPath)
		// 通知 goroutine 退出
		for i := 0; i < 3; i++ {
			select {
			case done <- struct{}{}:
			default:
			}
		}
		_ = cleanupSandboxMounts(sandboxRoot)
		_ = os.RemoveAll(sandboxRoot)
	}()

	// 启动审计日志轮询 goroutine
	go h.pollAuditLog(userHomeDir, userID, username, uint(clusterID), cluster.Name, sessionID, clientIP, done)

	// 9. 双工 goroutine

	// WS -> PTY
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, p, err := ws.ReadMessage()
			if err != nil {
				return
			}
			if msgType != websocket.TextMessage {
				continue
			}
			// resize 消息
			if len(p) > 0 && p[0] == '{' {
				cols, rows := parseResize(string(p))
				if cols > 0 && rows > 0 {
					_ = pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
					continue
				}
			}
			// Ctrl+C 手动补发 SIGINT，防止沙盒/PTY 信号投递异常
			if len(p) == 1 && p[0] == 3 && activeProc != nil {
				_ = activeProc.Signal(syscall.SIGINT)
			}
			_, _ = ptmx.Write(p)
		}
	}()

	// PTY -> WS
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 1024)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				return
			}
			if err := ws.WriteMessage(websocket.TextMessage, buf[:n]); err != nil {
				return
			}
		}
	}()

	<-done
	<-done
}

// buildBashRC 生成 bash 配置文件内容
func buildBashRC(namespace string, isLogin bool, isAdmin bool) string {
	base := `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY ALL_PROXY all_proxy ftp_proxy FTP_PROXY socks_proxy SOCKS_PROXY
shopt -s progcomp
set -o emacs
bind '"\t": complete'
if [ -f /etc/bash_completion ] && ! shopt -oq posix; then
    source /etc/bash_completion
fi
if [ -f ~/.kubectl-completion.bash ]; then
    source ~/.kubectl-completion.bash
fi
bind 'set show-all-if-ambiguous on'
bind 'set show-all-if-unmodified on'
alias ls='ls --color=auto'
alias ll='ls -alF --color=auto'
alias grep='grep --color=auto'
if command -v dircolors >/dev/null 2>&1; then
    eval "$(dircolors -b)" 2>/dev/null || true
fi
export PATH="/usr/local/bin:$PATH"
export BASHRC_LOADED=1
`
	// 设置默认 kubectl namespace
	nsScript := fmt.Sprintf("\nkubectl config set-context --current --namespace=%s 2>/dev/null || true\n", namespace)

	// 共享目录删除拦截（仅普通用户）
	var protectScript string
	if !isAdmin {
		protectScript = `
# ==================== 共享目录删除保护 ====================
__protect_shared_dir() {
    local cmd_name="$1"
    shift
    local target
    for target in "$@"; do
        case "$target" in
            -*) continue ;;
        esac
        local abs_target
        if [[ "$target" == /* ]]; then
            abs_target="$target"
        else
            abs_target="$PWD/$target"
        fi
        if [[ "$abs_target" == "/root/共享"* ]]; then
            echo "$cmd_name: 无法操作共享目录中的文件（仅管理员可操作）" >&2
            return 1
        fi
    done
    return 0
}
rm() {
    __protect_shared_dir "rm" "$@" || return 1
    command rm "$@"
}
rmdir() {
    __protect_shared_dir "rmdir" "$@" || return 1
    command rmdir "$@"
}
# ==================== 保护结束 ====================
`
	}

	// 审计 DEBUG trap（追加到末尾，确保在 bash 初始化完成后启用）
	auditScript := `
# ==================== CloudOps 命令审计 ====================
__AUDIT_LOCK=0
__audit_record() {
    local cmd="$BASH_COMMAND"
    case "$cmd" in
        "[AUDIT]"*|"trap "*|"unset "*|"shopt "*|"bind "*|"alias "*|"eval "*|"export "*|"source "*|". "*|"__audit_record"*)
            return
            ;;
    esac
    if [[ $__AUDIT_LOCK -eq 0 ]]; then
        __AUDIT_LOCK=1
        printf "[AUDIT]|%s|%s|%s\n" "$(date +%s.%N)" "$PWD" "$cmd" >> /root/.audit.log 2>/dev/null
        __AUDIT_LOCK=0
    fi
}
trap '__audit_record' DEBUG
unset __AUDIT_LOCK
# ==================== 审计结束 ====================
`

	if isLogin {
		return base + nsScript + protectScript + auditScript
	}
	return base + nsScript + protectScript + auditScript
}

// pollAuditLog 轮询审计日志文件，将新命令写入数据库
func (h *TerminalHandler) pollAuditLog(userHomeDir string, userID uint, username string, clusterID uint, clusterName string, sessionID string, ip string, done chan struct{}) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	auditFilePath := filepath.Join(userHomeDir, ".audit.log")
	var lastOffset int64 = 0

	for {
		select {
		case <-ticker.C:
			f, err := os.Open(auditFilePath)
			if err != nil {
				continue
			}
			_, _ = f.Seek(lastOffset, 0)
			scanner := bufio.NewScanner(f)
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "[AUDIT]|") {
					parts := strings.SplitN(line, "|", 4)
					if len(parts) == 4 {
						cmd := parts[3]
						if len(cmd) > 4096 {
							cmd = cmd[:4096]
						}
						h.logAudit(userID, username, clusterID, clusterName, sessionID, "command", cmd, parts[2], ip)
					}
				}
			}
			lastOffset, _ = f.Seek(0, io.SeekCurrent)
			f.Close()
		case <-done:
			return
		}
	}
}

// flushAuditLog 连接断开时读取剩余未处理的审计记录
func (h *TerminalHandler) flushAuditLog(userHomeDir string, userID uint, username string, clusterID uint, clusterName string, sessionID string, ip string) {
	auditFilePath := filepath.Join(userHomeDir, ".audit.log")
	f, err := os.Open(auditFilePath)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "[AUDIT]|") {
			parts := strings.SplitN(line, "|", 4)
			if len(parts) == 4 {
				cmd := parts[3]
				if len(cmd) > 4096 {
					cmd = cmd[:4096]
				}
				h.logAudit(userID, username, clusterID, clusterName, sessionID, "command", cmd, parts[2], ip)
			}
		}
	}
}

// UploadFile 上传文件到用户终端家目录
// POST /api/v1/terminal/upload
func (h *TerminalHandler) UploadFile(c *gin.Context) {
	// 1. 认证
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "未认证"})
		return
	}
	userID := userIDVal.(uint)

	// 2. 获取参数
	clusterIDStr := c.PostForm("cluster_id")
	clusterID, err := strconv.ParseUint(clusterIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的集群ID"})
		return
	}
	targetPath := c.PostForm("path")
	if targetPath == "" {
		targetPath = "/root/"
	}

	// 3. 获取集群信息
	var cluster model.Cluster
	if err := h.db.Where("id = ?", clusterID).First(&cluster).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "集群不存在"})
		return
	}

	// 4. 计算用户家目录
	userHomeDir := getUserHomeDir(cluster.Name, userID)

	// 5. 解析目标路径并校验 path traversal
	absTarget, err := resolveSafePath(userHomeDir, targetPath)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "非法路径"})
		return
	}

	// 6. 获取上传文件
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "请选择要上传的文件"})
		return
	}

	// 确保目标目录存在
	_ = os.MkdirAll(absTarget, 0755)

	// 保存文件
	dst := filepath.Join(absTarget, file.Filename)
	if err := c.SaveUploadedFile(file, dst); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "保存文件失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"path": dst}})
}

// DownloadFile 从用户终端家目录下载文件
// GET /api/v1/terminal/download?cluster_id=x&path=xxx
func (h *TerminalHandler) DownloadFile(c *gin.Context) {
	// 1. 认证
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "未认证"})
		return
	}
	userID := userIDVal.(uint)

	// 2. 获取参数
	clusterID, err := strconv.ParseUint(c.Query("cluster_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的集群ID"})
		return
	}
	targetPath := c.Query("path")
	if targetPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "请指定文件路径"})
		return
	}

	// 3. 获取集群信息
	var cluster model.Cluster
	if err := h.db.Where("id = ?", clusterID).First(&cluster).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "集群不存在"})
		return
	}

	// 4. 计算用户家目录
	userHomeDir := getUserHomeDir(cluster.Name, userID)

	// 5. 解析目标路径并校验 path traversal
	absTarget, err := resolveSafePath(userHomeDir, targetPath)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "非法路径"})
		return
	}

	// 6. 检查文件存在且不是目录
	info, err := os.Stat(absTarget)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "文件不存在"})
		return
	}
	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "不能下载目录"})
		return
	}

	// 7. 返回文件
	c.Header("Content-Disposition", "attachment; filename="+filepath.Base(absTarget))
	c.File(absTarget)
}

// ListAuditLogs 查询终端审计日志
// GET /api/v1/terminal/audit-logs
func (h *TerminalHandler) ListAuditLogs(c *gin.Context) {
	// 1. 认证
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "未认证"})
		return
	}
	userID := userIDVal.(uint)
	isSuperuserVal, _ := c.Get("is_superuser")
	isSuperuser := false
	if b, ok := isSuperuserVal.(bool); ok {
		isSuperuser = b
	}

	// 2. 解析查询参数
	clusterID := c.Query("cluster_id")
	actionType := c.Query("action_type")
	sessionID := c.Query("session_id")
	command := c.Query("command")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}

	// 3. 构建查询
	db := h.db.Model(&model.TerminalAuditLog{})

	// 普通用户只能查看自己的审计日志
	if !isSuperuser {
		db = db.Where("user_id = ?", userID)
	}

	if clusterID != "" {
		db = db.Where("cluster_id = ?", clusterID)
	}
	if actionType != "" {
		db = db.Where("action_type = ?", actionType)
	}
	if sessionID != "" {
		db = db.Where("session_id = ?", sessionID)
	}
	if command != "" {
		db = db.Where("command LIKE ?", "%"+command+"%")
	}

	// 4. 分页查询
	var total int64
	db.Count(&total)

	var logs []model.TerminalAuditLog
	db.Order("created_at DESC").Offset((page - 1) * limit).Limit(limit).Find(&logs)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"list":  logs,
			"total": total,
			"page":  page,
			"limit": limit,
		},
	})
}

// ListFiles 列出用户终端家目录下的文件和目录
// GET /api/v1/terminal/files?cluster_id=x&path=/root/
type fileItem struct {
	Name    string    `json:"name"`
	Type    string    `json:"type"` // file | dir
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
}

func (h *TerminalHandler) ListFiles(c *gin.Context) {
	// 1. 认证
	userIDVal, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "未认证"})
		return
	}
	userID := userIDVal.(uint)

	// 2. 获取参数
	clusterID, err := strconv.ParseUint(c.Query("cluster_id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的集群ID"})
		return
	}
	targetPath := c.Query("path")
	if targetPath == "" {
		targetPath = "/root/"
	}

	// 3. 获取集群信息
	var cluster model.Cluster
	if err := h.db.Where("id = ?", clusterID).First(&cluster).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "集群不存在"})
		return
	}

	// 4. 计算用户家目录
	userHomeDir := getUserHomeDir(cluster.Name, userID)

	// 5. 解析目标路径并校验 path traversal
	absTarget, err := resolveSafePath(userHomeDir, targetPath)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "非法路径"})
		return
	}

	// 6. 读取目录内容
	entries, err := os.ReadDir(absTarget)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "读取目录失败: " + err.Error()})
		return
	}

	items := make([]fileItem, 0, len(entries))
	for _, entry := range entries {
		// 隐藏审计日志文件
		if entry.Name() == ".audit.log" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		itemType := "file"
		if entry.IsDir() {
			itemType = "dir"
		}
		items = append(items, fileItem{
			Name:    entry.Name(),
			Type:    itemType,
			Size:    info.Size(),
			ModTime: info.ModTime(),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"path":  targetPath,
			"items": items,
		},
	})
}

// generateSessionID 生成唯一的会话标识符
func generateSessionID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%d-%s", time.Now().UnixNano(), hex.EncodeToString(b))
}

// cleanupSandboxMounts 清理沙盒挂载点
func cleanupSandboxMounts(sandboxRoot string) error {
	time.Sleep(200 * time.Millisecond)

	// 按正确的顺序卸载：先卸载子挂载点，再卸载父挂载点
	mounts := []string{
		filepath.Join(sandboxRoot, "root", "共享"),      // 共享目录 bind mount
		filepath.Join(sandboxRoot, "root"),              // homeDir bind mount
		filepath.Join(sandboxRoot, "dev/pts"),
		filepath.Join(sandboxRoot, "dev/null"),
		filepath.Join(sandboxRoot, "dev/zero"),
		filepath.Join(sandboxRoot, "dev/random"),
		filepath.Join(sandboxRoot, "dev/urandom"),
		filepath.Join(sandboxRoot, "dev/tty"),
		filepath.Join(sandboxRoot, "proc"),
		filepath.Join(sandboxRoot, "tmp"),
		filepath.Join(sandboxRoot, "etc"),
		filepath.Join(sandboxRoot, "lib64"),
		filepath.Join(sandboxRoot, "lib"),
		filepath.Join(sandboxRoot, "usr"),
		filepath.Join(sandboxRoot, "sbin"),
		filepath.Join(sandboxRoot, "bin"),
	}

	for _, m := range mounts {
		_ = syscall.Unmount(m, syscall.MNT_DETACH)
	}
	return nil
}

func roleHasPermission(role *model.Role, resource, action string) bool {
	if role == nil {
		return false
	}
	if role.Scope == "platform" || role.Scope == "cluster" {
		return true
	}
	perms := parsePermissionsData(role.PermissionsData)
	target := resource + ":" + action
	for _, p := range perms {
		if p == target || p == "*:*" || p == resource+":*" {
			return true
		}
	}
	return false
}

func parsePermissionsData(data string) []string {
	if data == "" {
		return []string{}
	}
	var perms []string
	if err := json.Unmarshal([]byte(data), &perms); err != nil {
		return []string{}
	}
	return perms
}

func parseResize(s string) (cols, rows int) {
	scols := extractInt(s, `"cols"`)
	srows := extractInt(s, `"rows"`)
	return scols, srows
}

func extractInt(s, key string) int {
	idx := strings.Index(s, key)
	if idx == -1 {
		return 0
	}
	rest := s[idx+len(key):]
	for i := 0; i < len(rest); i++ {
		if rest[i] == ':' {
			rest = rest[i+1:]
			break
		}
	}
	var val int
	fmt.Sscanf(rest, "%d", &val)
	return val
}
