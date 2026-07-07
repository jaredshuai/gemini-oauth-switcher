# Gemini OAuth Switcher

Windows 本地 GUI 工具，用来在已有 profiles 之间切换当前 Gemini CLI 使用的 OAuth 账号，并支持 Antigravity CLI 的系统凭据切换。程序按需打开，不需要常驻；也不提供后台服务、数据库或账号池调度。

## 目录模型

默认 `profilesRoot` 是当前系统用户 home 下的 `.gemini-homes`：

```text
C:\Users\<current-user>\.gemini-homes
```

也可以在界面里改成其他 `gemini_home`。程序只扫描 `profilesRoot` 下的直接子目录。

Gemini CLI profile 使用文件：

```text
<profilesRoot>\
  work\
    .gemini\
      oauth_creds.json
```

点击切换后，程序会把所选 profile 的 OAuth 文件写到 Gemini CLI 默认读取位置：

```text
C:\Users\<current-user>\.gemini\oauth_creds.json
```

Antigravity CLI profile 仍使用同一个 `profilesRoot` 下的账号目录作为列表来源，但账号凭据不再以 `settings.json` 作为切换依据。Antigravity CLI 官方认证使用系统 keyring；本工具会把每个 profile 的 Antigravity 登录凭据保存为本应用自己的 Windows Credential Manager 项，切换时写回官方目标项：

```text
official target: gemini:antigravity
profile target:  gemini-oauth-switcher:antigravity-cli:<profile-id>
```

新增 Antigravity 登录时，如果登录窗口产生了 `settings.json`，程序会保留它用于辅助识别账号；真正用于切换的是 Windows Credential Manager 中的登录凭据。

## 开发

```powershell
pnpm install
pnpm dev
```

常用命令：

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm pack:win
pnpm dist:win
pnpm dist:win:installer
pnpm dist:win:portable
```

## 功能

- 保存 `profilesRoot`
- 扫描 profile 目录
- 切换目标工具：Gemini CLI / Antigravity CLI
- 显示账号状态、更新时间、当前匹配账号
- Gemini CLI：切换 `.gemini\oauth_creds.json`
- Antigravity CLI：切换 Windows Credential Manager 中的 `gemini:antigravity`
- 新增登录：打开隔离 PowerShell 登录窗口，成功后保存为新的 profile
- Gemini CLI 用量查询
- 打开 `profilesRoot` 和目标目录
- Gemini profile 删除：移动到 Windows 回收站

## 切换流程

Gemini CLI：

1. 校验 profile 下的 `.gemini\oauth_creds.json` 存在。
2. 确保目标 `.gemini` 目录存在。
3. 写入随机后缀临时文件。
4. 用临时文件替换目标 `oauth_creds.json`。
5. 重新计算目标 SHA256，确认与源文件一致。

Antigravity CLI：

1. 校验 profile 对应的本应用 Credential Manager 项存在。
2. 读取该凭据的 payload，但不展示、不打印。
3. 写入官方 Credential Manager 目标 `gemini:antigravity`。
4. 重新读取官方目标并计算 SHA256，确认与源凭据一致。

## 新增登录

点击“新增登录”后，程序会在 `profilesRoot` 下创建 `.pending-login-*` 临时目录，并打开独立 PowerShell。

Gemini CLI 模式：

```powershell
$env:GEMINI_CLI_HOME = $profile
Remove-Item Env:\GEMINI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\GOOGLE_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\GOOGLE_GEMINI_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\GOOGLE_VERTEX_BASE_URL -ErrorAction SilentlyContinue
gemini --skip-trust
```

Antigravity CLI 模式：

```powershell
$env:USERPROFILE = $profile
$env:HOME = $profile
$env:APPDATA = Join-Path $profile 'AppData\Roaming'
$env:LOCALAPPDATA = Join-Path $profile 'AppData\Local'
Remove-Item Env:\GEMINI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\GOOGLE_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\GOOGLE_GEMINI_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\GOOGLE_VERTEX_BASE_URL -ErrorAction SilentlyContinue
agy
```

完成浏览器登录后，回到窗口点击“重新检测”。Gemini 模式检测 OAuth 文件；Antigravity 模式优先检测官方 Credential Manager 目标 `gemini:antigravity`。点击“保存到账号列表”后，临时目录会改名为最终 profile 目录，并把凭据保存到该 profile 对应的本应用凭据项。

## 安全注意事项

- 仓库 `.gitignore` 会忽略所有 `oauth_creds.json`，不要提交真实 OAuth 凭据。
- 不要提交真实 Antigravity CLI `settings.json`。
- 程序不会展示、解析到界面、打印或写入日志记录 OAuth/token payload。
- Renderer 不直接访问文件系统或 Credential Manager；文件扫描、hash、settings、路径打开、切换、删除、新增登录和用量查询都在 Electron main process 中执行。
- 配置文件只保存 `profilesRoot`、窗口位置、`lastSelectedProfile`、昵称等非敏感信息。
- Gemini 用量查询会使用 OAuth 文件中的 token 调 Google 官方接口，但不会展示、打印或保存 token 内容。
- Antigravity CLI 凭据由 Windows Credential Manager 保存；卸载应用不会自动删除用户的系统凭据或 profile 目录。

## 打包

- `pnpm pack:win` 生成 `release\win-unpacked\`，适合本机排错。
- `pnpm dist:win` 同时生成 Windows x64 安装包和 portable exe。
- `pnpm dist:win:installer` 只生成安装包。
- `pnpm dist:win:portable` 只生成 portable exe。
- 安装包按用户安装，不需要管理员权限；卸载时不会删除用户配置和账号目录。

## 技术栈

- Electron
- Vite
- React
- TypeScript
- Tailwind CSS
- Vitest
- Node `fs/promises`、`crypto`
- `@napi-rs/keyring`
