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
  [string]$ShortcutName = "Gemini OAuth Switcher",

  [AllowNull()]
  [AllowEmptyString()]
  [string]$ExpectedDefaultInstallDirectory,

  [ValidateRange(1, 2147483)]
  [int]$ProcessTimeoutSeconds = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ExistingItem {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  try {
    return Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  } catch [System.Management.Automation.ItemNotFoundException] {
    return $null
  } catch {
    $isConfirmedPathNotFound = $_.FullyQualifiedErrorId -like "PathNotFound,*" -or
      $_.CategoryInfo.Reason -eq "ItemNotFoundException"
    if ($isConfirmedPathNotFound) {
      return $null
    }

    throw "Unable to inspect path '$Path': $($_.Exception.Message)"
  }
}

function Get-CanonicalExistingFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $item = Get-ExistingItem -Path $Path
  if ($null -eq $item) {
    throw "File does not exist: $Path"
  }

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

  $item = Get-ExistingItem -Path $Path
  if ($null -eq $item) {
    throw "Directory does not exist: $Path"
  }

  if (-not $item.PSIsContainer) {
    throw "Expected a directory but found a file: $Path"
  }

  $fullPath = [System.IO.Path]::GetFullPath($item.FullName)
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

function Test-IsReparsePoint {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.FileSystemInfo]$Item
  )

  return ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
}

function Assert-PathAncestorsHaveNoReparsePoints {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $fullPath = Get-CanonicalDirectoryPath -Path $Path
  $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($pathRoot)) {
    throw "Could not determine the filesystem root for TemporaryRoot: $fullPath"
  }

  $currentPath = $pathRoot
  $relativePath = [System.IO.Path]::GetRelativePath($pathRoot, $fullPath)
  $segments = @($relativePath -split '[\\/]' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne "." })
  $pathsToInspect = [System.Collections.Generic.List[string]]::new()
  [void]$pathsToInspect.Add($currentPath)

  foreach ($segment in $segments) {
    $currentPath = Join-Path -Path $currentPath -ChildPath $segment
    [void]$pathsToInspect.Add($currentPath)
  }

  foreach ($ancestorPath in $pathsToInspect) {
    $item = Get-ExistingItem -Path $ancestorPath
    if ($null -eq $item) {
      throw "TemporaryRoot path component does not exist: $ancestorPath"
    }

    if (Test-IsReparsePoint -Item $item) {
      if ([string]::Equals($ancestorPath, $fullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "TemporaryRoot must not be a reparse point: $ancestorPath"
      }
      throw "TemporaryRoot ancestor is a reparse point: $ancestorPath"
    }

    if (-not $item.PSIsContainer) {
      throw "TemporaryRoot path component is not a directory: $ancestorPath"
    }
  }
}

function Assert-InstallPathHasNoReparsePoints {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root,

    [Parameter(Mandatory = $true)]
    [string]$Candidate
  )

  $relativePath = [System.IO.Path]::GetRelativePath($Root, $Candidate)
  $segments = @($relativePath -split '[\\/]' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne "." })
  $currentPath = $Root

  foreach ($segment in $segments) {
    $currentPath = Join-Path -Path $currentPath -ChildPath $segment
    $item = Get-ExistingItem -Path $currentPath
    if ($null -eq $item) {
      break
    }

    if (Test-IsReparsePoint -Item $item) {
      throw "Install path component is a reparse point: $currentPath"
    }

    if (-not $item.PSIsContainer) {
      throw "Install path component is not a directory: $currentPath"
    }
  }
}

function Remove-ReparsePoint {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $item = Get-ExistingItem -Path $Path
  if ($null -eq $item) {
    throw "Reparse point does not exist: $Path"
  }

  if (-not (Test-IsReparsePoint -Item $item)) {
    throw "Refusing link-only removal for a non-reparse path: $Path"
  }

  if ($item.PSIsContainer) {
    [System.IO.Directory]::Delete($item.FullName, $false)
  } else {
    [System.IO.File]::Delete($item.FullName)
  }
}

function Remove-DirectoryTreeWithoutFollowingReparsePoints {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $item = Get-ExistingItem -Path $Path
  if ($null -eq $item) {
    return
  }

  if (Test-IsReparsePoint -Item $item) {
    Remove-ReparsePoint -Path $item.FullName
    return
  }

  if (-not $item.PSIsContainer) {
    Remove-Item -LiteralPath $item.FullName -Force
    return
  }

  foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)) {
    if (Test-IsReparsePoint -Item $child) {
      Remove-ReparsePoint -Path $child.FullName
    } elseif ($child.PSIsContainer) {
      Remove-DirectoryTreeWithoutFollowingReparsePoints -Path $child.FullName
    } else {
      Remove-Item -LiteralPath $child.FullName -Force
    }
  }

  [System.IO.Directory]::Delete($item.FullName, $false)
}

