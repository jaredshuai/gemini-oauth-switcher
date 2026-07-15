# Windows Installer CI Smoke Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub Actions execute a real NSIS custom-directory install and uninstall before any Windows artifact can be uploaded or released.

**Architecture:** Add one PowerShell lifecycle script with explicit installer, temporary-root, and install-directory parameters. It snapshots matching uninstall entries, rejects existing installations, installs into a non-default path containing spaces with `/D` as the final NSIS argument, verifies exact files/registry/shortcuts, then always attempts uninstall and reports any incomplete cleanup. Existing Vitest packaging checks enforce both the script contract and workflow ordering.

**Tech Stack:** PowerShell 7, NSIS command-line switches, GitHub Actions, Vitest.

**Scope:** This CI gate covers installer custom-path handling, files, registry, shortcuts, and uninstall cleanup. Packaged UI rendering, settings persistence, single-instance behavior, credential invariants, default-directory installation, and auto-update remain release smoke checks in `docs/release-smoke-test.md`.

---

## Chunk 1: Installer Lifecycle Gate

### Task 1: Define the packaging contract with a failing test

**Files:**
- Modify: `tests/packaging.test.ts`

- [ ] **Step 1: Add the workflow-ordering test**

Add a test that reads `.github/workflows/windows-build.yml` and `scripts/smoke-test-windows-installer.ps1`, then asserts:

```ts
const artifactVerification = workflow.indexOf("Verify Windows release artifacts");
const installerSmoke = workflow.indexOf("Smoke test NSIS installer lifecycle");
const artifactUpload = workflow.indexOf("Upload build artifacts");
const githubRelease = workflow.indexOf("Create GitHub Release");

expect(artifactVerification).toBeGreaterThanOrEqual(0);
expect(installerSmoke).toBeGreaterThan(artifactVerification);
expect(artifactUpload).toBeGreaterThan(installerSmoke);
expect(githubRelease).toBeGreaterThan(installerSmoke);
expect(workflow).toContain("./scripts/smoke-test-windows-installer.ps1");
expect(workflow).toContain("Custom Install With Spaces");
expect(script).toContain("TemporaryRoot");
expect(script).toContain('ArgumentList @("/S", "/D=$InstallDirectory")');
expect(script).toContain("Get-MatchingUninstallEntries");
expect(script).toContain("UninstallString");
expect(script).toContain('[Environment]::GetFolderPath("Programs")');
```

- [ ] **Step 2: Add the existing-target negative test**

On Windows, create a temporary root, pre-create its intended install directory, and write `sentinel.txt`. Invoke the PowerShell script with `process.execPath` as an existing but non-installer executable. Assert the command throws, the output contains `Install directory already exists`, and `sentinel.txt` remains unchanged. This proves validation aborts before starting the supplied executable.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
pnpm test tests/packaging.test.ts
```

Expected: FAIL because `scripts/smoke-test-windows-installer.ps1` does not exist and the workflow has no smoke step. The negative test must fail for the missing script, not because its sentinel setup is invalid.

### Task 2: Implement the isolated PowerShell smoke test

**Files:**
- Create: `scripts/smoke-test-windows-installer.ps1`

- [ ] **Step 1: Define the parameter contract**

Use this public parameter surface:

```powershell
param(
  [Parameter(Mandatory)] [string] $InstallerPath,
  [Parameter(Mandatory)] [string] $TemporaryRoot,
  [Parameter(Mandatory)] [string] $InstallDirectory,
  [string] $ProductName = "Gemini OAuth Switcher",
  [string] $ExecutableName = "Gemini OAuth Switcher.exe",
  [string] $UninstallerName = "Uninstall Gemini OAuth Switcher.exe",
  [string] $ShortcutName = "Gemini OAuth Switcher",
  [string] $ExpectedDefaultInstallDirectory,
  [int] $ProcessTimeoutSeconds = 120
)
```

- [ ] **Step 2: Validate canonical paths before mutation**

Require the installer to be an existing file. Require `TemporaryRoot` to be an existing directory. Resolve both `TemporaryRoot` and the not-yet-created `InstallDirectory` to canonical absolute paths, then replace `$InstallDirectory` with that canonical value before it is used in `/D`, verification, or cleanup. Reject the install directory unless it is a non-existing strict descendant of the temporary root. Fail closed on path inspection errors and reject reparse points in the existing ancestor/component chain.

Expected failure messages include `Installer does not exist`, `Temporary root does not exist`, `Install directory must be a strict child of the temporary root`, and `Install directory already exists`.

- [ ] **Step 3: Reject existing product state**

Implement `Get-MatchingUninstallEntries` over `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*`, matching display names equal to `$ProductName` or beginning with `$ProductName + " "`. Snapshot matching `PSPath` values and fail before installation when any matching entry, desktop shortcut, or Start Menu shortcut already exists.

- [ ] **Step 4: Install with the regression-sensitive argument order**

Run the installer with a bounded process helper that terminates the process tree after `ProcessTimeoutSeconds`:

```powershell
Start-Process -FilePath $resolvedInstaller `
  -ArgumentList @("/S", "/D=$InstallDirectory") `
  -WindowStyle Hidden -PassThru
