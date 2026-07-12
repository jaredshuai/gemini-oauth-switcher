# Antigravity Usage Query Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Query and display weekly and five-hour Antigravity quotas for every registered account.

**Architecture:** A dedicated main-process service reads a profile credential from Windows Credential Manager, refreshes its OAuth access token in memory when needed, and calls Antigravity's quota summary endpoint. Existing usage IPC channels route by target tool, while the renderer displays grouped Agy quota bars using the current usage visual language.

**Tech Stack:** Electron, TypeScript, Node fetch, Vitest, React, Tailwind CSS

---

## Chunk 1: Main-process quota service

### Task 1: Shared usage group contract

**Files:**
- Modify: `src/shared/types.ts`

- [ ] Add a `UsageGroup` interface containing a stable name, display label, optional description, and `UsageTier[]`.
- [ ] Add optional `groups` to `ProfileUsageResult` without changing existing Gemini results.
- [ ] Extend usage API methods with an optional `TargetTool` argument.
- [ ] Run `pnpm typecheck` and confirm expected call-site failures identify the renderer/preload work still required.

### Task 2: Antigravity usage service

**Files:**
- Create: `src/main/antigravityUsageService.ts`
- Create: `tests/antigravityUsageService.test.ts`

- [ ] Write a failing test for a valid access token mapping both model groups and both quota windows.
- [ ] Run `pnpm exec vitest run tests/antigravityUsageService.test.ts` and confirm failure because the module does not exist.
- [ ] Implement credential parsing, the quota request, consumed-percentage mapping, and safe result construction.
- [ ] Run the targeted test and confirm it passes.
- [ ] Write a failing test for an expired access token refreshed through `https://oauth2.googleapis.com/token`.
- [ ] Implement in-memory token refresh and one 401 refresh retry.
- [ ] Add missing credential, malformed payload, malformed response, and network failure tests.
- [ ] Run the targeted test suite and confirm all cases pass.

## Chunk 2: IPC and renderer integration

### Task 3: Route usage by target tool

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/preload/preload.ts`
- Modify: `src/shared/types.ts`

- [ ] Pass target tool through `refreshProfileUsage` and `refreshAllUsage`.
- [ ] Route Gemini requests to `queryGeminiUsageFromOAuthFile` unchanged.
- [ ] Resolve Antigravity profile IDs from settings and query their Credential Manager targets.
- [ ] Return all-account results keyed by Gemini profile name or Antigravity profile ID.
- [ ] Run `pnpm typecheck` and resolve all contract errors.

### Task 4: Render grouped Antigravity usage

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/ProfileRow.tsx`
- Modify: `src/renderer/utils.ts`
- Modify: `tests/rendererUtils.test.ts`

- [ ] Write failing renderer utility tests for target-aware credential failure copy.
- [ ] Pass profile IDs and selected tool into usage refresh actions.
- [ ] Show the global usage button for both tools and make its tooltip target-aware.
- [ ] Replace the Antigravity credential-only column with a query state and grouped quota summary.
- [ ] Keep credential readiness visible before the first query.
- [ ] Verify long group labels and four quota rows fit the existing fixed table tracks.
- [ ] Run renderer utility tests and `pnpm typecheck`.

## Chunk 3: Verification

### Task 5: Full automated and real-account verification

**Files:**
- Review: all changed files

- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check` and scan changed files for token logging.
- [ ] Restart `pnpm dev` so Electron main-process changes load.
- [ ] Query both registered Antigravity accounts and verify the current account matches the desktop client's quota.
- [ ] Inspect the Agy table at the current desktop window size for clipping or overlap.
- [ ] Commit and push `codex/agy-usage` without merging to `main`.
