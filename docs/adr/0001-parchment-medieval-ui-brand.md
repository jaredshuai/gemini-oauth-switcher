# ADR-0001: UI 皮肤系统与"羊皮纸 × 中世纪魔幻"品牌方向

- 状态:已接受(Accepted)
- 日期:2026-07-20
- 背景:2026-07-20 的界面设计评审(`.impeccable/critique/2026-07-20T02-01-05Z__src-renderer.md`)把界面装饰层元素(英文 eyebrow、罗马数字徽章、印章、衬线字体、羊皮纸纹理)标记为"AI 生成痕迹"。项目 owner 确认:**这些是有意的品牌语言,不是缺陷。**

## 决定

### 品牌方向

整体视觉方向为**羊皮纸 + 中世纪魔幻(medieval fantasy / RPG)**,并有一套"装备"隐喻贯穿代码结构:

- 目标工具切换 = 装备栏(`mode-loadout`、`mode-loadout-sigil`、`loadout-equip` 动画)
- 当前账号标记 = 印章(`current-seal`,旋转 -2°)
- 账号库 = `account-vault`,账号行 = `account-slot`,身份卡 = `credential-console`
- 排版语音:衬线 logo / 工具名、小号大写加宽拉丁 eyebrow(如 `CREDENTIAL ENTRIES`)、罗马数字 sigil(I/II)、补零计数徽章("04")
- 材质:羊皮纸纹理、米色暖调底色

这些元素是**品牌语音(voice)**,后续任何设计评审不得作为 "AI slop" 或"装饰税"上报。

### 双皮肤实现

- `UiTheme`(`src/shared/types.ts`)= `"classic" | "rpg-parchment"`。
- `classic` 为默认皮肤:品牌感**淡化但不消除**——保留 sigil、下划线衬线工具名等识别元素,禁用印章旋转、装备动画等强主题表现(见 `styles.css:980` 起的 `[data-theme="classic"]` 覆盖块)。
- `rpg-parchment` 为完整主题皮肤。
- 皮肤通过设置弹窗的 segmented control 切换(`SettingsDialog.tsx:128/137`),`saveUiTheme` 持久化到 `settings.uiTheme`(`App.tsx:408`),`data-theme` 属性挂在 `<main className="app-parchment">` 上(`App.tsx:679`)。

## 边界:装饰的豁免不覆盖可用性

以下仍然算问题,不因品牌方向豁免:

- **颜色语义一致性**:红 = 错误/危险,不得用于"部分成功的完成态"(如批量查询横幅)。
- **可访问性**:正文对比度 ≥ 4.5:1;屏幕阅读器必须能获知当前状态(当前工具、当前账号);品牌元素可用 `aria-hidden` 装饰化,但其所承载的状态必须有等效文本。
- **信息密度**:装饰不得制造冗余确认(如同一卡片内多处重复"正常")。
- **双皮肤完整性**:新增装饰元素必须在两种皮肤下都有定义;`classic` 可淡化,但不得留下无皮肤的裸结构。

## 后果

- 评审豁免清单维护在 `.impeccable/critique/ignore.md`,后续 `$impeccable critique` 运行时静默丢弃装饰层发现。
- 新增皮肤 = 新增一个 `[data-theme="<name>"]` 覆盖块 + `UiTheme` 联合类型 + 设置弹窗选项;注意 `styles.css` 中裸 hex 与逐字重复的网格模板(B 组评审发现)在新增皮肤时会放大维护成本。
- 工程层面的观察仍然有效:双皮肤共用一套组件裸结构 + CSS 皮肤覆盖,长期需要约束(装饰类名即契约,重命名需双主题同步)。
