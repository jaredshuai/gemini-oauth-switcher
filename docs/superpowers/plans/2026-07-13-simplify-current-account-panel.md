# Simplify Current Account Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove internal credential-routing information from the black account panel and retain only user-actionable account and health status.

**Architecture:** Keep the existing left identity area intact. Replace `SwitchRoutePanel` with a compact status panel that derives recent-switch, verification, and local-environment states from the same existing props, without changing IPC or shared types.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest

---

### Task 1: Replace credential routing with actionable status

**Files:**
- Modify: `src/renderer/components/CurrentAccountPanel.tsx`

- [ ] Remove route-specific icons, nodes, arrows, and duplicated target/command data.
- [ ] Rename the right-side section to `状态检查`.
- [ ] Present recent switch, switch verification, and local environment as compact status rows.
- [ ] Rewrite `源与目标 hash 一致` as `切换校验通过`.
- [ ] Preserve environment-variable warnings and Gemini command availability.
- [ ] Reduce the panel minimum height while preserving the existing parchment/console visual language.

### Task 2: Verify behavior and layout

**Files:**
- Test: existing renderer and service test suites

- [ ] Run `pnpm typecheck`; expect no TypeScript errors.
- [ ] Run `pnpm test`; expect all tests to pass.
- [ ] Run `pnpm build`; expect a successful production build.
- [ ] Run `git diff --check`; expect no whitespace errors.
- [ ] Inspect Gemini and Antigravity states in the running Electron app at the current desktop window size.
- [ ] Confirm no credential route, official target, or duplicate command appears in the black panel.
