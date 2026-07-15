[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$TemporaryRoot,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$InstallDirectory,

  [ValidateNotNullOrEmpty()]
  [string]$ProductName = "Gemini OAuth Switcher",

  [ValidateNotNullOrEmpty()]
  [string]$ExecutableName = "Gemini OAuth Switcher.exe",

  [ValidateNotNullOrEmpty()]
  [string]$UninstallerName = "Uninstall Gemini OAuth Switcher.exe",

  [ValidateNotNullOrEmpty()]
  [string]$ShortcutName = "Gemini OAuth Switcher"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-CanonicalExistingFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $item = Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer) {
    throw "Expected a file but found a directory: $Path"
  }

  $resolved = Resolve-Path -LiteralPath $item.FullName
  return [System.IO.Path]::GetFullPath($resolved.ProviderPath)
}

function Get-CanonicalExistingDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $item = Get-Item -LiteralPath $Path -Force
  if (-not $item.PSIsContainer) {
    throw "Expected a directory but found a file: $Path"
  }

  $resolved = Resolve-Path -LiteralPath $item.FullName
  $fullPath = [System.IO.Path]::GetFullPath($resolved.ProviderPath)
  return [System.IO.Path]::TrimEndingDirectorySeparator($fullPath)
}

function Get-CanonicalDirectoryPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  return [System.IO.Path]::TrimEndingDirectorySeparator($fullPath)
}

function Test-StrictDescendant {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Candidate,

    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  $candidatePath = [System.IO.Path]::TrimEndingDirectorySeparator([System.IO.Path]::GetFullPath($Candidate))
  $rootPath = [System.IO.Path]::TrimEndingDirectorySeparator([System.IO.Path]::GetFullPath($Root))
  if ([string]::Equals($candidatePath, $rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }

  $separator = [string][System.IO.Path]::DirectorySeparatorChar
  $rootPrefix = if ($rootPath.EndsWith($separator)) { $rootPath } else { "$rootPath$separator" }
  return $candidatePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-MatchingUninstallEntries {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedProductName
  )

  $uninstallRoot = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  if (-not (Test-Path -LiteralPath $uninstallRoot)) {
    return @()
  }

  foreach ($key in @(Get-ChildItem -LiteralPath $uninstallRoot)) {
    $properties = Get-ItemProperty -LiteralPath $key.PSPath
    $displayNameProperty = $properties.PSObject.Properties["DisplayName"]
    if ($null -eq $displayNameProperty) {
      continue
    }

    $displayName = [string]$displayNameProperty.Value
    $isMatch = [string]::Equals($displayName, $ExpectedProductName, [System.StringComparison]::Ordinal) -or
      $displayName.StartsWith("$ExpectedProductName ", [System.StringComparison]::Ordinal)
    if (-not $isMatch) {
      continue
    }

    $uninstallStringProperty = $properties.PSObject.Properties["UninstallString"]
    [pscustomobject]@{
      PSPath = [string]$key.PSPath
      DisplayName = $displayName
      UninstallString = if ($null -eq $uninstallStringProperty) { $null } else { [string]$uninstallStringProperty.Value }
    }
  }
}

function Get-NewMatchingUninstallEntries {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedProductName,

    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.HashSet[string]]$PreexistingPaths
  )

  return @(
    Get-MatchingUninstallEntries -ExpectedProductName $ExpectedProductName |
      Where-Object { -not $PreexistingPaths.Contains([string]$_.PSPath) }
  )
}

function Get-QuotedExecutablePath {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$UninstallString
  )

  $match = [regex]::Match($UninstallString, '^\s*"(?<path>[^"]+)"')
  if (-not $match.Success) {
    throw "UninstallString does not start with a quoted executable path: $UninstallString"
  }

  return [System.IO.Path]::GetFullPath($match.Groups["path"].Value)
}

$installationStarted = $false
$installationError = $null
$cleanupFailures = [System.Collections.Generic.List[string]]::new()
$preexistingEntryPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$newEntries = @()
$expectedExecutablePath = $null
$expectedUninstallerPath = $null
$desktopShortcutPath = $null
$programsShortcutPath = $null
$ActualInstallDirectory = $null

