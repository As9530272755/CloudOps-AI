# Windows 安装权限问题修复

## 问题
```
对路径".local"的访问被拒绝。
```

安装脚本默认写入 `C:\Users\Admin\.local`，当前用户无权限。

---

## 方案一：指定安装到 G 盘（推荐）

```powershell
# 1. 设置环境变量，强制 uv 安装到 G 盘
$env:UV_INSTALL_DIR = "G:\tools\uv"

# 2. 重新运行安装
irm https://code.kimi.com/install.ps1 | iex

# 3. 手动添加 PATH（当前会话）
$env:PATH = "$env:PATH;G:\tools\uv"

# 4. 验证 uv
uv --version

# 5. 安装 kimi-cli（也装到 G 盘）
uv tool install --tool-dir "G:\tools\uv-tools" kimi-cli

# 6. 添加 kimi 到 PATH
$env:PATH = "$env:PATH;G:\tools\uv-tools\bin"

# 7. 验证 kimi
kimi --version
```

---

## 方案二：以管理员身份运行

1. 右键点击 **PowerShell** → **以管理员身份运行**
2. 再执行：
```powershell
irm https://code.kimi.com/install.ps1 | iex
```

> 注意：管理员安装后，uv 会在 `C:\Users\Admin\.local\bin`，后续 VS Code 中配置路径时要注意。

---

## 方案三：完全手动安装（绕过脚本）

如果脚本始终报错，手动下载：

```powershell
# 1. 创建目录
mkdir "G:\tools\kimi-cli\bin" -Force

# 2. 下载 uv 二进制（Windows x64）
curl -L -o "G:\tools\uv.exe" "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.exe"

# 3. 下载 kimi-cli 二进制
curl -L -o "G:\tools\kimi-cli\bin\kimi.exe" "https://cdn.kimi.com/binaries/kimi-cli/latest/windows-amd64/kimi.exe"

# 4. 添加 PATH
$env:PATH = "$env:PATH;G:\tools;G:\tools\kimi-cli\bin"

# 5. 验证
uv --version
kimi --version
```

---

## 方案四：pip 安装（最简单）

如果已有 Python：

```powershell
# 创建 G 盘虚拟环境
python -m venv G:\tools\kimi-venv

# 激活
G:\tools\kimi-venv\Scripts\Activate.ps1

# 安装
pip install kimi-cli

# 验证
kimi --version
```

---

## 永久配置 PATH

上述方案中，每次新开 Terminal 都要重新设置 PATH。永久配置：

```powershell
# 打开系统环境变量
rundll32 sysdm.cpl,EditEnvironmentVariables

# 在用户变量的 Path 中添加（根据你的方案选择）：
# 方案一/三：G:\tools\uv;G:\tools\uv-tools\bin
# 方案四：G:\tools\kimi-venv\Scripts
```

配置后**重启 VS Code** 生效。
