# Windows G 盘安装 Kimi Code CLI

## 方案一：uv + kimi-cli 全部装到 G 盘（推荐）

```powershell
# 1. 设置 uv 安装目录为 G 盘
$env:UV_INSTALL_DIR = "G:\tools\uv"

# 2. 安装 uv（PowerShell）
irm https://astral.sh/uv/install.ps1 | iex

# 3. 把 uv 加入当前会话 PATH
$env:PATH = "$env:PATH;G:\tools\uv"

# 4. 验证 uv 安装
uv --version

# 5. 设置 uv 工具安装目录为 G 盘
$env:UV_TOOL_DIR = "G:\tools\uv-tools"

# 6. 安装 kimi-cli 到 G 盘
uv tool install --tool-dir "$env:UV_TOOL_DIR" kimi-cli

# 7. 把 kimi 加入当前会话 PATH
$env:PATH = "$env:PATH;G:\tools\uv-tools\bin"

# 8. 验证
kimi --version

# 9. 进入项目启动
 cd G:\cloudops-v2
kimi code
```

### 永久加入系统 PATH（避免每次重启后丢失）

```powershell
# 打开系统环境变量设置
rundll32 sysdm.cpl,EditEnvironmentVariables

# 在"用户变量"或"系统变量"的 Path 中添加以下两条：
# G:\tools\uv
# G:\tools\uv-tools\bin
```

---

## 方案二：pip 安装到 G 盘（无需 uv）

如果 uv 安装有问题，直接用 pip：

```powershell
# 1. 确保 Python 3.10+ 已安装，并确认 pip 可用
python --version
pip --version

# 2. 创建 G 盘虚拟环境
python -m venv G:\tools\kimi-venv

# 3. 激活虚拟环境
G:\tools\kimi-venv\Scripts\Activate.ps1

# 4. 安装 kimi-cli
pip install kimi-cli

# 5. 验证
kimi --version

# 6. 进入项目启动
 cd G:\cloudops-v2
kimi code
```

### 永久使用（创建快捷方式脚本）

创建 `G:\tools\start-kimi.ps1`：

```powershell
G:\tools\kimi-venv\Scripts\Activate.ps1
 cd G:\cloudops-v2
kimi code
```

以后双击运行即可。

---

## 方案三：便携版（解压即用）

如果公司网络限制无法在线安装，可以找一台能联网的机器预装好，然后复制到 G 盘：

### 联网机器上准备

```powershell
# 1. 按方案一或二安装好 kimi-cli

# 2. 把整个目录打包
Compress-Archive -Path "G:\tools" -DestinationPath "G:\kimi-tools.zip"
```

### 离线机器上解压

```powershell
# 1. 复制 zip 到离线 Windows，解压到 G 盘
Expand-Archive -Path "G:\kimi-tools.zip" -DestinationPath "G:\"

# 2. 添加 PATH（见方案一的永久配置）
# G:\tools\uv
# G:\tools\uv-tools\bin
```

---

## 验证安装

```powershell
# 检查各组件位置
where.exe uv        # 应输出 G:\tools\uv\uv.exe
where.exe kimi      # 应输出 G:\tools\uv-tools\bin\kimi.exe

# 检查版本
uv --version
kimi --version
```

---

## 项目目录结构建议

```
G:\
├── tools\                    # 工具目录
│   ├── uv\                   # uv 包管理器
│   └── uv-tools\            # uv 安装的工具（含 kimi-cli）
│       └── bin\
│           └── kimi.exe
├── cloudops-v2\             # 代码仓库
│   ├── cmd\server\main.go
│   ├── frontend\
│   └── config\config.yaml
└── start-kimi.ps1           # 启动脚本（可选）
```
