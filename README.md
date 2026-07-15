# Gemini OAuth Switcher

Windows 本地 GUI 工具，用来在已有 profiles 之间切换当前 Gemini CLI 使用的 OAuth 账号，并支持 Antigravity CLI 的系统凭据切换。程序按需打开，不需要常驻；也不提供后台服务、数据库或账号池调度。

## 账号模型

Gemini CLI 与 Antigravity CLI 使用完全独立的账号来源。

### Gemini CLI

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

### Antigravity CLI

Antigravity 页面不会扫描或显示 `profilesRoot` 下的 Gemini 历史账号。Agy 账号名称、邮箱、创建时间等非敏感元数据保存在应用设置中，登录凭据保存在 Windows Credential Manager：

```text
official target: gemini:antigravity
profile target:  gemini-oauth-switcher:antigravity-cli:<profile-id>
```

每个账号使用随机稳定 ID，Credential Manager target 不依赖 `.gemini-homes` 路径。该实现已在 Windows 11 + `agy` 1.1.1 上验证：`agy` 能从 `gemini:antigravity` 冷启动、静默刷新 token，并使用刷新后的凭据认证。

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
pnpm verify:windows-artifacts
```

## 功能

- 保存 `profilesRoot`
- 扫描 profile 目录
- 切换目标工具：Gemini CLI / Antigravity CLI
- 显示账号状态、更新时间、当前匹配账号
- Gemini CLI：切换 `.gemini\oauth_creds.json`
- Antigravity CLI：切换 Windows Credential Manager 中的 `gemini:antigravity`
- Agy 页面使用独立账号列表，不显示 Gemini profile 目录
- 登记当前 Agy 登录，无需重新登录当前账号
- 新增登录：打开隔离 PowerShell 登录窗口，成功后保存为新的 profile
- Gemini CLI 与 Antigravity CLI 用量查询
- 打开 `profilesRoot` 和目标目录
- Gemini profile 删除：移动到 Windows 回收站
- Antigravity 账号删除：删除本应用账号登记及对应 Credential Manager 项

## 切换流程

Gemini CLI：

1. 校验 profile 下的 `.gemini\oauth_creds.json` 存在。
2. 确保目标 `.gemini` 目录存在。
3. 写入随机后缀临时文件。
4. 用临时文件替换目标 `oauth_creds.json`。
5. 重新计算目标 SHA256，确认与源文件一致。

Antigravity CLI：

1. 从 Agy 独立账号注册表找到所选账号的稳定 ID。
2. 校验该 ID 对应的本应用 Credential Manager 项存在。
3. 通过 Win32 API 读取原始 UTF-8 payload，但不展示、不打印。
4. 原样写入官方 Credential Manager 目标 `gemini:antigravity`。
5. 重新读取官方目标并计算 SHA256，确认与源凭据一致。

## 新增登录

点击“新增登录”后，程序会创建 `.pending-login-*` 临时目录，并打开独立 PowerShell。

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

临时目录位于系统临时目录下的 `gemini-oauth-switcher\antigravity-login`，不会进入 `.gemini-homes`。打开登录窗口前，程序会先把当前 `gemini:antigravity` 备份到临时 Credential Manager 项，然后清空官方目标，确保 `agy` 进入新账号 OAuth，而不是静默复用旧账号。

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

完成浏览器登录后，回到窗口点击“重新检测”。Gemini 模式检测 OAuth 文件并把临时目录改名为最终 profile 目录；Antigravity 模式检测官方 Credential Manager 目标，把非敏感账号元数据登记到 Agy 独立列表，并把凭据保存到随机稳定 ID 对应的应用凭据项。Agy 临时目录在保存后直接删除。点击“取消”会关闭登录进程、恢复登录前的凭据并删除临时备份；应用下次启动时也会尝试恢复遗留登录会话的备份。

## 用量查询

- Gemini 模式显示 Pro、Flash 和 Flash Lite 的已使用比例。
- Antigravity 模式显示 Gemini 与 Claude / GPT 两个模型组的周限额和 5 小时限额。
- Agy 查询直接使用各账号保存在 Credential Manager 中的凭据，不需要启动 Antigravity 桌面端，也不会切换当前账号。
- Access token 过期时会在 main process 内临时刷新；刷新出的 token 不会写回配置或发送到 renderer。

## 安全注意事项

- 仓库 `.gitignore` 会忽略所有 `oauth_creds.json`，不要提交真实 OAuth 凭据。
- 不要提交真实 Antigravity CLI `settings.json`。
- 程序不会展示、解析到界面、打印或写入日志记录 OAuth/token payload。
- Antigravity CredentialBlob 只在 Electron main process 和 Win32 API 调用内存中流转，不会经过 renderer、PowerShell stdout 或临时文件。
- Renderer 不直接访问文件系统或 Credential Manager；文件扫描、hash、settings、路径打开、切换、删除、新增登录和用量查询都在 Electron main process 中执行。
- 配置文件只保存 `profilesRoot`、Agy 账号 ID/名称/邮箱、窗口位置、`lastSelectedProfile`、昵称等非敏感信息。
- Gemini 用量查询会使用 OAuth 文件中的 token 调 Google 官方接口，但不会展示、打印或保存 token 内容。
- Antigravity 用量查询会使用 Credential Manager 中的 token 调 Google 官方 quota 接口，token 仅在 main process 内存中使用。
- Antigravity CLI 凭据由 Windows Credential Manager 保存；卸载应用不会自动删除用户的系统凭据。
- 本地诊断日志位于 Electron `userData` 下的 `logs` 目录，只记录脱敏事件信息；最多保留 3 个约 256 KB 的轮转文件，不会无限增长。

## 打包

- `pnpm pack:win` 生成 `release\win-unpacked\`，适合本机排错。
- `pnpm dist:win` 同时生成 Windows x64 安装包和 portable exe。
- `pnpm dist:win:installer` 只生成安装包。
- `pnpm dist:win:portable` 只生成 portable exe。
- 安装包按用户安装，不需要管理员权限；卸载时不会删除用户配置和账号目录。
- 自动更新只支持 NSIS 安装版；portable 版需要手动下载新版本。
- 正式发布前按 [Windows 发布冒烟检查](docs/release-smoke-test.md) 验证干净安装、覆盖升级、设置恢复和白屏兜底。

## 发布与自动更新

正式版本通过 `vX.Y.Z` tag 触发 GitHub Actions。发布步骤：

1. 使用 `pnpm version X.Y.Z --no-git-tag-version` 更新 `package.json` 版本并提交。
2. tag 必须与包版本完全一致，例如包版本 `0.2.0` 只能使用 `v0.2.0`。
3. 推送 `main` 后创建并推送 tag：`git tag vX.Y.Z`、`git push origin vX.Y.Z`。

代码签名是可选的：

- 未配置签名时，Release workflow 仍会构建并发布 NSIS 安装包、portable、blockmap 和 `latest.yml`。首次安装或更新时，Windows SmartScreen 可能显示“未知发布者”或安全提醒。
- 需要签名时，在 GitHub 仓库中同时配置 `WINDOWS_CSC_LINK` 和 `WINDOWS_CSC_KEY_PASSWORD` secrets。前者是 Windows 代码签名 PFX 的 Base64 内容或可访问地址，后者是证书密码。
- 两个签名 secret 必须同时存在或同时留空。只配置其中一个会让构建失败，避免误以为产物已经签名。
- 配置签名后，workflow 会验证安装包和 portable exe 的 Authenticode 签名；签名无效时不会创建 GitHub Release。

无论是否签名，workflow 都会校验 tag 与包版本、测试代码和发布产物是否完整。

安装版启动后会按设置检查 GitHub Release。下载完成后选择“重启安装”会先退出托盘与窗口生命周期，再启动安装；关闭自动更新会取消尚未执行的检查，并禁止当前会话自动安装。

## 技术栈

- Electron
- Vite
- React
- TypeScript
- Tailwind CSS
- Vitest
- Node `fs/promises`、`crypto`
- `koffi`（调用 Windows Credential Manager Win32 API）
