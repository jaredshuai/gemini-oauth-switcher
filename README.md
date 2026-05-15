# Gemini OAuth Switcher

Windows 本地 GUI 工具，用来在已有的 Gemini OAuth profiles 之间切换当前 Gemini CLI 使用的账号。
它是按需打开的本地工具，不做后台服务；可在设置里选择关闭窗口时直接退出，或隐藏到系统托盘。

## 目录模型

默认 `profilesRoot` 是当前系统用户 home 下的 `.gemini-homes`：

```text
C:\Users\<current-user>\.gemini-homes
```

也可以在界面里改成其他 `gemini_home`。程序只扫描 `profilesRoot` 下的直接子目录：

```text
<profilesRoot>\
  work\
    .gemini\
      oauth_creds.json
  personal\
    .gemini\
      oauth_creds.json
```

点击切换后，程序会把所选 profile 的 OAuth 文件写到 Gemini CLI 默认读取位置：

```text
C:\Users\<current-user>\.gemini\oauth_creds.json
```

程序不会创建额外账号仓库，也不会展示或打印 `oauth_creds.json` 内容。新增登录时只会读取账号标识用于自动命名，不会把 token 写入配置或界面。

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
pnpm dist:win:portable
pnpm dist:win:installer
```

打包：

- `pnpm pack:win` 生成 `release\win-unpacked\`，适合本机排错。
- `pnpm dist:win` 同时生成 Windows x64 安装包和 portable exe，输出到 `release\`。
- `pnpm dist:win:installer` 只生成安装包。
- `pnpm dist:win:portable` 只生成 portable exe。
- 安装包为按用户安装，不需要管理员权限；卸载时不会删除用户配置和账号目录。
- 当前不做代码签名；第一次运行时 Windows SmartScreen 可能会提示未知发布者。

GitHub Actions：

- 推送到 `main`、提交 PR，或手动运行 `Build Windows App` workflow 时，会在 Windows runner 上执行测试并打包。
- workflow 会上传 Windows x64 安装包和 portable exe 到 Actions artifacts。
- 推送 `v*.*.*` 格式的 tag（例如 `v0.1.0`）时，会自动创建 GitHub Release，并附带安装包和 portable exe。

## 第一版功能

- 保存 `profilesRoot`
- 扫描 profile 目录并显示 OAuth 文件状态
- 显示更新时间、当前匹配账号
- 将所选 profile 切换到 Gemini CLI 默认 OAuth 路径
- 刷新列表
- 手动查询 Gemini 官方用量
- 新增登录：打开隔离的 PowerShell 登录窗口，成功后识别账号并保存成新的 profile
- 删除 profile：会移到 Windows 回收站，当前正在使用的账号不能直接删除
- 打开 `profilesRoot`
- 打开目标 `.gemini` 目录
- 切换完成后可直接关闭窗口

切换流程：

1. 校验源 profile 的 `.gemini\oauth_creds.json` 存在。
2. 确保目标 `.gemini` 目录存在。
3. 先写入 `oauth_creds.json.tmp`。
4. 用临时文件替换目标 `oauth_creds.json`。
5. 重新计算目标 SHA256，并确认与源文件一致。

用量查询：

1. 点击顶部“查询用量”会查询当前列表里的 profiles；也可以在单行点击“查询用量”。
2. 程序会在 Electron main process 中读取对应 profile 的 OAuth 文件。
3. 如果 access token 已过期，会按 Gemini CLI 的 OAuth client 信息用 `refresh_token` 换取新的临时 access token。
4. 随后调用 Google 的 `loadCodeAssist` 和 `retrieveUserQuota` 接口，显示 Pro、Flash、Flash Lite 的已用百分比。
5. 这是手动动作，不做后台轮询，不常驻。

新增登录：

1. 点击顶部“新增登录”。
2. 程序会在 `profilesRoot` 下创建 `.pending-login-*` 临时目录，并打开一个独立 PowerShell。
3. 这个 PowerShell 会设置 `GEMINI_CLI_HOME` 指向临时目录，并清理可能干扰登录的 API key/base URL 环境变量：

```powershell
$env:GEMINI_CLI_HOME = $profile
Remove-Item Env:\GEMINI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\GOOGLE_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:\GOOGLE_GEMINI_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:\GOOGLE_VERTEX_BASE_URL -ErrorAction SilentlyContinue
gemini
```

4. 登录完成后回到窗口点击“重新检测”。
5. 检测到 OAuth 文件后，程序会尝试识别账号邮箱，并自动填入保存名称和昵称。
6. 点击“保存到账号列表”后，临时目录会改名为最终 profile 目录。
7. 新增登录不会覆盖当前 `C:\Users\<current-user>\.gemini\oauth_creds.json`；需要使用新账号时，再在列表里点击“切换”。

删除 profile：

1. 点击账号行右侧的删除按钮。
2. 确认后，程序只会处理 `profilesRoot` 下的直接子目录。
3. 在 Windows 上会移到回收站，而不是直接永久删除。
4. 当前正在使用的账号不能删除；先切换到其他账号后再删。

## 安全注意事项

- 仓库的 `.gitignore` 会忽略所有 `oauth_creds.json`，不要提交真实 OAuth 凭据。
- 配置文件只保存 `profilesRoot`、窗口位置、`lastSelectedProfile`、昵称等非敏感信息。
- Renderer 不直接访问文件系统；文件扫描、hash、settings、路径打开、切换、删除、新增登录和用量查询都在 Electron main process 中执行。
- 用量查询会使用 OAuth 文件中的 access token / refresh token 调 Google 官方接口，但不会展示、打印或保存 token 内容。
- 新增登录会读取 OAuth 文件中的账号标识用于命名；如果没有识别到邮箱，可以手动填写保存名称。
- 用量查询失败通常是 OAuth 已失效、账号权限不足、网络问题，或 Google 接口返回权限错误。
- 新开一个干净 PowerShell 后运行 `gemini`，Gemini CLI 会读取刚切换到默认路径的账号。
- 程序不需要常驻；切换动作完成后，目标 OAuth 文件已经落盘。

## 技术栈

- Electron
- Vite
- React
- TypeScript
- Tailwind CSS
- Vitest
