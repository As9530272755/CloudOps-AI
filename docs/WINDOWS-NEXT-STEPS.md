# Windows 安装后续步骤（uv 已装到 G:\kimi）

## 当前状态
```
uv 已安装到 G:\kimi
```

---

## 步骤 1：添加 uv 到 PATH（cmd 环境）

当前你在 cmd 中，用以下命令：

```cmd
set PATH=%PATH%;G:\kimi
```

验证：
```cmd
uv --version
```

---

## 步骤 2：安装 kimi-cli

```cmd
uv tool install --tool-dir "G:\kimi-tools" kimi-cli
```

---

## 步骤 3：添加 kimi 到 PATH

```cmd
set PATH=%PATH%;G:\kimi-tools\bin
```

验证：
```cmd
kimi --version
```

---

## 步骤 4：VS Code 中配置 Kimi 插件

1. 打开 VS Code
2. 点击左侧 Kimi 图标
3. 点击设置（或 `Ctrl + Shift + P` → `Kimi: Settings`）
4. 找到 **Kimi CLI Path**，填入：
   ```
   G:\kimi-tools\bin\kimi.exe
   ```
5. 重启 VS Code

---

## 步骤 5：启动开发（进入项目）

```cmd
cd G:\cloudops-v2

# 启动 Kimi（命令行模式）
kimi code

# 或让 VS Code 插件使用
```

---

## 永久配置 PATH（避免每次重启都要 set）

```cmd
setx PATH "%PATH%;G:\kimi;G:\kimi-tools\bin"
```

> `setx` 会永久写入用户环境变量，**重启 cmd 或 VS Code** 后生效。

---

## 完整命令汇总（按顺序执行）

```cmd
set PATH=%PATH%;G:\kimi
uv --version
uv tool install --tool-dir "G:\kimi-tools" kimi-cli
set PATH=%PATH%;G:\kimi-tools\bin
kimi --version
setx PATH "%PATH%;G:\kimi;G:\kimi-tools\bin"
```

全部执行完，重启 VS Code，Kimi 插件应该显示 **Ready**。