```

`/D` must be the final argument. Require exit code `0`.

- [ ] **Step 5: Verify exact installation state**

Wait up to 30 seconds for these conditions:

- `$InstallDirectory\$ExecutableName` exists.
- `$InstallDirectory\$UninstallerName` exists.
- Exactly one new matching HKCU uninstall entry exists.
- The executable path parsed from its quoted `UninstallString` canonically equals the expected uninstaller path.
- The uninstall command contains `/currentuser`.
- `[Environment]::GetFolderPath("Desktop")\$ShortcutName.lnk` exists.
- `[Environment]::GetFolderPath("Programs")\$ShortcutName.lnk` exists.

Do not require an uninstall-registry `InstallLocation` value because electron-builder does not write one in the current installer.

- [ ] **Step 6: Uninstall from `finally`**

Select the cleanup uninstaller from the expected path, or from the newly created uninstall entry if `/D` was ignored. Never use an entry present in the pre-install snapshot. Canonically derive `$ActualInstallDirectory` from the selected uninstaller path. Run it with `@("/S", "/currentuser")`, require exit code `0`, and wait for the new registry entry, requested install directory, actual install directory, desktop shortcut, and Start Menu shortcut to disappear.

- [ ] **Step 7: Preserve failures while cleaning partial state**

If the requested or actual install directory remains, record cleanup as failed. Recursively remove a normal directory only when its canonical path is a strict descendant of `TemporaryRoot`; remove an in-root reparse point without traversal; report but never delete an outside-root directory. Never delete an existing uninstall entry. Throw a combined error when installation verification or cleanup fails; fallback deletion must not turn the test green.

- [ ] **Step 8: Print a stable success line**

On success print:

```text
NSIS installer lifecycle smoke test passed: <install-directory>
```

### Task 3: Add the CI gate

**Files:**
- Modify: `.github/workflows/windows-build.yml`

- [ ] **Step 1: Add the step immediately after artifact verification**

Use:

```yaml
- name: Smoke test NSIS installer lifecycle
  shell: pwsh
  run: |
    $installers = @(Get-ChildItem -Path release -Filter 'Gemini-OAuth-Switcher-*-setup-x64.exe')
    if ($installers.Count -ne 1) {
      throw "Expected exactly one NSIS installer, found $($installers.Count)."
    }

    $temporaryRoot = Join-Path $env:RUNNER_TEMP ("gemini-oauth-switcher-installer-smoke-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null
    $installDirectory = Join-Path $temporaryRoot 'Custom Install With Spaces'

    $expectedDefaultInstallDirectory = Join-Path $env:LOCALAPPDATA 'Programs\Gemini OAuth Switcher'
    "NSIS_SMOKE_TEMPORARY_ROOT=$temporaryRoot" >> $env:GITHUB_ENV

    & ./scripts/smoke-test-windows-installer.ps1 `
      -InstallerPath $installers[0].FullName `
      -TemporaryRoot $temporaryRoot `
      -InstallDirectory $installDirectory `
      -ExpectedDefaultInstallDirectory $expectedDefaultInstallDirectory
```

- [ ] **Step 2: Keep publication after the gate**

Add an `if: always()` cleanup step that validates the GUID directory is a strict child of `RUNNER_TEMP` and removes it without following reparse points. Confirm `Upload build artifacts` and `Create GitHub Release` remain below both smoke steps.

### Task 4: Verify locally and commit

**Files:**
- Test: `tests/packaging.test.ts`
- Test: `scripts/smoke-test-windows-installer.ps1`
- Temporary: `.tmp/nsis-ci-smoke/electron-builder.smoke.json`

- [ ] **Step 1: Run the focused test and verify GREEN**

Run `pnpm test tests/packaging.test.ts`. Expected: all packaging tests pass.

- [ ] **Step 2: Build a temporary isolated installer identity**

Create ignored `.tmp/nsis-ci-smoke/electron-builder.smoke.json` with unique values:

```json
{
  "appId": "local.gemini-oauth-switcher.ci-smoke",
  "productName": "Gemini OAuth Switcher CI Smoke",
  "directories": { "output": ".tmp/nsis-ci-smoke/release" },
  "publish": null,
  "files": ["dist/**/*", "dist-electron/**/*", "package.json"],
  "extraResources": [{ "from": "assets", "to": "assets", "filter": ["**/*"] }],
  "win": {
    "icon": "assets/app-icon.ico",
    "executableName": "Gemini OAuth Switcher CI Smoke",
    "target": [{ "target": "nsis", "arch": ["x64"] }]
  },
  "nsis": {
    "guid": "2059bfb0-1d75-4ff4-b1bb-1b4a640a55bc",
    "artifactName": "Gemini-OAuth-Switcher-CI-Smoke-${version}-setup-${arch}.${ext}",
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Gemini OAuth Switcher CI Smoke",
    "deleteAppDataOnUninstall": false
  }
}
```

Build with:

```powershell
pnpm build
pnpm exec electron-builder --config .tmp/nsis-ci-smoke/electron-builder.smoke.json --win nsis --publish never
```

- [ ] **Step 3: Run the real lifecycle smoke test**

Run:

```powershell
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location) '.tmp\nsis-ci-smoke\runtime'))
New-Item -ItemType Directory -Force -Path $temporaryRoot | Out-Null
$installDirectory = Join-Path $temporaryRoot 'Custom Install With Spaces'
$installer = @(Get-ChildItem '.tmp\nsis-ci-smoke\release' -Filter 'Gemini-OAuth-Switcher-CI-Smoke-*-setup-x64.exe')
if ($installer.Count -ne 1) { throw "Expected one isolated installer." }

