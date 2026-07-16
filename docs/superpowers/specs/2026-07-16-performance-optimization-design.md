# Performance Optimization Design

## Goal

Improve perceived responsiveness and worst-case startup behavior without changing account-switching semantics, weakening credential safety, or introducing a backend or database.

The selected approach is targeted optimization with before-and-after measurements. It focuses on work that can delay the window, repeat network authentication, or rerender unrelated account rows. It does not attempt a broad renderer rewrite.

## Current Baseline

The following measurements were collected from the current `v0.3.2` workspace on the development machine:

- A normal launch of the unpacked production application produced a visible main window in approximately 700 ms.
- Four Electron processes used approximately 390 MB working set two seconds after launch. Most of this is the Electron main, GPU, renderer, and utility process baseline.
- Listing two Gemini profiles took 12.54 ms on the first run in a fresh Node process and 0.70-1.15 ms on repeated runs.
- The production renderer contains 256.97 kB JavaScript (79.13 kB gzip), 38.96 kB CSS (8.65 kB gzip), and a 277.96 kB local parchment texture.
- `App.tsx` owns the page-level state and actions in one approximately 810-line component. A status update, relative-time tick, or one-profile usage update currently rerenders the account list and recreates row callbacks.

These values are local reference measurements, not release guarantees. The implementation must record the same measurements after the changes and compare like-for-like runs.

## Scope

1. Remove stale-session maintenance from the window creation critical path.
2. Reuse refreshed OAuth access tokens safely within the main-process lifetime.
3. Prevent unrelated profile rows from rerendering during row-local activity.
4. Defer noncritical renderer startup data until the account list can begin loading.
5. Preserve current UI behavior, account switching, usage display semantics, settings, and update behavior.

## Non-Goals

- Replacing Electron or changing the required Electron/Vite/React/TypeScript stack.
- Disabling GPU acceleration to reduce the Electron process baseline.
- Persisting OAuth access tokens, refresh tokens, credential payloads, or usage responses.
- Caching profile file hashes across application launches.
- Changing quota endpoints, response mapping, or used-versus-remaining display semantics.
- Redesigning the interface, changing account columns, or adding new settings.
- Bumping the version, packaging a release, or publishing artifacts before verification.

## Startup Maintenance

### Problem

The main process currently waits for diagnostic logging, two stale OAuth login cleanup passes, and stale profile-registration cleanup before calling `createWindow()`. Clean directories are fast, but an old locked directory can trigger removal retries and delay every launch before any UI is visible.

### Design

Introduce a focused startup maintenance coordinator in the main process. It owns one process-lifetime promise and starts the existing cleanup operations exactly once.

The primary startup order becomes:

1. Wait for Electron readiness.
2. Load sanitized settings required to construct the window.
3. Create the tray and main window.
4. Start diagnostic logging and stale-session maintenance without awaiting them on the window path.
5. Apply automatic-update settings as today.

The coordinator runs these independent operations concurrently:

- stale Gemini OAuth login cleanup under `profilesRoot`;
- stale Antigravity login cleanup under the application temp login root;
- stale pending Gemini profile-registration cleanup.

`profiles:list` does not wait for maintenance because profile scanning already excludes pending login and registration names. Operations that create or finalize pending state, especially `oauthLogin:start`, wait for the coordinator's settled result before proceeding. This prevents a newly created login session from racing an older cleanup pass.

Cleanup failures keep their current nonfatal behavior: they are recorded through the existing diagnostic logger, contain no credential payloads, and do not prevent the main window from opening. Awaiting callers wait for completion, not success, so an unrelated stale directory cannot permanently disable new login.

### Boundary

The coordinator only schedules existing cleanup services and exposes a small interface:

```ts
interface StartupMaintenanceCoordinator {
  start(): Promise<void>;
  waitUntilSettled(): Promise<void>;
}
```

Calling either method repeatedly returns the same promise. Cleanup implementation details remain in `oauthLoginService.ts` and `profileService.ts`.

## Access Token Reuse

### Problem

Usage queries can refresh an expired OAuth access token and then discard the refreshed token after one request. A later explicit usage query in the same application session can repeat the token endpoint request before calling the quota endpoint.

### Design

Add a main-process, memory-only access token cache shared by the Gemini and Antigravity usage paths through a small injected interface.

```ts
interface AccessTokenCache {
  get(key: string, nowMs: number): string | undefined;
  set(key: string, token: string, expiresAtMs: number): void;
  invalidate(key: string): void;
}
```

Cache keys are derived from nonreversible credential identity data already available inside the main process, such as the target tool plus credential payload hash. Raw access tokens, refresh tokens, file contents, email addresses, and profile names are not used as keys or logged.

Token refresh functions return the access token together with its expiry. The cache applies a safety margin before the provider expiry. If expiry metadata is absent or invalid, the token receives a conservative short lifetime rather than an assumed full OAuth lifetime.