function Invoke-BoundedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ArgumentList,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483)]
    [int]$TimeoutSeconds,

    [Parameter(Mandatory = $true)]
    [string]$ProcessName
  )

  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WindowStyle Hidden -PassThru
  $timeoutMilliseconds = [int]([long]$TimeoutSeconds * 1000)
  if (-not $process.WaitForExit($timeoutMilliseconds)) {
    try {
      $taskkillPath = Join-Path -Path $env:SystemRoot -ChildPath "System32\taskkill.exe"
      & $taskkillPath /PID $process.Id /T /F *> $null
    } catch {
      # Fall back below if taskkill is unavailable or loses a process-exit race.
    }

    [void]$process.WaitForExit(5000)
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      [void]$process.WaitForExit(5000)
    }
    throw "$ProcessName timed out after $TimeoutSeconds seconds: $FilePath"
  }

  if ($process.ExitCode -ne 0) {
    throw "$ProcessName exited with code $($process.ExitCode)."
  }
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
    $isMatch = [string]::Equals($displayName, $ExpectedProductName, [System.StringComparison]::OrdinalIgnoreCase) -or
      $displayName.StartsWith("$ExpectedProductName ", [System.StringComparison]::OrdinalIgnoreCase)
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
    [AllowEmptyCollection()]
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
$LikelyDefaultInstallDirectory = $null
$ActualInstallDirectory = $null