pwsh -NoLogo -NoProfile -NonInteractive -File ./scripts/smoke-test-windows-installer.ps1 `
  -InstallerPath $installer[0].FullName `
  -TemporaryRoot $temporaryRoot `
  -InstallDirectory $installDirectory `
  -ProductName 'Gemini OAuth Switcher CI Smoke' `
  -ExecutableName 'Gemini OAuth Switcher CI Smoke.exe' `
  -UninstallerName 'Uninstall Gemini OAuth Switcher CI Smoke.exe' `
  -ShortcutName 'Gemini OAuth Switcher CI Smoke' `
  -ExpectedDefaultInstallDirectory (Join-Path $env:LOCALAPPDATA 'Programs\Gemini OAuth Switcher CI Smoke')
```

Expected: success line, no matching smoke registry entry, no desktop or Start Menu shortcut, and no requested or actual install directory after completion.

- [ ] **Step 4: Run full verification**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm dist:win
pnpm verify:windows-artifacts
```

Expected: all tests pass, typecheck exits `0`, builder exits `0`, and all four Windows release artifacts verify.

- [ ] **Step 5: Commit only tracked implementation files**

Commit `tests/packaging.test.ts`, `scripts/smoke-test-windows-installer.ps1`, `.github/workflows/windows-build.yml`, and this plan. Do not commit `.tmp/` or `.impeccable/`.

## Chunk 2: Stable Patch Release

### Task 5: Merge verified hardening into main

**Files:** None beyond Git history.

- [ ] Push `codex/stability-hardening`, run `gh workflow run windows-build.yml --ref codex/stability-hardening`, and confirm the manually dispatched workflow succeeds on the exact branch SHA.
- [ ] Fast-forward `main` to the verified branch and push `main`.
- [ ] Wait for the `main` workflow on the exact merged SHA to succeed before changing the version.

### Task 6: Prepare the v0.3.1 release commit

**Files:**
- Modify: `package.json`

- [ ] Change only `package.json` version from `0.3.0` to `0.3.1`; `pnpm-lock.yaml` and dependency versions must remain unchanged.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, `pnpm dist:win`, and `pnpm verify:windows-artifacts`.
- [ ] Re-run the isolated NSIS lifecycle smoke against the `0.3.1` build.
- [ ] Confirm the previously completed packaged UI, single-instance, settings-recovery, credential-invariant, and logging checks still apply because the release commit changes version metadata only.
- [ ] Commit `chore: release v0.3.1` and push `main` without a tag.
- [ ] Wait for the `main` workflow on the release commit SHA to succeed.

Unsigned release approval is already explicit in the project history: `v0.3.1` may remain unsigned and the workflow must retain its SmartScreen warning.

### Task 7: Tag and verify publication

**Files:** None beyond Git history.

- [ ] Verify remote tag `v0.3.1` does not exist and `HEAD` equals the successful `main` workflow SHA.
- [ ] Create annotated tag `v0.3.1` and push only the tag.
- [ ] Wait for the tag workflow to succeed, including artifact verification and NSIS lifecycle smoke.
- [ ] Download setup, portable, blockmap, and `latest.yml` from the GitHub Release into a temporary directory.
- [ ] Run `node scripts/verify-windows-artifacts.mjs --release-dir <download-directory>` and require success.
- [ ] Never move or overwrite a published tag or its assets. Any correction is a new patch release.

### Task 8: Complete the real automatic-update check

**Files:** None.

- [ ] Keep the existing installed `v0.3.0` untouched until `v0.3.1` is public.
- [ ] Open the installed `v0.3.0`, manually trigger update checking, and verify it reports `0.3.1` from the public release.
- [ ] Download and install the update through the application.
- [ ] Verify the application relaunches as `0.3.1` with window preferences, selected tool, nicknames, Gemini profile list, and Antigravity account registrations preserved.
- [ ] Verify no credential payload was logged or modified by the update itself.
- [ ] Verify the portable `0.3.1` build continues to present manual-update behavior.
- [ ] If the public update path fails, do not alter `v0.3.1`; diagnose and publish the correction as `v0.3.2`.
