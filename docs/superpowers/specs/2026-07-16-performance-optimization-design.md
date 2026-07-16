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

Implementation is divided into three sequential, independently reviewable milestones:

1. startup maintenance and renderer startup ordering;
2. main-process access-token reuse;
3. renderer row isolation.

Each milestone has its own focused tests and commit. The next milestone does not begin until the previous milestone passes its tests and review. Packaging and the complete Windows smoke check run after all three milestones.

## Non-Goals

- Replacing Electron or changing the required Electron/Vite/React/TypeScript stack.
- Disabling GPU acceleration to reduce the Electron process baseline.
- Persisting OAuth access tokens, refresh tokens, credential payloads, or usage responses.
- Caching profile file hashes across application launches.
- Changing quota endpoints, response mapping, or used-versus-remaining display semantics.
- Redesigning the interface, changing account columns, or adding new settings.
- Adding dialog code splitting or other bundle changes without a separate measured justification.
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

Only these IPC operations wait for maintenance settlement:

- `oauthLogin:start`, because it creates a pending login directory and may prepare an Antigravity credential backup;
- `profiles:gemini:registerCurrent`, because it creates a pending profile-registration directory.

`oauthLogin:inspect`, `oauthLogin:save`, and `oauthLogin:cancel` operate only on sessions created after `oauthLogin:start` has passed the gate, so they do not wait again. `profiles:list`, switching, deletion, Antigravity current-account registration, settings, and usage queries do not create matching pending state and do not wait.

This exhaustive wait list prevents a newly created pending directory from racing an older cleanup pass without adding cleanup latency to unrelated account operations.

Cleanup failures keep their current nonfatal behavior: they are recorded through the existing diagnostic logger, contain no credential payloads, and do not prevent the main window from opening. Awaiting callers wait for completion, not success, so an unrelated stale directory cannot permanently disable new login.

The coordinator obtains the existing lazy diagnostic logger before starting cleanup tasks. The `app.started` log write is independent and is not a prerequisite for cleanup logging. Every diagnostic write remains individually caught, so logging failure cannot reject the maintenance promise.

### Boundary

The coordinator only schedules existing cleanup services and exposes one operation:

```ts
interface StartupMaintenanceCoordinator {
  ensureStarted(): Promise<void>;
}
```

The first `ensureStarted()` call starts maintenance and returns one always-settling process-lifetime promise. Every later call returns that same promise. Startup calls it without awaiting; the two gated IPC handlers await it. Cleanup implementation details remain in `oauthLoginService.ts` and `profileService.ts`.

## Access Token Reuse

### Problem

Usage queries can refresh an expired OAuth access token and then discard the refreshed token after one request. A later explicit usage query in the same application session can repeat the token endpoint request before calling the quota endpoint.

### Design

Add a main-process, memory-only access token session cache shared by the Gemini and Antigravity usage paths through a small injected interface.

```ts
interface RefreshedAccessToken {
  token: string;
  expiresInSeconds?: number;
}

interface AccessTokenSessionCache {
  get(key: string, nowMs: number): string | undefined;
  getOrRefresh(
    key: string,
    nowMs: number,
    refresh: () => Promise<RefreshedAccessToken | undefined>
  ): Promise<string | undefined>;
  invalidateRejected(key: string, rejectedToken: string): void;
}
```

The exact cache key is:

```ts
`${targetTool}:${sha256(rawCredentialPayload)}`
```

For Gemini, `rawCredentialPayload` is the exact byte content read from that profile's OAuth file. For Antigravity, it is the exact credential payload returned by Credential Manager. The raw payload and resulting key remain inside the main process. The target-tool prefix prevents cross-provider reuse, and any credential payload change produces a new key. Access tokens, refresh tokens, email addresses, profile names, and credential paths are not used as keys or logged.

Token refresh functions return the access token together with the provider's `expires_in` value. Cache expiry is calculated as follows:

- a finite positive `expires_in` uses that lifetime;
- missing, nonfinite, or nonpositive metadata uses a five-minute fallback lifetime;
- the safety margin is the smaller of 60 seconds or 10 percent of the selected lifetime;
- the entry expires when `nowMs >= expiresAtMs`;
- entries with less than 10 seconds of usable lifetime after the margin are not cached.

Each usage query still calls the quota endpoint. Therefore the existing "query" and "query again" actions continue to retrieve current quota data. Only the redundant token refresh request is skipped.

The cache owns both the token-entry map and the in-flight refresh-promise map. `getOrRefresh()` follows this order:

1. return a valid cached token;
2. await the existing in-flight promise for the key;
3. otherwise insert one refresh promise before invoking the provider;
4. cache a successful result using the expiry rules above;
5. remove the same in-flight promise in `finally`, including rejection paths.

Each usage query has a fixed authentication recovery budget: one initial quota attempt, at most one token refresh after an HTTP 401, and at most one quota retry. HTTP 403 and other failures are not retried by the cache.

`invalidateRejected()` removes an entry only when the entry still contains the exact token rejected by that caller. If another caller has already stored a newer token, a late 401 for the old token cannot remove it. Concurrent callers then converge on the existing cached token or `getOrRefresh()` promise, so they share one refresh even though each caller performs its own single quota retry.