try {
  $installerItem = Get-ExistingItem -Path $InstallerPath
  if ($null -eq $installerItem) {
    throw "Installer does not exist: $InstallerPath"
  }

  if ($installerItem.PSIsContainer) {
    throw "Installer is not a file: $InstallerPath"
  }
  $InstallerPath = Get-CanonicalExistingFile -Path $InstallerPath

  $TemporaryRoot = Get-CanonicalDirectoryPath -Path $TemporaryRoot
  Assert-PathAncestorsHaveNoReparsePoints -Path $TemporaryRoot
  $temporaryRootItem = Get-ExistingItem -Path $TemporaryRoot
  if ($null -eq $temporaryRootItem) {
    throw "TemporaryRoot does not exist: $TemporaryRoot"
  }

  if (-not $temporaryRootItem.PSIsContainer) {
    throw "TemporaryRoot is not a directory: $TemporaryRoot"
  }

  $TemporaryRoot = Get-CanonicalExistingDirectory -Path $TemporaryRoot
  $InstallDirectory = Get-CanonicalDirectoryPath -Path $InstallDirectory

  if ($null -ne (Get-ExistingItem -Path $InstallDirectory)) {
    throw "Install directory already exists: $InstallDirectory"
  }

  if (-not (Test-StrictDescendant -Candidate $InstallDirectory -Root $TemporaryRoot)) {
    throw "Install directory must be a strict descendant of TemporaryRoot: $InstallDirectory"
  }

  Assert-InstallPathHasNoReparsePoints -Root $TemporaryRoot -Candidate $InstallDirectory

  if ([string]::IsNullOrWhiteSpace($ExpectedDefaultInstallDirectory)) {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
      throw "LOCALAPPDATA is not available for the current user."
    }

    $localProgramsDirectory = Join-Path -Path $env:LOCALAPPDATA -ChildPath "Programs"
    $ExpectedDefaultInstallDirectory = Join-Path -Path $localProgramsDirectory -ChildPath $ProductName
  }

  $ExpectedDefaultInstallDirectory = Get-CanonicalDirectoryPath -Path $ExpectedDefaultInstallDirectory
  $LikelyDefaultInstallDirectory = $ExpectedDefaultInstallDirectory
  if ($null -ne (Get-ExistingItem -Path $LikelyDefaultInstallDirectory)) {
    throw "Likely default install directory already exists: $LikelyDefaultInstallDirectory"
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

  if ($null -ne (Get-ExistingItem -Path $desktopShortcutPath)) {
    throw "Desktop shortcut already exists: $desktopShortcutPath"
  }

  if ($null -ne (Get-ExistingItem -Path $programsShortcutPath)) {
    throw "Programs shortcut already exists: $programsShortcutPath"
  }

  $expectedExecutablePath = Join-Path -Path $InstallDirectory -ChildPath $ExecutableName
  $expectedUninstallerPath = Join-Path -Path $InstallDirectory -ChildPath $UninstallerName

  if ($null -ne (Get-ExistingItem -Path $InstallDirectory)) {
    throw "Install directory appeared before installer launch: $InstallDirectory"
  }
  Assert-InstallPathHasNoReparsePoints -Root $TemporaryRoot -Candidate $InstallDirectory

  $installationStarted = $true
  Invoke-BoundedProcess -FilePath $InstallerPath -ArgumentList @('/S', "/D=$InstallDirectory") -TimeoutSeconds $ProcessTimeoutSeconds -ProcessName "Installer"

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

    $hasInstallArtifacts = ($null -ne (Get-ExistingItem -Path $InstallDirectory)) -or
      ($null -ne $LikelyDefaultInstallDirectory -and $null -ne (Get-ExistingItem -Path $LikelyDefaultInstallDirectory)) -or
      ($latestNewEntries.Count -gt 0) -or
      ($null -ne (Get-ExistingItem -Path $desktopShortcutPath)) -or
      ($null -ne (Get-ExistingItem -Path $programsShortcutPath))
    $CleanupUninstallerPath = $null

    $expectedUninstallerItem = if ($null -eq $expectedUninstallerPath) { $null } else { Get-ExistingItem -Path $expectedUninstallerPath }
    if ($null -ne $expectedUninstallerItem -and -not $expectedUninstallerItem.PSIsContainer) {
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
        $entryUninstallerItem = Get-ExistingItem -Path $entryUninstallerPath
        if ($null -ne $entryUninstallerItem -and -not $entryUninstallerItem.PSIsContainer) {
          $CleanupUninstallerPath = Get-CanonicalExistingFile -Path $entryUninstallerPath
        } else {
          [void]$cleanupFailures.Add("New uninstall entry points to a missing uninstaller: $entryUninstallerPath")
        }
      } catch {
        [void]$cleanupFailures.Add("Could not resolve the new uninstall entry's uninstaller: $($_.Exception.Message)")
      }
    }

    $uninstallAttempted = $false
    if ($null -ne $CleanupUninstallerPath) {
      $ActualInstallDirectory = Get-CanonicalDirectoryPath -Path ([System.IO.Path]::GetDirectoryName($CleanupUninstallerPath))
      $uninstallAttempted = $true
      try {
        Invoke-BoundedProcess -FilePath $CleanupUninstallerPath -ArgumentList @('/S', '/currentuser') -TimeoutSeconds $ProcessTimeoutSeconds -ProcessName "Uninstaller"
      } catch {
        [void]$cleanupFailures.Add("Could not run cleanup uninstaller '$CleanupUninstallerPath': $($_.Exception.Message)")
      }
    } elseif ($hasInstallArtifacts) {
      [void]$cleanupFailures.Add("Could not locate a safe cleanup uninstaller for installed artifacts.")
    }

    if ($uninstallAttempted) {
      $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(30)
      do {
        try {
          $remainingEntries = @(Get-NewMatchingUninstallEntries -ExpectedProductName $ProductName -PreexistingPaths $preexistingEntryPaths)
        } catch {
          [void]$cleanupFailures.Add("Could not poll uninstall entries during cleanup: $($_.Exception.Message)")
          break
        }

        $requestedDirectoryGone = $null -eq (Get-ExistingItem -Path $InstallDirectory)
        $actualDirectoryGone = [string]::IsNullOrWhiteSpace($ActualInstallDirectory) -or
          $null -eq (Get-ExistingItem -Path $ActualInstallDirectory)
        $likelyDefaultDirectoryGone = [string]::IsNullOrWhiteSpace($LikelyDefaultInstallDirectory) -or
          $null -eq (Get-ExistingItem -Path $LikelyDefaultInstallDirectory)
        $shortcutsGone = $null -eq (Get-ExistingItem -Path $desktopShortcutPath) -and
          $null -eq (Get-ExistingItem -Path $programsShortcutPath)

        if ($remainingEntries.Count -eq 0 -and $requestedDirectoryGone -and $actualDirectoryGone -and $likelyDefaultDirectoryGone -and $shortcutsGone) {
          break
        }

        if ([DateTime]::UtcNow -ge $cleanupDeadline) {
          break
        }

        Start-Sleep -Milliseconds 500
      } while ($true)
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
      if ($null -ne (Get-ExistingItem -Path $shortcutPath)) {
        [void]$cleanupFailures.Add("Shortcut remains after cleanup: $shortcutPath")
      }
    }

    $cleanupDirectories = [System.Collections.Generic.Dictionary[string, string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $cleanupDirectories[$InstallDirectory] = "Install directory"
    if (-not [string]::IsNullOrWhiteSpace($ActualInstallDirectory)) {
      $cleanupDirectories[$ActualInstallDirectory] = "Install directory"
    }
    if (-not [string]::IsNullOrWhiteSpace($LikelyDefaultInstallDirectory)) {
      $cleanupDirectories[$LikelyDefaultInstallDirectory] = "Likely default install directory"
    }

    foreach ($candidate in $cleanupDirectories.GetEnumerator()) {
      $directory = $candidate.Key
      $leftoverItem = Get-ExistingItem -Path $directory
      if ($null -eq $leftoverItem) {
        continue
      }

      [void]$cleanupFailures.Add("$($candidate.Value) remains after cleanup: $directory")
      $isInsideTemporaryRoot = Test-StrictDescendant -Candidate $directory -Root $TemporaryRoot

      if (Test-IsReparsePoint -Item $leftoverItem) {
        [void]$cleanupFailures.Add("Reparse point remains after cleanup: $directory")
        if ($isInsideTemporaryRoot) {
          try {
            Remove-ReparsePoint -Path $directory
          } catch {
            [void]$cleanupFailures.Add("Link-only fallback removal failed for '$directory': $($_.Exception.Message)")
          }
        } else {
          [void]$cleanupFailures.Add("Refusing fallback removal outside TemporaryRoot: $directory")
        }
        continue
      }

      if ($isInsideTemporaryRoot) {
        try {
          Remove-DirectoryTreeWithoutFollowingReparsePoints -Path $directory
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
