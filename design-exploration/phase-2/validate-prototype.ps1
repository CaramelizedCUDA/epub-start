[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$phaseRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$requiredPrefix = $phaseRoot + [System.IO.Path]::DirectorySeparatorChar
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Assert-PhaseFile {
  param(
    [Parameter(Mandatory)] [string] $RelativePath,
    [Parameter(Mandatory)] [int64] $MinimumBytes
  )
  $path = [System.IO.Path]::GetFullPath((Join-Path $phaseRoot $RelativePath))
  if (-not $path.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    $failures.Add("Path escapes Phase 2 root: $RelativePath")
    return
  }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    $failures.Add("Missing file: $RelativePath")
    return
  }
  $item = Get-Item -LiteralPath $path
  if ($item.Length -lt $MinimumBytes) {
    $failures.Add("File too small: $RelativePath ($($item.Length) bytes)")
  }
}

function Assert-Contains {
  param(
    [Parameter(Mandatory)] [string] $Text,
    [Parameter(Mandatory)] [string] $Needle,
    [Parameter(Mandatory)] [string] $Context
  )
  if (-not $Text.Contains($Needle, [System.StringComparison]::Ordinal)) {
    $failures.Add("Missing token in ${Context}: $Needle")
  }
}

function Get-PngDimensions {
  param([Parameter(Mandatory)] [string] $Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 24 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or $bytes[2] -ne 78 -or $bytes[3] -ne 71) {
    throw "Not a readable PNG: $Path"
  }
  $width = ([uint32]$bytes[16] -shl 24) -bor ([uint32]$bytes[17] -shl 16) -bor ([uint32]$bytes[18] -shl 8) -bor [uint32]$bytes[19]
  $height = ([uint32]$bytes[20] -shl 24) -bor ([uint32]$bytes[21] -shl 16) -bor ([uint32]$bytes[22] -shl 8) -bor [uint32]$bytes[23]
  return [pscustomobject]@{ Width = $width; Height = $height }
}

$coreFiles = @(
  @{ Path = 'README.md'; Minimum = 1000 },
  @{ Path = 'index.html'; Minimum = 10000 },
  @{ Path = 'styles.css'; Minimum = 10000 },
  @{ Path = 'prototype.js'; Minimum = 10000 },
  @{ Path = 'capture-evidence.ps1'; Minimum = 1000 },
  @{ Path = 'validate-prototype.ps1'; Minimum = 1000 },
  @{ Path = 'evidence\README.md'; Minimum = 500 }
)
$coreFiles | ForEach-Object { Assert-PhaseFile -RelativePath $_.Path -MinimumBytes $_.Minimum }

$html = Get-Content -LiteralPath (Join-Path $phaseRoot 'index.html') -Raw
$css = Get-Content -LiteralPath (Join-Path $phaseRoot 'styles.css') -Raw
$javascript = Get-Content -LiteralPath (Join-Path $phaseRoot 'prototype.js') -Raw
$readme = Get-Content -LiteralPath (Join-Path $phaseRoot 'README.md') -Raw

foreach ($token in @('id="libraryView"', 'id="readerView"', 'id="searchOverlay"', 'id="relinkOverlay"', 'id="reviewPanel"', 'styles.css', 'prototype.js')) {
  Assert-Contains -Text $html -Needle $token -Context 'index.html'
}
foreach ($token in @('DESIGN_DEPENDENCY_REVIEW_REQUIRED', '10 / 100 / 1000', '静态', 'Android', '减弱动效')) {
  Assert-Contains -Text $readme -Needle $token -Context 'README.md'
}
foreach ($token in @('@media (max-width: 760px)', '@media (prefers-reduced-motion: reduce)', '@media (forced-colors: active)', ':focus-visible', 'body[data-reader-state="quiet"]')) {
  Assert-Contains -Text $css -Needle $token -Context 'styles.css'
}
foreach ($token in @('length: 1000', '"building"', '"cancelled"', '"pending"', '"error"', 'openRelink', 'trapFocus', 'data-book-id')) {
  Assert-Contains -Text $javascript -Needle $token -Context 'prototype.js'
}

foreach ($forbidden in @('invoke(', '@tauri-apps', 'src-tauri', 'package.json', 'http://', 'https://')) {
  if ($html.Contains($forbidden, [System.StringComparison]::OrdinalIgnoreCase) -or $javascript.Contains($forbidden, [System.StringComparison]::OrdinalIgnoreCase)) {
    $failures.Add("Prototype references forbidden production or network token: $forbidden")
  }
}

$screenshots = @(
  @{ Path = 'evidence\desktop-library-100.png'; Width = 1440; Height = 960 },
  @{ Path = 'evidence\desktop-library-1000-compact.png'; Width = 1440; Height = 960 },
  @{ Path = 'evidence\desktop-search-indexing.png'; Width = 1440; Height = 960 },
  @{ Path = 'evidence\desktop-reader-controls.png'; Width = 1440; Height = 960 },
  @{ Path = 'evidence\mobile-library.png'; Width = 390; Height = 844 },
  @{ Path = 'evidence\mobile-reader-controls.png'; Width = 390; Height = 844 }
)

foreach ($shot in $screenshots) {
  $shotPath = Join-Path $phaseRoot $shot.Path
  if (-not (Test-Path -LiteralPath $shotPath -PathType Leaf)) {
    $warnings.Add("Visual evidence not present (repeatable target): $($shot.Path)")
    continue
  }
  try {
    $dimensions = Get-PngDimensions -Path $shotPath
    if ($dimensions.Width -ne $shot.Width -or $dimensions.Height -ne $shot.Height) {
      $failures.Add("Unexpected dimensions: $($shot.Path) is $($dimensions.Width)x$($dimensions.Height), expected $($shot.Width)x$($shot.Height)")
    }
  }
  catch {
    $failures.Add($_.Exception.Message)
  }
}

if ($failures.Count -gt 0) {
  Write-Output 'PHASE 2 VALIDATION: FAIL'
  $failures | ForEach-Object { Write-Output " - $_" }
  exit 1
}

Write-Output 'PHASE 2 VALIDATION: PASS'
Write-Output ' - Core prototype files exist and are non-empty.'
Write-Output ' - Library, Reader, search/index, relink, accessibility, reduced-motion, and 10/100/1000 density tokens are present.'
Write-Output ' - Any present PNG evidence files are readable at the documented desktop/mobile dimensions.'
Write-Output ' - Static source contains no Tauri invoke, external network URL, package.json, or src-tauri reference.'
Write-Output ' - This validator reads only the isolated Phase 2 tree and performs no Git operation.'
if ($warnings.Count -gt 0) {
  Write-Output 'PHASE 2 VALIDATION: WARNINGS'
  $warnings | ForEach-Object { Write-Output " - $_" }
}