A changed credential payload naturally creates a different key and cannot reuse the previous account's token.

The cache is cleared automatically when the Electron main process exits. It is never exposed through preload or renderer IPC and is never written to settings or diagnostics.

## Renderer Isolation

### Problem

`App.tsx` owns settings, update state, status fading, relative-time ticking, profile actions, usage state, and all row callback creation. Updating one profile's usage or loading animation causes every `ProfileRow` to render again. The current account count is small, so this is not the dominant baseline cost, but it is the clearest scaling and interaction hotspot.

### Design

Extract a memoized `AccountVault` component that owns only account-table presentation. It receives stable command callbacks created with `useCallback` and accepting a `ProfileInfo` argument instead of one new closure per row.

Wrap `ProfileRow` in `React.memo`. Its props remain row-local primitives or stable references:

- the profile record;
- nickname and usage result for that profile;
- row-specific switching, deleting, and refreshing flags;
- shared disabled state and display mode;
- stable action callbacks.

While usage, status, nickname-dialog, update, or relative-time state changes, `result.profiles` and each contained profile object must retain their existing references. Profile records may all be replaced only when a profile-list request completes, in which case rerendering every row is expected. `AccountVault` may rerender when the usage map changes, but unchanged rows receive the same profile object, usage object, primitive flags, and callback references and therefore remain memoized.

The row callback contract is explicit:

```ts
type ProfileCommand = (profile: ProfileInfo) => void;
```

`AccountVault` passes the same command function to every row. A row may create its DOM event closure internally because that closure is recreated only when that row itself renders.

Move the one-minute relative-time tick from `App` into the component that formats the last-switch timestamp. A relative-time update must not rerender the account vault.

Keep dialogs conditionally mounted as today. Dynamic imports and dialog bundle splitting are outside this implementation.

The refactor must not move filesystem, credential, hash, settings persistence, or usage networking into the renderer.

## Renderer Startup Data Flow

Settings remain the first required IPC result because they select the initial target tool. Once settings resolve, profile loading starts immediately.

Runtime information, update status, and local diagnostics remain parallel requests, but they no longer gate the first profile request. Their results update their existing UI regions when available. Failure of these noncritical requests remains nonfatal and must not replace a successfully loaded account list with an error state.

The renderer continues to ignore stale profile-list responses through the existing request identifier mechanism.

If the required settings IPC fails, preserve the current safe failure behavior: stop the boot loading state, keep the window visible, show the sanitized error, and do not guess a persisted target tool. The user may still invoke the existing list refresh for the currently displayed default tool. Auxiliary IPC completion must not overwrite that settings error.

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
- `oauthLogin:start` and `profiles:gemini:registerCurrent` wait for maintenance; unrelated IPC handlers do not.
- Concurrent token refreshes for one credential share one provider request.
- A cached refreshed token is reused before expiry and rejected after expiry.
- A credential hash change cannot reuse a previous token.
- Concurrent 401 responses share one refresh request, and each usage query performs no more than two quota attempts.
- A late 401 for an older token cannot invalidate a newer token already stored by another caller.
- Missing or invalid `expires_in`, expiry equality, safety-margin, and too-short-to-cache boundaries follow the specified numeric rules.
- A settings IPC failure remains visible and cannot be overwritten by later auxiliary IPC results.
- Existing profile, login, usage, settings, update, and rollback tests continue to pass.

### Runtime Checks

- Build the unpacked production application with `pnpm pack:win`. Fully terminate all application processes before each run. Start the timer immediately before `Start-Process` and stop it at the first nonzero main-window handle for the launched primary process. Poll every 50 ms, enforce a 20-second timeout, stop the full launched process tree after measurement, and confirm no matching process remains.
- Perform one discarded warm-up followed by five recorded runs in the same Windows login session and power state, with no dev server running. Record all five raw values and compare medians. The post-change median must not exceed the baseline median by more than the larger of 100 ms or 10 percent.
- Confirm through an injected delayed maintenance test that the main-window creation callback completes before the maintenance promise resolves.
- In a fixed three-profile renderer scenario, reset render counters after the initial commit, update only profile A's usage, and require profile A to render once while profiles B and C render zero times. Advancing the last-switch relative-time tick must render all three profile rows zero times. Run the counter outside React Strict Mode or compare commits rather than development double-invocations.
- Query Gemini and Antigravity usage twice with an expired stored access token and confirm that the second query still reaches the quota endpoint but does not repeat the token refresh while the cached token is valid.
- Run `pnpm test`, `pnpm build`, `pnpm dist:win`, and the packaged Windows smoke checks.

## Success Criteria

- Main-window creation no longer waits for stale-session cleanup.
- The five-run startup median stays within the defined 100 ms/10 percent regression tolerance, and delayed cleanup cannot delay the window-creation callback.
- Repeated usage queries in one app session avoid redundant access-token refresh requests without serving cached quota data.
- The fixed three-profile render-counter scenario meets the specified `1/0/0` usage-update and `0/0/0` relative-time expectations.
- Existing automated suites pass unchanged or with focused additions for the three milestones; packaged smoke checks cover profile switching, usage query, settings opening, and clean exit.
- Tests assert that known token sentinel values never appear in IPC results or captured diagnostic calls. The staged diff contains no OAuth credential files or real credential fixtures.
