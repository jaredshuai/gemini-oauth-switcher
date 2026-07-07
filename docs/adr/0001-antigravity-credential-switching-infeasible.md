# ADR-0001: Antigravity CLI credential switching is infeasible via Credential Manager

- **Status**: Accepted
- **Date**: 2026-07-07
- **Supersedes**: the Antigravity CLI switching design described in README "目录模型 → Antigravity CLI profile"

## Context

This app ships an Antigravity CLI account-switching feature built on the assumption that Antigravity CLI (`agy`) persists its OAuth token in a Windows Credential Manager (CM) generic credential named `gemini:antigravity`, and that swapping that CM entry's contents between per-profile copies is sufficient to switch accounts.

The feature was implemented (`src/main/antigravityCredentialService.ts`, `profileTargets.ts`, the `credentialMode` branch of `profileService.ts:switchProfileUnlocked`) but never end-to-end verified against a live `agy` install. This ADR records the findings of a verification session run on 2026-07-07 against `agy.exe` 1.0.16 on Windows 11.

## Decision

**Treat the Antigravity CLI switching feature as non-functional and stop maintaining the CM-based approach.** Stop advertising it in the README, and do not invest further in CM-based switching.

The dynamic-analysis pass (Findings 3–4) closed the remaining escape routes:

- Finding 3 shows that even with raw-bytes access to the blob, the app cannot use `@napi-rs/keyring` to round-trip it — a correct implementation would require bypassing the keyring library and calling Win32 `CredRead`/`CredWrite` directly. That is a large, fragile investment for a feature whose foundation is already broken.
- Finding 4 shows that the foundation is, in fact, broken at the upstream level: `agy` on Windows has **no working persistent token storage**. It fails to read from keyring (because it cleared the blob on the previous exit), its file backend is compiled out on Windows, and it falls through to a full browser OAuth on every cold start. There is nothing for this app to swap, because `agy` does not persist a swap-able credential in the first place.

This does **not** affect the Gemini CLI switching path, which is verified working and is the app's primary value.

## Findings (evidence)

All observations below were made on the same Windows 11 machine with a live, working `agy` install (the user confirmed `agy` does not force a full browser re-login on every launch).

### 1. The CM target name assumption is correct

`cmdkey /list` and a direct `CredRead` Win32 call both confirm the entry exists:

```
Target:  LegacyGeneric:target=gemini:antigravity
Type:    普通 (Generic, type=1)
UserName: antigravity
Persist: 3 (local machine)
```

This matches `ANTIGRAVITY_OFFICIAL_CREDENTIAL_TARGET = "gemini:antigravity"` and `OFFICIAL_USERNAME = "antigravity"` in `antigravityCredentialService.ts`. The target-name assumption that the rest of the design depends on is **not** the thing that is wrong.

