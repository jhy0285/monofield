param(
  [Parameter(Mandatory = $true)]
  [string]$WorkspaceRoot,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Get-NormalizedDirectoryPath([string]$Path) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $pathRoot = [IO.Path]::GetPathRoot($resolved)
  if ($resolved -ine $pathRoot) {
    $resolved = $resolved.TrimEnd(
      [IO.Path]::DirectorySeparatorChar,
      [IO.Path]::AltDirectorySeparatorChar
    )
  }
  return $resolved
}

function Get-NestedReparsePoints([string]$TargetPath) {
  $targetPrefix = $TargetPath + [IO.Path]::DirectorySeparatorChar
  $pending = [System.Collections.Generic.Stack[string]]::new()
  $found = [System.Collections.Generic.List[object]]::new()
  $pending.Push($TargetPath)

  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    $directory = [IO.DirectoryInfo]::new($current)
    foreach ($entry in $directory.EnumerateFileSystemInfos()) {
      $resolvedEntry = [IO.Path]::GetFullPath($entry.FullName)
      if (-not $resolvedEntry.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to inspect a nested path outside the approved target: $resolvedEntry"
      }
      # DirectoryInfo returns attributes with the enumeration result, avoiding
      # a second filesystem call for every entry in multi-gigabyte build trees.
      $attributes = $entry.Attributes
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        $found.Add([pscustomobject]@{
          path = $resolvedEntry
          directory = ($attributes -band [IO.FileAttributes]::Directory) -ne 0
        })
        continue
      }
      if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
        $pending.Push($resolvedEntry)
      }
    }
  }

  return @($found | Sort-Object { $_.path.Length } -Descending)
}

function Remove-NestedReparsePoint([object]$Link, [string]$TargetPath) {
  $targetPrefix = $TargetPath + [IO.Path]::DirectorySeparatorChar
  $resolvedLink = [IO.Path]::GetFullPath([string]$Link.path)
  if (-not $resolvedLink.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a nested link outside the approved target: $resolvedLink"
  }
  $attributes = [IO.File]::GetAttributes($resolvedLink)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
    throw "Refusing to remove a nested path that is no longer a reparse point: $resolvedLink"
  }
  if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
    [IO.Directory]::Delete($resolvedLink, $false)
  } else {
    [IO.File]::Delete($resolvedLink)
  }
}

$resolvedRoot = Get-NormalizedDirectoryPath $WorkspaceRoot
$scriptWorkspaceRoot = Get-NormalizedDirectoryPath (Join-Path $PSScriptRoot "..\..\..")
if ($resolvedRoot -ine $scriptWorkspaceRoot) {
  throw "WorkspaceRoot must be the exact source workspace that owns this cleanup script: $scriptWorkspaceRoot"
}
if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
  throw "MonoField workspace root does not exist: $resolvedRoot"
}

$workspaceItem = Get-Item -LiteralPath $resolvedRoot -Force -ErrorAction Stop
if (($workspaceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw "Refusing to clean a workspace root that is a reparse point: $resolvedRoot"
}

$packageJsonPath = Join-Path $resolvedRoot "package.json"
$pnpmWorkspacePath = Join-Path $resolvedRoot "pnpm-workspace.yaml"
$gitMarkerPath = Join-Path $resolvedRoot ".git"
if (
  -not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf) -or
  -not (Test-Path -LiteralPath $pnpmWorkspacePath -PathType Leaf) -or
  -not (Test-Path -LiteralPath $gitMarkerPath)
) {
  throw "Refusing cleanup because the exact MonoField source workspace markers are missing: $resolvedRoot"
}
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding utf8 | ConvertFrom-Json
if ([string]$packageJson.name -cne "monofield" -or $packageJson.private -ne $true) {
  throw "Refusing cleanup because package.json is not the private MonoField workspace root: $packageJsonPath"
}

$workspacePrefix = $resolvedRoot + [IO.Path]::DirectorySeparatorChar
$targetNames = @(".tmp", ".playwright-cli")
$activeCommands = @(
  Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object { $_.ProcessId -ne $PID } |
    ForEach-Object { [string]$_.CommandLine } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)

