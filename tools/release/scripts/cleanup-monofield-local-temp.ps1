param(
  [switch]$StopOrphanTestRunners,
  [switch]$PruneReusableCaches,
  [int]$MinimumAgeMinutes = 0
)

$ErrorActionPreference = "Stop"

$tempRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Temp")).TrimEnd(
  [IO.Path]::DirectorySeparatorChar,
  [IO.Path]::AltDirectorySeparatorChar
)
$tempPrefix = $tempRoot + [IO.Path]::DirectorySeparatorChar
$before = (Get-PSDrive -Name C).Free

if ($StopOrphanTestRunners) {
  $orphanProcesses = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -eq "node.exe" -and
        $_.CommandLine -like "*\AppData\Local\Temp\od-chat-route-bin-*" -and
        $_.CommandLine -like "*opencode-test-runner.cjs*"
      }
  )
  foreach ($process in $orphanProcesses) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($orphanProcesses.Count -gt 0) {
    Start-Sleep -Milliseconds 300
  }
} else {
  $orphanProcesses = @()
}

$activeCommands = @(
  Get-CimInstance Win32_Process |
    ForEach-Object { [string]$_.CommandLine } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
$cutoff = (Get-Date).AddMinutes(-1 * [Math]::Max(0, $MinimumAgeMinutes))
$candidates = @(
  Get-ChildItem -LiteralPath $tempRoot -Force -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.Name -like "od-*" -or
       $_.Name -like "open-design-*" -or
       $_.Name -like "monofield-*" -or
       $_.Name -like "codex-monofield-*") -and
      $_.LastWriteTime -le $cutoff
    }
)

$deleted = [System.Collections.Generic.List[string]]::new()
$skipped = [System.Collections.Generic.List[string]]::new()
$failed = [System.Collections.Generic.List[string]]::new()

foreach ($candidate in $candidates) {
  $resolved = [IO.Path]::GetFullPath($candidate.FullName)
  if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a path outside the validated temp root: $resolved"
  }

  $inUse = $false
  foreach ($command in $activeCommands) {
    if ($command.IndexOf($resolved, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $inUse = $true
      break
    }
  }
  if ($inUse) {
    $skipped.Add($resolved)
    continue
  }

  try {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
    $deleted.Add($resolved)
  } catch {
    $failed.Add("$resolved :: $($_.Exception.Message)")
  }
}

# This exact directory was left by the interrupted v0.11.6 NSIS smoke. Future
# runs keep NSIS extraction inside monofield-nsis-* so the regular sweep owns it.
$knownNsisRemainder = [IO.Path]::GetFullPath((Join-Path $tempRoot "nsj1444.tmp"))
if (Test-Path -LiteralPath $knownNsisRemainder) {
  if (-not $knownNsisRemainder.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an NSIS path outside the validated temp root: $knownNsisRemainder"
  }
  try {
    Remove-Item -LiteralPath $knownNsisRemainder -Recurse -Force -ErrorAction Stop
    $deleted.Add($knownNsisRemainder)
  } catch {
    $failed.Add("$knownNsisRemainder :: $($_.Exception.Message)")
  }
}

$reusableCachesDeleted = [System.Collections.Generic.List[string]]::new()
$reusableCachesSkipped = [System.Collections.Generic.List[string]]::new()
if ($PruneReusableCaches) {
  $activeMonoFieldProcesses = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -ieq "MonoField.exe" -or
        ($_.Name -ieq "electron.exe" -and
         ([string]$_.ExecutablePath -like "*\\open-design\\open-design\\*" -or
          [string]$_.CommandLine -like "*\\open-design\\open-design\\apps\\desktop\\*"))
      }
  )
  $reusableCacheTargets = @(
    [pscustomobject]@{
      path = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "electron\\Cache"))
      root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "electron"))
      requiresStoppedApp = $false
    },
    [pscustomobject]@{
      path = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "electron-builder\\Cache"))
      root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "electron-builder"))
      requiresStoppedApp = $false
    }
  )
  foreach ($cacheName in @("Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache")) {
    $profileRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "MonoField"))
    $reusableCacheTargets += [pscustomobject]@{
      path = [IO.Path]::GetFullPath((Join-Path $profileRoot $cacheName))
      root = $profileRoot
      requiresStoppedApp = $true
    }
  }

  foreach ($cache in $reusableCacheTargets) {
    $cachePrefix = $cache.root.TrimEnd(
      [IO.Path]::DirectorySeparatorChar,
      [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
    if (-not $cache.path.StartsWith($cachePrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a cache outside its validated root: $($cache.path)"
    }
    if (-not (Test-Path -LiteralPath $cache.path)) {
      continue
    }
    if ($cache.requiresStoppedApp -and $activeMonoFieldProcesses.Count -gt 0) {
      $reusableCachesSkipped.Add($cache.path)
      continue
    }
    try {
      # electron-builder archives can contain dangling macOS symlinks. Removing
      # those reparse points first avoids Windows PowerShell failing the whole
      # recursive cache deletion on a target that does not exist on Windows.
      Get-ChildItem -LiteralPath $cache.path -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue |
        Sort-Object { $_.FullName.Length } -Descending |
        ForEach-Object {
          Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
        }
      try {
        Remove-Item -LiteralPath $cache.path -Recurse -Force -ErrorAction Stop
      } catch {
        $emptyMirror = Join-Path $tempRoot ("monofield-empty-cache-" + [guid]::NewGuid().ToString("N"))
        try {
          New-Item -ItemType Directory -Path $emptyMirror -Force | Out-Null
          & robocopy.exe $emptyMirror $cache.path /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
          if ($LASTEXITCODE -gt 7) {
            throw "robocopy cache cleanup failed with exit code $LASTEXITCODE"
          }
          Remove-Item -LiteralPath $cache.path -Recurse -Force -ErrorAction SilentlyContinue
          $remainingCacheBytes = (
            Get-ChildItem -LiteralPath $cache.path -Recurse -Force -File -ErrorAction SilentlyContinue |
              Measure-Object Length -Sum
          ).Sum
          if ($remainingCacheBytes -gt 0) {
            throw "cache cleanup left $remainingCacheBytes bytes at $($cache.path)"
          }
        } finally {
          Remove-Item -LiteralPath $emptyMirror -Recurse -Force -ErrorAction SilentlyContinue
        }
      }
      $reusableCachesDeleted.Add($cache.path)
    } catch {
      $failed.Add("$($cache.path) :: $($_.Exception.Message)")
    }
  }
}

$after = (Get-PSDrive -Name C).Free
[pscustomobject]@{
  tempRoot = $tempRoot
  stoppedOrphanTestProcesses = $orphanProcesses.Count
  candidateCount = $candidates.Count
  deletedCount = $deleted.Count
  reusableCacheDeletedCount = $reusableCachesDeleted.Count
  reusableCacheSkippedInUseCount = $reusableCachesSkipped.Count
  skippedInUseCount = $skipped.Count
  failedCount = $failed.Count
  freedBytes = if ($after -gt $before) { [int64]($after - $before) } else { [int64]0 }
  freeBytes = $after
  skippedInUse = @($skipped)
  reusableCachesDeleted = @($reusableCachesDeleted)
  reusableCachesSkippedInUse = @($reusableCachesSkipped)
  failures = @($failed)
} | ConvertTo-Json -Depth 4