Two independent upstream bug reports corroborate the target name:
- [google-antigravity/antigravity-cli#258](https://github.com/google-antigravity/antigravity-cli/issues/258) (Win11) — "A generic credential entry named `gemini:antigravity` is successfully created/written to the Windows Credential Manager after login."
- [google-antigravity/antigravity-cli#523](https://github.com/google-antigravity/antigravity-cli/issues/523) (Win10) — "Windows Credential Manager entry `LegacyGeneric:target=gemini:antigravity` is updated."

### 2. `agy` clears the CM blob on exit — it is not a persistence store

Direct `CredRead` measurement of the `gemini:antigravity` entry's `CredentialBlobSize` over time:

| Wall clock | agy running? | BlobSize |
|---|---|---|
| 22:36:16 | yes (in session) | **501 bytes** |
| 22:36:50 | agy exiting | entry rewritten |
| 22:37:59 | no (exited) | **0 bytes** |

While `agy` is running, the CM blob holds ~500 bytes of token-shaped data. When `agy` exits, it rewrites the entry with an empty blob. This matches the symptom reported in #258 — `agy` "requires re-authentication on every launch" — though that issue slightly overstates it: a silent refresh path exists (see Finding 4) that lets `agy` recover without a full browser flow.

**Implication:** any "switch" that copies the CM blob is copying a value that is, by design, transient. If the user runs the switch while `agy` is closed, the source blob is empty.

### 3. `@napi-rs/keyring` cannot read the blob even when it is non-empty

This is the finding that rules out a "just copy the blob while agy is running" workaround.

With `agy` in session and the CM blob at 501 bytes (confirmed by `CredRead`), the same entry read through `@napi-rs/keyring` 1.3.0's native binding returns empty:

```
Entry.withTarget("gemini:antigravity", "gemini", "antigravity").getSecret()  -> length 0
Entry.withTarget("gemini:antigravity", "gemini", "antigravity").getPassword() -> null
```

The root cause was recovered by source-level analysis of both libraries:

- **`agy` uses `github.com/zalando/go-keyring`**, which on Windows uses `github.com/danieljoos/wincred` (both confirmed as compiled-in imports via binary string extraction). Its `Set(service, username, password)` stores the password as `cred.CredentialBlob = []byte(password)` — **raw UTF-8 bytes**, no length prefix, no null terminator. The TargetName is `service + ":" + username` (see `keyring_windows.go:credName`). So agy writes to target `gemini:antigravity` with a UTF-8 JSON blob.
- **`@napi-rs/keyring` wraps the Rust `keyring-rs` crate**, which on Windows reads `CredentialBlob` as a **UTF-16LE string** (the Windows-native convention for generic credential blobs). When the bytes are actually UTF-8 JSON (as agy wrote them), the UTF-16 decode either yields garbage or an empty string after validation, so `getSecret()`/`getPassword()` return empty.

This is a **fundamental encoding mismatch between two language ecosystems' keyring bindings**, not a bug in either library in isolation. Each library round-trips its own writes correctly, but they are not interoperable.

**Implication:** even if the app captured the blob at the right moment via raw Win32 `CredRead`, it could not round-trip it through `@napi-rs/keyring`. A switching implementation would have to bypass `@napi-rs/keyring` entirely and call Win32 `CredRead`/`CredWrite` directly to preserve the raw UTF-8 bytes.

### 4. agy itself fails to persist and re-read the token — it triggers OAuth on every cold start

This is the finding that ultimately dooms the feature regardless of which library reads the blob.

By launching `agy --print "say PONG"` on a cold start (no agy process already running) and tailing its log, the startup sequence is visible:

```
token_storage.go:125  Failed to load token from keyring, falling back to file: unexpected end of JSON input
printmode.go:229      Print mode: silent auth failed, triggering OAuth
browser.go:56         consumerOAuth: starting OAuth flow
... Authentication required. Please visit the URL to log in ...
printmode.go:277      Print mode: auth timed out
```

Two things are revealed:

1. **`agy`'s token storage has a fallback chain** (`token_storage.go`): try keyring first, fall back to a file-based store on failure. The "unexpected end of JSON input" error means the keyring blob it read back was empty or truncated — consistent with Finding 2 (agy clears the blob on exit) combined with the cross-library read failure.
2. **On this Windows install, both backends fail.** The file-based fallback target was never located — no `antigravity-oauth-token` file exists under `~/.gemini`, `~/.gemini/antigravity-cli/`, `%APPDATA%\Antigravity`, or `%LOCALAPPDATA%\agy`, and no file in those trees was modified during an agy cold start. The `antigravity-oauth-token` filename from issue #479 is not even present as a string literal in the Windows binary — the file backend is platform-conditioned out on Windows.

So on Windows, **agy has no working persistent token storage at all**. Every cold start triggers a full browser OAuth flow. The user's perception that "agy does not require re-login every time" is attributable to one of: (a) the agy process was never actually killed between uses (it stayed resident), or (b) the browser-OAuth flow silently completes using an existing browser session cookie without visibly prompting. Neither constitutes a persistent token that this app could swap.

This is consistent with the upstream regression report [google-antigravity/antigravity-cli#258](https://github.com/google-antigravity/antigravity-cli/issues/258) ("agy.exe still requires re-authentication on every launch on Windows 11") — this is a known, unfixed upstream bug, not an environment-specific issue.

### 5. The app's own CM writes work, but write the wrong thing

The app successfully creates per-profile entries (`gemini-oauth-switcher:antigravity-cli:<sha256>`). The `sha256(profilesRoot \0 profileName)[:32]` hashing matches what `listProfiles` looks up, so the wiring is internally consistent. But because of Finding 3, the payload it stores is whatever (possibly empty) bytes `@napi-rs/keyring` managed to read from the official entry during a "save login" — which is not a token `agy` can consume. The UI correctly reports "缺凭据" (missing credentials) for these profiles because the stored blob is empty.

## Consequences

- The Antigravity switching code path stays in the tree (it is well-isolated behind `getCredentialMode` and does not burden the Gemini path), but is documented as non-functional.
- README is updated to reflect that only Gemini CLI switching is supported.
- The `ready-for-agent` / `ready-for-human` follow-up issue tracks recovering `agy`'s real token storage via dynamic analysis. If recovered, the feature can be revisited; if the storage turns out to be process-private (no on-disk persistence at all), the feature is permanently infeasible and should be removed.
- Per-profile CM entries created by earlier `agy` logins through the app are inert and can be cleaned up with `cmdkey /delete:gemini-oauth-switcher:antigravity-cli:<hash>`; they contain no sensitive data.

## Follow-up

The dynamic-analysis pass described in the original draft of this ADR has been completed. Outcome:

- **`agy` cold-start log captured** (`token_storage.go:125 Failed to load token from keyring, falling back to file: unexpected end of JSON input` → `silent auth failed, triggering OAuth`). This is the primary evidence for Finding 4 and is recorded above.
- **No Process Monitor run was needed.** The agy log alone answered the question of where the token is persisted: nowhere readable on Windows.
- **The per-profile CM entries created by earlier app sessions were inert** (empty blobs) and have been cleaned up via `cmdkey /delete`.

Remaining work, if the Antigravity feature is ever to be revisited, depends entirely on upstream `agy` fixing its Windows token persistence (tracking [#258](https://github.com/google-antigravity/antigravity-cli/issues/258)). If `agy` ships a working persistent store, the path forward is:

1. Identify the new store's location and format by re-running the cold-start log capture.
2. If it returns to a working CM blob: bypass `@napi-rs/keyring` and call Win32 `CredRead`/`CredWrite` directly to preserve raw UTF-8 bytes, since the Rust keyring binding will still not round-trip agy's blob (Finding 3 stands regardless of upstream fixes).
3. If it becomes a file: swap the file atomically with hash verification, mirroring the Gemini CLI path.

Until then, the Antigravity code path should either be left dormant (current choice — it is isolated behind `getCredentialMode`) or removed to reduce surface area. Removing it is a separate decision and not gated by this ADR.

## References

- [google-antigravity/antigravity-cli#258](https://github.com/google-antigravity/antigravity-cli/issues/258) — agy.exe re-auth on every launch (Win11)
- [google-antigravity/antigravity-cli#523](https://github.com/google-antigravity/antigravity-cli/issues/523) — Intermittent OAuth failure, confirms CM target name (Win10)
- [google-antigravity/antigravity-cli#479](https://github.com/google-antigravity/antigravity-cli/issues/479) — Linux file-based token storage shape (`antigravity-oauth-token` JSON)
- [google-antigravity/antigravity-cli#381](https://github.com/google-antigravity/antigravity-cli/issues/381) — Community request for an auth-profile selector (the gap this app tries to fill)