try {
  $InstallerPath = Get-CanonicalExistingFile -Path $InstallerPath
  $TemporaryRoot = Get-CanonicalExistingDirectory -Path $TemporaryRoot
  $InstallDirectory = Get-CanonicalDirectoryPath -Path $InstallDirectory

  if (Test-Path -LiteralPath $InstallDirectory) {
    throw "Install directory already exists: $InstallDirectory"
  }

  if (-not (Test-StrictDescendant -Candidate $InstallDirectory -Root $TemporaryRoot)) {
    throw "Install directory must be a strict descendant of TemporaryRoot: $InstallDirectory"
  }

  $desktopDirectory = [Environment]::GetFolderPath("Desktop")
  $programsDirectory = [Environment]::GetFolderPath("Programs")
  if ([string]::IsNullOrWhiteSpace($desktopDirectory) -or [string]::IsNullOrWhiteSpace($programsDirectory)) {
    throw "Could not resolve the current user's Desktop and Programs folders."
  }

  $desktopShortcutPath = Join-Path -Path $desktopDirectory -ChildPath "$ShortcutName.lnk"
  $programsShortcutPath = Join-Path -Path $programsDirectory -ChildPath "$ShortcutName.lnk"

  $preexistingEntries = @(Get-MatchingUninstallEntries -ExpectedProductName $ProductName)
  foreach ($entry in $preexistingEntries) {
    [void]$preexistingEntryPaths.Add([string]$entry.PSPath)
  }

  if ($preexistingEntries.Count -gt 0) {
    throw "A matching uninstall entry already exists for ProductName '$ProductName'."
  }

  if (Test-Path -LiteralPath $desktopShortcutPath) {
    throw "Desktop shortcut already exists: $desktopShortcutPath"
  }

  if (Test-Path -LiteralPath $programsShortcutPath) {
    throw "Programs shortcut already exists: $programsShortcutPath"
  }

  $expectedExecutablePath = Join-Path -Path $InstallDirectory -ChildPath $ExecutableName
  $expectedUninstallerPath = Join-Path -Path $InstallDirectory -ChildPath $UninstallerName

  $installationStarted = $true
  $installProcess = Start-Process -FilePath $InstallerPath -ArgumentList @("/S", "/D=$InstallDirectory") -WindowStyle Hidden -Wait -PassThru
  if ($installProcess.ExitCode -ne 0) {
    throw "Installer exited with code $($installProcess.ExitCode)."
  }

  $installDeadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $newEntries = @(Get-NewMatchingUninstallEntries -ExpectedProductName $ProductName -PreexistingPaths $preexistingEntryPaths)
    $filesReady = (Test-Path -LiteralPath $expectedExecutablePath -PathType Leaf) -and
      (Test-Path -LiteralPath $expectedUninstallerPath -PathType Leaf)
    $shortcutsReady = (Test-Path -LiteralPath $desktopShortcutPath -PathType Leaf) -and
      (Test-Path -LiteralPath $programsShortcutPath -PathType Leaf)

    if (($filesReady -and $shortcutsReady -and $newEntries.Count -eq 1) -or $newEntries.Count -gt 1) {
      break
    }

    if ([DateTime]::UtcNow -ge $installDeadline) {
      break
    }

    Start-Sleep -Milliseconds 500
  } while ($true)

  $verificationFailures = [System.Collections.Generic.List[string]]::new()
  if (-not (Test-Path -LiteralPath $expectedExecutablePath -PathType Leaf)) {
    [void]$verificationFailures.Add("Expected application executable was not installed: $expectedExecutablePath")
  }

  if (-not (Test-Path -LiteralPath $expectedUninstallerPath -PathType Leaf)) {
    [void]$verificationFailures.Add("Expected uninstaller was not installed: $expectedUninstallerPath")
  }

  if ($newEntries.Count -ne 1) {
    [void]$verificationFailures.Add("Expected exactly one new matching uninstall entry, found $($newEntries.Count).")
  } else {
    $newEntry = $newEntries[0]
    $uninstallString = [string]$newEntry.UninstallString
    try {
      $registeredUninstallerPath = Get-QuotedExecutablePath -UninstallString $uninstallString
      $registeredCanonicalPath = Get-CanonicalExistingFile -Path $registeredUninstallerPath
      $expectedCanonicalPath = Get-CanonicalExistingFile -Path $expectedUninstallerPath
      if (-not [string]::Equals($registeredCanonicalPath, $expectedCanonicalPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        [void]$verificationFailures.Add("Registered uninstaller path '$registeredCanonicalPath' does not match '$expectedCanonicalPath'.")
      }
    } catch {
      [void]$verificationFailures.Add($_.Exception.Message)
    }

    if ($uninstallString.IndexOf("/currentuser", [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
      [void]$verificationFailures.Add("UninstallString does not contain /currentuser: $uninstallString")
    }
  }

  if (-not (Test-Path -LiteralPath $desktopShortcutPath -PathType Leaf)) {
    [void]$verificationFailures.Add("Desktop shortcut was not created: $desktopShortcutPath")
  }

  if (-not (Test-Path -LiteralPath $programsShortcutPath -PathType Leaf)) {
    [void]$verificationFailures.Add("Programs shortcut was not created: $programsShortcutPath")
  }

  if ($verificationFailures.Count -gt 0) {
    throw ($verificationFailures -join [Environment]::NewLine)
  }
} catch {
  $installationError = $_.Exception.Message
} finally {
  if ($installationStarted) {
    $latestNewEntries = @()
    try {
      $latestNewEntries = @(Get-NewMatchingUninstallEntries -ExpectedProductName $ProductName -PreexistingPaths $preexistingEntryPaths)
    } catch {
      [void]$cleanupFailures.Add("Could not query new uninstall entries during cleanup: $($_.Exception.Message)")
    }

    $hasInstallArtifacts = (Test-Path -LiteralPath $InstallDirectory) -or
      ($latestNewEntries.Count -gt 0) -or
      (Test-Path -LiteralPath $desktopShortcutPath) -or
      (Test-Path -LiteralPath $programsShortcutPath)
    $CleanupUninstallerPath = $null

    if ($null -ne $expectedUninstallerPath -and (Test-Path -LiteralPath $expectedUninstallerPath -PathType Leaf)) {
      try {
        $CleanupUninstallerPath = Get-CanonicalExistingFile -Path $expectedUninstallerPath
      } catch {
        [void]$cleanupFailures.Add("Could not resolve the expected uninstaller during cleanup: $($_.Exception.Message)")
      }
    }

    if ($null -eq $CleanupUninstallerPath -and $latestNewEntries.Count -eq 1) {
      try {
        $entryUninstallerPath = Get-QuotedExecutablePath -UninstallString ([string]$latestNewEntries[0].UninstallString)
        $ActualInstallDirectory = Get-CanonicalDirectoryPath -Path ([System.IO.Path]::GetDirectoryName($entryUninstallerPath))
        if (Test-Path -LiteralPath $entryUninstallerPath -PathType Leaf) {
          $CleanupUninstallerPath = Get-CanonicalExistingFile -Path $entryUninstallerPath
        } else {
          [void]$cleanupFailures.Add("New uninstall entry points to a missing uninstaller: $entryUninstallerPath")
        }
      } catch {
        [void]$cleanupFailures.Add("Could not resolve the new uninstall entry's uninstaller: $($_.Exception.Message)")
      }
    }

    if ($null -ne $CleanupUninstallerPath) {
      $ActualInstallDirectory = Get-CanonicalDirectoryPath -Path ([System.IO.Path]::GetDirectoryName($CleanupUninstallerPath))
      $uninstallInvoked = $false
      try {
        $uninstallProcess = Start-Process -FilePath $CleanupUninstallerPath -ArgumentList @('/S', '/currentuser') -WindowStyle Hidden -Wait -PassThru
        $uninstallInvoked = $true
        if ($uninstallProcess.ExitCode -ne 0) {
          [void]$cleanupFailures.Add("Uninstaller exited with code $($uninstallProcess.ExitCode).")
        }
      } catch {
        [void]$cleanupFailures.Add("Could not run cleanup uninstaller '$CleanupUninstallerPath': $($_.Exception.Message)")
      }

      if ($uninstallInvoked) {
        $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
          try {
            $remainingEntries = @(Get-NewMatchingUninstallEntries -ExpectedProductName $ProductName -PreexistingPaths $preexistingEntryPaths)
          } catch {
            [void]$cleanupFailures.Add("Could not poll uninstall entries during cleanup: $($_.Exception.Message)")
            break
          }

          $requestedDirectoryGone = -not (Test-Path -LiteralPath $InstallDirectory)
          $actualDirectoryGone = [string]::IsNullOrWhiteSpace($ActualInstallDirectory) -or
            -not (Test-Path -LiteralPath $ActualInstallDirectory)
          $shortcutsGone = -not (Test-Path -LiteralPath $desktopShortcutPath) -and
            -not (Test-Path -LiteralPath $programsShortcutPath)

          if ($remainingEntries.Count -eq 0 -and $requestedDirectoryGone -and $actualDirectoryGone -and $shortcutsGone) {
            break
          }

          if ([DateTime]::UtcNow -ge $cleanupDeadline) {
            break
          }

          Start-Sleep -Milliseconds 500
        } while ($true)
      }
    } elseif ($hasInstallArtifacts) {
      [void]$cleanupFailures.Add("Could not locate a safe cleanup uninstaller for installed artifacts.")
    }

    try {
      $remainingEntries = @(Get-NewMatchingUninstallEntries -ExpectedProductName $ProductName -PreexistingPaths $preexistingEntryPaths)
      if ($remainingEntries.Count -gt 0) {
        $remainingEntryPaths = ($remainingEntries | ForEach-Object { [string]$_.PSPath }) -join ", "
        [void]$cleanupFailures.Add("New uninstall entries remain after cleanup: $remainingEntryPaths")
      }
    } catch {
      [void]$cleanupFailures.Add("Could not verify uninstall entry cleanup: $($_.Exception.Message)")
    }

    foreach ($shortcutPath in @($desktopShortcutPath, $programsShortcutPath)) {
      if (Test-Path -LiteralPath $shortcutPath) {
        [void]$cleanupFailures.Add("Shortcut remains after cleanup: $shortcutPath")
      }
    }

    $cleanupDirectories = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    [void]$cleanupDirectories.Add($InstallDirectory)
    if (-not [string]::IsNullOrWhiteSpace($ActualInstallDirectory)) {
      [void]$cleanupDirectories.Add($ActualInstallDirectory)
    }

    foreach ($directory in $cleanupDirectories) {
      if (-not (Test-Path -LiteralPath $directory)) {
        continue
      }

      [void]$cleanupFailures.Add("Install directory remains after cleanup: $directory")
      if (Test-StrictDescendant -Candidate $directory -Root $TemporaryRoot) {
        try {
          Remove-Item -LiteralPath $directory -Recurse -Force
        } catch {
          [void]$cleanupFailures.Add("Fallback removal failed for '$directory': $($_.Exception.Message)")
        }
      } else {
        [void]$cleanupFailures.Add("Refusing fallback removal outside TemporaryRoot: $directory")
      }
    }
  }
}

$combinedFailures = [System.Collections.Generic.List[string]]::new()
if (-not [string]::IsNullOrWhiteSpace($installationError)) {
  [void]$combinedFailures.Add("Installation failed: $installationError")
}

if ($cleanupFailures.Count -gt 0) {
  [void]$combinedFailures.Add("Cleanup failed: $($cleanupFailures -join [Environment]::NewLine)")
}

if ($combinedFailures.Count -gt 0) {
  throw ($combinedFailures -join [Environment]::NewLine)
}

Write-Host "NSIS installer lifecycle smoke test passed: $InstallDirectory"