Each usage query still calls the quota endpoint. Therefore the existing "query" and "query again" actions continue to retrieve current quota data. Only the redundant token refresh request is skipped.

Concurrent refreshes for the same cache key share one in-flight promise. A 401 response invalidates the cached token and permits the existing single refresh-and-retry behavior. A changed credential payload naturally creates a different key and cannot reuse the previous account's token.

The cache is cleared automatically when the Electron main process exits. It is never exposed through preload or renderer IPC and is never written to settings or diagnostics.

## Renderer Isolation

### Problem

`App.tsx` owns settings, update state, status fading, relative-time ticking, profile actions, usage state, and all row callback creation. Updating one profile's usage or loading animation causes every `ProfileRow` to render again. The current account count is small, so this is not the dominant baseline cost, but it is the clearest scaling and interaction hotspot.

### Design

Extract an `AccountVault` component that owns only account-table presentation. It receives stable command callbacks that accept a `ProfileInfo` argument instead of one new closure per row.

Wrap `ProfileRow` in `React.memo`. Its props remain row-local primitives or stable references:

- the profile record;
- nickname and usage result for that profile;
- row-specific switching, deleting, and refreshing flags;
- shared disabled state and display mode;
- stable action callbacks.

Move the one-minute relative-time tick from `App` into the component that formats the last-switch timestamp. A relative-time update must not rerender the account vault.

Keep dialogs conditionally mounted as today. Dynamic imports for settings and login dialogs are permitted only if the post-change renderer measurement shows a meaningful initial bundle or parse improvement; code splitting is not required for acceptance.

The refactor must not move filesystem, credential, hash, settings persistence, or usage networking into the renderer.

## Renderer Startup Data Flow

Settings remain the first required IPC result because they select the initial target tool. Once settings resolve, profile loading starts immediately.

Runtime information, update status, and local diagnostics remain parallel requests, but they no longer gate the first profile request. Their results update their existing UI regions when available. Failure of these noncritical requests remains nonfatal and must not replace a successfully loaded account list with an error state.

The renderer continues to ignore stale profile-list responses through the existing request identifier mechanism.

## Error Handling

- Startup maintenance failure: log a safe event and allow the window and normal profile listing to continue.
- Login requested while maintenance runs: retain the existing preparation/loading state while awaiting settlement.
- Cached token rejected with 401: invalidate, refresh once, and retry once.
- Token refresh fails: return the current safe usage failure result; do not return provider response bodies.
- Auxiliary startup IPC fails: leave that optional UI data unavailable without failing profile loading.
- Renderer refactor: preserve existing operation guards so tool switching, profile switching, deletion, and usage refresh cannot enter conflicting states.

## Security

- OAuth files and Credential Manager payloads remain opaque outside main-process services.
- No OAuth payload, access token, refresh token, or provider response body is printed, logged, stored in settings, or sent over IPC.
- The access token cache is process-local and keyed by a hash-derived identity.
- Existing verified writes, rollback behavior, profile-name validation, and pending-directory safety checks remain unchanged.

## Verification

### Automated Tests

- Startup maintenance starts once even when requested by startup and login concurrently.
- Window creation is not awaited behind a deliberately delayed cleanup operation.
- Cleanup rejection is logged and settles without permanently blocking login.
- Concurrent token refreshes for one credential share one provider request.
- A cached refreshed token is reused before expiry and rejected after expiry.
- A credential hash change cannot reuse a previous token.
- A 401 invalidates the cached token and performs at most one refresh-and-retry.
- Existing profile, login, usage, settings, update, and rollback tests continue to pass.

### Runtime Checks

- Repeat the unpacked production launch measurement at least five times before and after the change and compare the median visible-window time.
- Confirm the main window appears while an injected delayed maintenance operation is still unresolved.
- Use React Profiler or an equivalent development-only render counter to confirm that refreshing one profile does not render unrelated rows.
- Query Gemini and Antigravity usage twice with an expired stored access token and confirm that the second query still reaches the quota endpoint but does not repeat the token refresh while the cached token is valid.
- Run `pnpm test`, `pnpm build`, `pnpm dist:win`, and the packaged Windows smoke checks.

## Success Criteria

- Main-window creation no longer waits for stale-session cleanup.
- Clean-start performance does not regress, and delayed cleanup cannot delay the visible window by the cleanup duration.
- Repeated usage queries in one app session avoid redundant access-token refresh requests without serving cached quota data.
- Updating one profile's usage or activity state does not rerender unrelated profile rows.
- Profile switching, deletion, login, current-account registration, settings, tray behavior, and updates retain existing behavior.
- No sensitive credential or token material is added to IPC, settings, diagnostics, test fixtures, or repository history.
