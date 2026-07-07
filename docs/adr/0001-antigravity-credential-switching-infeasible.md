# ADR-0001: Antigravity CLI credential switching is infeasible via Credential Manager

- **Status**: Accepted
- **Date**: 2026-07-07
- **Supersedes**: the Antigravity CLI switching design described in README "目录模型 → Antigravity CLI profile"

## Context

This app ships an Antigravity CLI account-switching feature built on the assumption that Antigravity CLI (`agy`) persists its OAuth token in a Windows Credential Manager (CM) generic credential named `gemini:antigravity`, and that swapping that CM entry's contents between per-profile copies is sufficient to switch accounts.

The feature was implemented (`src/main/antigravityCredentialService.ts`, `profileTargets.ts`, the `credentialMode` branch of `profileService.ts:switchProfileUnlocked`) but never end-to-end verified against a live `agy` install. This ADR records the findings of a verification session run on 2026-07-07 against `agy.exe` 1.0.16 on Windows 11.

## Decision

**Treat the Antigravity CLI switching feature as non-functional.** Stop advertising it in the README, gate it behind an explicit "experimental / blocked by upstream" notice in the UI, and do not invest further in CM-based switching until `agy`'s token persistence model is documented or the storage location is recovered through dynamic analysis. See the "Follow-up" section.

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

`@napi-rs/keyring` wraps the Rust [`keyring-rs`](https://github.com/hwchen/keyring-rs) crate. `agy` is a Go binary and uses a Go keyring library (the `keyring.go` symbol appears in its logs). The two language ecosystems' keyring libraries disagree on how the Windows `CredentialBlob` is encoded (likely UTF-16 null-terminated vs raw bytes / UTF-8), so each can only read what it wrote.

**Implication:** even if the app captured the blob at the right moment, the bytes it reads via `@napi-rs/keyring` are not the bytes `agy` would accept on the next launch. The credential store is not a shared, language-neutral API surface here; it is effectively a private serialization format per library.

### 4. The refresh token's persistence location is unknown

The user reports `agy` does not force a full browser re-login on every launch, which implies a `refresh_token` is being persisted somewhere and used for a silent refresh on startup. We were unable to locate it. Search results:

- No file under `~/.gemini`, `~/.gemini/antigravity-cli/`, `%APPDATA%\Antigravity`, `%LOCALAPPDATA%\agy` contains the string `refresh_token` (the only hit is inside `agy.exe` itself, as a code string literal).
- `~/.gemini/antigravity-cli/settings.json` holds user preferences (color scheme, hooks, model, trusted workspaces) — account-independent, unchanged between account A and account B logins.
- `~/.gemini/antigravity-cli/implicit/*.pb` are protobuf conversation-state blobs, not credentials.
- No CM entry other than `gemini:antigravity` is touched by an `agy` login; in particular there is no second `gemini-cli-api-key/...` entry on this install (that entry, mentioned in #523, appears only when an API-key auth mode is used, not OAuth).
- The CM `CREDENTIAL`'s `Comment`, `Attributes`, and `TargetAlias` fields are all empty on both the official and the per-profile entries.

Candidate locations not yet ruled out: DPAPI-encrypted blobs in the registry, an `agy`-private memory-mapped file, or a `zalando/go-keyring`-specific attribute encoding that the Win32 `CredRead` struct marshalling in this session failed to surface. Resolving this requires dynamic analysis (see Follow-up).

### 5. The app's own CM writes work, but write the wrong thing

The app successfully creates per-profile entries (`gemini-oauth-switcher:antigravity-cli:<sha256>`). The `sha256(profilesRoot \0 profileName)[:32]` hashing matches what `listProfiles` looks up, so the wiring is internally consistent. But because of Finding 3, the payload it stores is whatever (possibly empty) bytes `@napi-rs/keyring` managed to read from the official entry during a "save login" — which is not a token `agy` can consume. The UI correctly reports "缺凭据" (missing credentials) for these profiles because the stored blob is empty.

## Consequences

- The Antigravity switching code path stays in the tree (it is well-isolated behind `getCredentialMode` and does not burden the Gemini path), but is documented as non-functional.
- README is updated to reflect that only Gemini CLI switching is supported.
- The `ready-for-agent` / `ready-for-human` follow-up issue tracks recovering `agy`'s real token storage via dynamic analysis. If recovered, the feature can be revisited; if the storage turns out to be process-private (no on-disk persistence at all), the feature is permanently infeasible and should be removed.
- Per-profile CM entries created by earlier `agy` logins through the app are inert and can be cleaned up with `cmdkey /delete:gemini-oauth-switcher:antigravity-cli:<hash>`; they contain no sensitive data.

## Follow-up

Dynamic analysis plan (tracked separately):
1. Run `agy` under Sysinternals Process Monitor and filter for `Reg*` and `CreateFile`/`ReadFile` operations in the first ~5 seconds of startup, before the `Auth succeeded` log line.
2. Cross-reference any registry value or file `agy` reads at startup with the stored `refresh_token` shape (JSON with `access_token` / `refresh_token` / `expiry`, per #479's Linux findings).
3. If found and on-disk: a new switching strategy that swaps that file becomes possible.
4. If found and in a registry DPAPI blob: switching is technically possible but requires DPAPI interop from Electron, which is a much larger investment.

## References

- [google-antigravity/antigravity-cli#258](https://github.com/google-antigravity/antigravity-cli/issues/258) — agy.exe re-auth on every launch (Win11)
- [google-antigravity/antigravity-cli#523](https://github.com/google-antigravity/antigravity-cli/issues/523) — Intermittent OAuth failure, confirms CM target name (Win10)
- [google-antigravity/antigravity-cli#479](https://github.com/google-antigravity/antigravity-cli/issues/479) — Linux file-based token storage shape (`antigravity-oauth-token` JSON)
- [google-antigravity/antigravity-cli#381](https://github.com/google-antigravity/antigravity-cli/issues/381) — Community request for an auth-profile selector (the gap this app tries to fill)
