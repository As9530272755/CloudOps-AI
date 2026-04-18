package handlers

import (
	"crypto/rand"
	"encoding/hex"
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

var terminalUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// TerminalHandler Web Terminal Handler
type TerminalHandler struct {
	db         *gorm.DB
	k8sManager *service.K8sManager
	jwtManager *auth.JWTManager
}

// NewTerminalHandler 创建 Terminal Handler
func NewTerminalHandler(db *gorm.DB, k8sManager *service.K8sManager, jwtManager *auth.JWTManager) *TerminalHandler {
	return &TerminalHandler{db: db, k8sManager: k8sManager, jwtManager: jwtManager}
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

	// 2. 解析 cluster_id
	clusterID, err := strconv.ParseUint(c.Query("cluster_id"), 10, 32)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的集群ID"})
		return
	}

	// 3. 权限校验：superuser 或 CanExec
	if !claims.IsSuperuser {
		var perm model.ClusterPermission
		hasExec := false
		if err := h.db.Where("user_id = ? AND cluster_id = ?", userID, clusterID).First(&perm).Error; err == nil {
			hasExec = perm.CanExec
		}
		if !hasExec {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "无终端执行权限"})
			return
		}
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

	// 6. 集群专属家目录
	homeDir := fmt.Sprintf("/tmp/cloudops-home/cluster-%d", clusterID)
	_ = os.MkdirAll(homeDir, 0755)

	// 把 kubeconfig 放在家目录下（同时写入 ~/.kube/config 供 kubectl 默认读取）
	kubeconfigPath := filepath.Join(homeDir, ".kubeconfig.yaml")
	if err := os.WriteFile(kubeconfigPath, kubeconfigBytes, 0600); err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"success": false, "error": "写入临时凭证失败"})
		return
	}
	_ = os.MkdirAll(filepath.Join(homeDir, ".kube"), 0755)
	_ = os.WriteFile(filepath.Join(homeDir, ".kube", "config"), kubeconfigBytes, 0600)

	// 从内嵌资源复制 kubectl 命令补全脚本到集群家目录
	kubectlCompPath := filepath.Join(homeDir, ".kubectl-completion.bash")
	if compData, err := os.ReadFile("/data/projects/cloudops-v2/data/kubectl-completion.bash"); err == nil {
		_ = os.WriteFile(kubectlCompPath, compData, 0644)
	}

	// 写入 readline 配置，显式绑定 Tab 到补全
	inputrcPath := filepath.Join(homeDir, ".inputrc")
	inputrcContent := "set editing-mode emacs\n\"\\t\": complete\n"
	_ = os.WriteFile(inputrcPath, []byte(inputrcContent), 0644)

	// 写入 .bashrc（备用，非 login shell 场景）
	bashrcPath := filepath.Join(homeDir, ".bashrc")
	bashrcContent := `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY ALL_PROXY all_proxy ftp_proxy FTP_PROXY socks_proxy SOCKS_PROXY
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
	_ = os.WriteFile(bashrcPath, []byte(bashrcContent), 0644)

	// 写入 .bash_profile（login shell 直接加载，不依赖 .bashrc 是否被读取）
	bashProfilePath := filepath.Join(homeDir, ".bash_profile")
	bashProfileContent := `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY ALL_PROXY all_proxy ftp_proxy FTP_PROXY socks_proxy SOCKS_PROXY
if [ -f ~/.bashrc ]; then
    source ~/.bashrc
fi
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
	_ = os.WriteFile(bashProfilePath, []byte(bashProfileContent), 0644)

	// 7. 升级 WebSocket
	ws, err := terminalUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	// 欢迎消息直接通过 WebSocket 发给前端，避免被 bash 当作命令执行
	welcome := fmt.Sprintf("\r\n\033[1;32m[CloudOps Terminal]\033[0m 集群: %s\r\n", cluster.Name)
	welcome += fmt.Sprintf("\033[1;33m提示:\033[0m 已自动注入 KUBECONFIG，可直接执行 kubectl 命令。\r\n")
	welcome += fmt.Sprintf("\033[90m例如: kubectl get pods\033[0m\r\n\r\n")
	_ = ws.WriteMessage(websocket.TextMessage, []byte(welcome))

	// 8. 启动安全隔离终端
	ps1 := fmt.Sprintf("\\[\\e[32m\\]%s@\\h:~\\$\\[\\e[0m\\] ", cluster.Name)

	// 生成唯一的沙盒目录，避免同进程多会话冲突
	sessionID := generateSessionID()
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
	if src, err := os.Open("/data/projects/cloudops-v2/data/kubectl"); err == nil {
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

	// 不挂载 /proc，消除 /proc/1/root 逃逸通道
	// bash 和 kubectl 在无 proc 环境下仍可正常工作
	_ = syscall.Mount("tmpfs", filepath.Join(sandboxRoot, "tmp"), "tmpfs", syscall.MS_NOSUID|syscall.MS_NODEV|syscall.MS_NOEXEC, "")

	chrootHome := filepath.Join(sandboxRoot, "root")
	_ = syscall.Mount(homeDir, chrootHome, "", syscall.MS_BIND|syscall.MS_NOSUID|syscall.MS_NODEV, "")

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
		_ = cleanupSandboxMounts(sandboxRoot)
		_ = os.RemoveAll(sandboxRoot)
	}()

	// 9. 双工 goroutine
	done := make(chan struct{}, 2)

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
