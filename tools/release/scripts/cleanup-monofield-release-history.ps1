param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [ValidateRange(0, 20)]
  [int]$KeepLatest = 1,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$resolvedRoot = [IO.Path]::GetFullPath($Root)
$pathRoot = [IO.Path]::GetPathRoot($resolvedRoot)
if ($resolvedRoot -ine $pathRoot) {
  $resolvedRoot = $resolvedRoot.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
  )
}
if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
  throw "Release history root does not exist: $resolvedRoot"
}
$rootPrefix = if ($resolvedRoot.EndsWith([IO.Path]::DirectorySeparatorChar)) {
  $resolvedRoot
} else {
  $resolvedRoot + [IO.Path]::DirectorySeparatorChar
}
$driveName = $pathRoot.TrimEnd(':', '\')
$before = (Get-PSDrive -Name $driveName).Free
$activeCommands = @(
  Get-CimInstance Win32_Process |
    ForEach-Object { [string]$_.CommandLine } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)

$allCandidates = @(
  Get-ChildItem -LiteralPath $resolvedRoot -Directory -Force -ErrorAction Stop |
    Where-Object {
      $_.Name -match '^monofield-release-.+' -or
      $_.Name -match '^monofield-prev-.+'
    }
)

function Get-ReleaseSequence([string]$name) {
  if ($name -match '-r(?<sequence>\d+)$') {
    return [int64]$Matches.sequence
  }
  return [int64]-1
}

$retained = if ($KeepLatest -eq 0) {
  @()
} else {
  @(
    $allCandidates |
      Where-Object {
        $_.Name -match '^monofield-release-.+' -and
        $_.Name -notmatch '-temp$' -and
        $_.Name -notmatch '-preflight$'
      } |
      Sort-Object `
        @{ Expression = { Get-ReleaseSequence $_.Name }; Descending = $true },
        @{ Expression = { $_.LastWriteTimeUtc }; Descending = $true } |
      Select-Object -First $KeepLatest
  )
}
$retainedPaths = @($retained | ForEach-Object { [IO.Path]::GetFullPath($_.FullName) })

$deleted = [System.Collections.Generic.List[string]]::new()
$planned = [System.Collections.Generic.List[string]]::new()
$skipped = [System.Collections.Generic.List[string]]::new()
$failed = [System.Collections.Generic.List[string]]::new()
$emptyMirror = Join-Path $resolvedRoot (".monofield-cleanup-empty-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $emptyMirror -Force | Out-Null
try {
foreach ($candidate in $allCandidates) {
  $resolved = [IO.Path]::GetFullPath($candidate.FullName)
  if (-not $resolved.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a release path outside the validated root: $resolved"
  }
  if ([IO.Path]::GetDirectoryName($resolved) -ine $resolvedRoot) {
    throw "Refusing to remove a release path that is not a direct child of the validated root: $resolved"
  }
  if ($retainedPaths -contains $resolved) {
    continue
  }
  $inUse = $activeCommands | Where-Object {
    $_.IndexOf($resolved, [StringComparison]::OrdinalIgnoreCase) -ge 0
  } | Select-Object -First 1
  if ($null -ne $inUse) {
    $skipped.Add($resolved)
    continue
  }
  if ($DryRun) {
    $planned.Add($resolved)
    continue
  }
  try {
    & robocopy.exe $emptyMirror $resolved /MIR /R:0 /W:0 /XJ /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) {
      throw "robocopy release cleanup failed with exit code $LASTEXITCODE"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
    $deleted.Add($resolved)
  } catch {
    $failed.Add("$resolved :: $($_.Exception.Message)")
  }
}
} finally {
  Remove-Item -LiteralPath $emptyMirror -Recurse -Force -ErrorAction SilentlyContinue
}

$after = (Get-PSDrive -Name $driveName).Free
[pscustomobject]@{
  root = $resolvedRoot
  keepLatest = $KeepLatest
  retained = $retainedPaths
  planned = @($planned)
  deleted = @($deleted)
  skippedInUse = @($skipped)
  failures = @($failed)
  freedBytes = if ($after -gt $before) { [int64]($after - $before) } else { [int64]0 }
  freeBytes = $after
} | ConvertTo-Json -Depth 4