$planned = [System.Collections.Generic.List[string]]::new()
$deleted = [System.Collections.Generic.List[string]]::new()
$skippedInUse = [System.Collections.Generic.List[string]]::new()
$skippedReparsePoints = [System.Collections.Generic.List[string]]::new()
$nestedReparsePoints = [System.Collections.Generic.List[object]]::new()
$removedNestedReparsePoints = [System.Collections.Generic.List[string]]::new()
$failures = [System.Collections.Generic.List[string]]::new()

$pathRoot = [IO.Path]::GetPathRoot($resolvedRoot)
$driveName = $pathRoot.TrimEnd(':', '\')
$drive = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
$freeBytesBefore = if ($null -ne $drive) { [int64]$drive.Free } else { $null }

foreach ($targetName in $targetNames) {
  $targetPath = Get-NormalizedDirectoryPath (Join-Path $resolvedRoot $targetName)
  if (
    -not $targetPath.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetDirectoryName($targetPath) -ine $resolvedRoot -or
    [IO.Path]::GetFileName($targetPath) -cne $targetName
  ) {
    throw "Refusing to clean a path that is not an exact approved direct child: $targetPath"
  }
  if (-not (Test-Path -LiteralPath $targetPath)) {
    continue
  }

  $targetItem = Get-Item -LiteralPath $targetPath -Force -ErrorAction Stop
  if (-not $targetItem.PSIsContainer) {
    $failures.Add("$targetPath :: approved workspace artifact target is not a directory")
    continue
  }
  if (($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    $skippedReparsePoints.Add($targetPath)
    continue
  }

  $inUse = $activeCommands | Where-Object {
    $_.IndexOf($targetPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
  } | Select-Object -First 1
  if ($null -ne $inUse) {
    $skippedInUse.Add($targetPath)
    continue
  }

  try {
    $targetNestedReparsePoints = @(Get-NestedReparsePoints $targetPath)
    foreach ($link in $targetNestedReparsePoints) {
      $nestedReparsePoints.Add([pscustomobject]@{
        target = $targetPath
        path = [string]$link.path
        directory = [bool]$link.directory
      })
    }
  } catch {
    $failures.Add("$targetPath :: failed to inspect nested reparse points safely: $($_.Exception.Message)")
    continue
  }

  if ($DryRun) {
    $planned.Add($targetPath)
    continue
  }

  try {
    foreach ($link in $targetNestedReparsePoints) {
      Remove-NestedReparsePoint $link $targetPath
      $removedNestedReparsePoints.Add([string]$link.path)
    }
    Remove-Item -LiteralPath $targetPath -Recurse -Force -ErrorAction Stop
    $deleted.Add($targetPath)
  } catch {
    $failures.Add("$targetPath :: $($_.Exception.Message)")
  }
}

$drive = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
$freeBytesAfter = if ($null -ne $drive) { [int64]$drive.Free } else { $null }
$freedBytes = if (
  -not $DryRun -and
  $null -ne $freeBytesBefore -and
  $null -ne $freeBytesAfter -and
  $freeBytesAfter -gt $freeBytesBefore
) {
  [int64]($freeBytesAfter - $freeBytesBefore)
} else {
  [int64]0
}

[pscustomobject]@{
  workspaceRoot = $resolvedRoot
  dryRun = [bool]$DryRun
  approvedTargets = $targetNames
  plannedCount = $planned.Count
  deletedCount = $deleted.Count
  skippedInUseCount = $skippedInUse.Count
  skippedReparsePointCount = $skippedReparsePoints.Count
  nestedReparsePointCount = $nestedReparsePoints.Count
  removedNestedReparsePointCount = $removedNestedReparsePoints.Count
  failedCount = $failures.Count
  freedBytes = $freedBytes
  freeBytes = $freeBytesAfter
  planned = @($planned)
  deleted = @($deleted)
  skippedInUse = @($skippedInUse)
  skippedReparsePoints = @($skippedReparsePoints)
  nestedReparsePoints = @($nestedReparsePoints)
  removedNestedReparsePoints = @($removedNestedReparsePoints)
  failures = @($failures)
} | ConvertTo-Json -Depth 6
