param(
  [switch]$StopOrphanTestRunners,
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
       $_.Name -like "monofield-*") -and
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

$after = (Get-PSDrive -Name C).Free
[pscustomobject]@{
  tempRoot = $tempRoot
  stoppedOrphanTestProcesses = $orphanProcesses.Count
  candidateCount = $candidates.Count
  deletedCount = $deleted.Count
  skippedInUseCount = $skipped.Count
  failedCount = $failed.Count
  freedBytes = if ($after -gt $before) { [int64]($after - $before) } else { [int64]0 }
  freeBytes = $after
  skippedInUse = @($skipped)
  failures = @($failed)
} | ConvertTo-Json -Depth 4
