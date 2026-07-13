# RPG Parchment UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a restrained RPG parchment visual system to the existing renderer without changing behavior.

**Architecture:** Add one project-local raster texture and centralize the visual treatment in `styles.css`. Add only the semantic classes needed for current-account selection and quota tracks in existing React components.

**Tech Stack:** Electron, React, TypeScript, Tailwind CSS, CSS, PNG asset

---

### Task 1: Add parchment material and frame system

**Files:**
- Create: `src/renderer/assets/parchment-texture.png`
- Modify: `src/renderer/styles.css`

- [ ] Add a low-contrast tileable raster parchment asset.
- [ ] Replace embedded SVG noise with the raster asset.
- [ ] Refine header, account vault, credential console, buttons, and mode loadout using engraved borders and restrained inset highlights.

### Task 2: Apply semantic game UI treatments

**Files:**
- Modify: `src/renderer/components/ProfileRow.tsx`

- [ ] Replace the current-account side stripe with an inset selected state and seal-like badge.
- [ ] Add equipment-slot classes to account icons.
- [ ] Add durability-track classes to both compact and standard quota bars.

### Task 3: Verify

**Files:**
- Test: existing test suite

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check`.
- [ ] Inspect Gemini and Antigravity screenshots at desktop size for clipping, contrast, and layout shift.
