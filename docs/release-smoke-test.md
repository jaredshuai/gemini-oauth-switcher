# Windows 发布冒烟检查

这份流程用于正式发布前验证安装包、覆盖升级、故障恢复和卸载行为。优先在临时 Windows 用户或虚拟机中执行，避免把故障注入步骤作用到日常使用的设置文件。

## 1. 构建与产物门禁

```powershell
pnpm test
pnpm typecheck
pnpm dist:win
pnpm verify:windows-artifacts
```

产物校验必须同时通过以下检查：

- 当前版本的 NSIS 安装包、portable、blockmap 和 `latest.yml` 都存在。
- 两个 exe 都有 Windows PE 头，且大小没有异常缩小。
- `latest.yml` 的版本、安装包文件名、文件大小和两个 sha512 字段互相一致。

## 2. 干净安装

1. 使用没有安装过本应用的临时 Windows 用户，运行当前版本 `Gemini-OAuth-Switcher-<version>-setup-x64.exe`。
2. 分别验证默认安装目录和自定义安装目录；两种方式都不应要求管理员权限。
3. 启动应用，确认首屏不是空白，标题栏、Gemini/Agy 切换、账号列表和设置页都能正常显示。
4. 关闭并重新打开应用，确认窗口大小、皮肤、目标工具等非敏感设置仍然存在。
5. 连续启动两次，确认只保留一个主窗口，第二次启动会唤回已有窗口。
6. 不执行切换、删除或新增登录时，安装和启动不会修改任何账号凭据。

## 3. 覆盖升级

1. 先安装上一个正式版本，并设置一个容易识别的非敏感偏好，例如皮肤、用量显示方式或昵称。
2. 不卸载旧版本，直接运行当前版本安装包并安装到同一目录。
3. 启动后确认设置页显示当前版本号，旧的非敏感偏好、Gemini profile 列表和 Agy 账号登记仍然存在。
4. 分别切换一个 Gemini 和 Agy 账号，确认切换后的账号匹配与用量查询仍可工作。
5. 对 NSIS 安装版执行一次自动更新检查，确认 `latest.yml` 能识别新版本；portable 版应继续显示需要手动更新。

## 4. 设置损坏恢复

只在临时 Windows 用户中执行。关闭应用后，找到 Electron `userData` 中的 `settings.json` 和 `settings.json.bak`。

1. 保留有效备份，把主设置文件改成无效 JSON 后启动应用。
2. 确认界面提示“已从备份恢复”，账号列表和偏好来自备份。
3. 再把主设置和备份都改成无效 JSON 后启动应用。
4. 确认界面提示已使用默认设置，而不是静默显示一个看似正常的空账号列表。
5. 测试结束后恢复原文件，或删除整个临时 Windows 用户。

## 5. 界面加载失败恢复

可用 portable 产物模拟无法连接的开发服务器：

```powershell
$env:VITE_DEV_SERVER_URL = "http://127.0.0.1:9"
& ".\release\Gemini-OAuth-Switcher-<version>-portable-x64.exe"
Remove-Item Env:\VITE_DEV_SERVER_URL -ErrorAction SilentlyContinue
```

确认应用显示中文故障页和恢复对话框，而不是空白窗口。依次验证“重新加载”“打开诊断目录”和“退出应用”。

诊断目录最多保留 `diagnostics.log`、`.1`、`.2` 三个文件，每个文件上限约 256 KB。搜索日志时不应看到 OAuth payload、access/refresh token、API key 或账号邮箱原文。

## 6. 卸载

1. 从 Windows 设置中卸载应用，确认安装目录和快捷方式被移除。
2. 用户设置、Gemini profile 目录和 Windows Credential Manager 中的 Agy 凭据应继续保留，这是当前设计行为。
3. 重新安装同版本，确认保留的非敏感设置和账号登记仍可读取。

