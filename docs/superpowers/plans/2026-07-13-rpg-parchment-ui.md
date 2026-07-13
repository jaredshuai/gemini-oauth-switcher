# RPG Parchment UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent built-in skin selector with classic as the default and RPG parchment as an optional theme.

**Architecture:** Store a safe built-in theme id in existing application settings, expose it through the existing preload settings API, and set a `data-theme` attribute on the renderer root. Keep one React structure and scope theme differences in `styles.css`; no arbitrary code or CSS loading.

**Tech Stack:** Electron, React, TypeScript, Tailwind CSS, CSS, PNG asset

---

### Task 1: Add parchment material and frame system

**Files:**
- Create: `src/renderer/assets/parchment-texture.png`
- Modify: `src/renderer/styles.css`

- [ ] Add a low-contrast tileable raster parchment asset.
- [ ] Replace embedded SVG noise with the raster asset.
- [ ] Refine header, account vault, credential console, buttons, and mode loadout using engraved borders and restrained inset highlights.

### Task 2: Persist the selected built-in theme

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/settings.ts`
- Test: `tests/settings.test.ts`

- [ ] Add `UiTheme` with `classic` and `rpg-parchment` values.
- [ ] Default missing or invalid settings to `classic`.
- [ ] Persist `rpg-parchment` as non-sensitive settings.

### Task 3: Add immediate theme selection

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/SettingsDialog.tsx`

- [ ] Add a `界面皮肤` segmented setting.
- [ ] Save theme changes immediately using the existing settings API.
- [ ] Apply the selected theme through the renderer root `data-theme` attribute.
- [ ] Do not reload profiles or usage when switching themes.

### Task 4: Apply semantic game UI treatments

**Files:**
- Modify: `src/renderer/components/ProfileRow.tsx`

- [ ] Replace the current-account side stripe with an inset selected state and seal-like badge.
- [ ] Add equipment-slot classes to account icons.
- [ ] Add durability-track classes to both compact and standard quota bars.
- [ ] Restore the existing production appearance under the `classic` theme.
- [ ] Scope parchment and RPG treatments to `rpg-parchment`.

### Task 5: Verify

**Files:**
- Test: existing test suite

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check`.
- [ ] Inspect Gemini and Antigravity screenshots at desktop size for clipping, contrast, and layout shift.
- [ ] Confirm a fresh/missing theme setting opens in `classic`.
- [ ] Confirm switching skins updates immediately without profile or usage refresh.
