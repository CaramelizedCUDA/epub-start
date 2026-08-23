[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$phaseRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$evidenceRoot = [System.IO.Path]::GetFullPath((Join-Path $phaseRoot 'evidence')).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$indexPath = [System.IO.Path]::GetFullPath((Join-Path $phaseRoot 'index.html'))
$profilePath = [System.IO.Path]::GetFullPath((Join-Path $evidenceRoot '.browser-profile'))
$requiredPrefix = $phaseRoot + [System.IO.Path]::DirectorySeparatorChar

foreach ($path in @($evidenceRoot, $indexPath, $profilePath)) {
  if (-not $path.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing path outside isolated Phase 2 root: $path"
  }
}

if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
  throw "Prototype entry point not found: $indexPath"
}

if (-not (Test-Path -LiteralPath $evidenceRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $evidenceRoot | Out-Null
}

$browserCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }

$browser = $browserCandidates | Select-Object -First 1
if (-not $browser) {
  throw 'Microsoft Edge or Google Chrome was not found. No production application was started.'
}

$baseUri = [System.Uri]::new($indexPath).AbsoluteUri
$captures = @(
  [pscustomobject]@{ File = 'desktop-library-100.png'; Width = 1440; Height = 960; WindowWidth = 1440; WindowHeight = 960; Scale = 1; Query = 'view=library&count=100&layout=grid&detail=1&review=0&theme=light' },
  [pscustomobject]@{ File = 'desktop-library-1000-compact.png'; Width = 1440; Height = 960; WindowWidth = 1440; WindowHeight = 960; Scale = 1; Query = 'view=library&count=1000&layout=compact&detail=1&review=0&theme=light' },
  [pscustomobject]@{ File = 'desktop-search-indexing.png'; Width = 1440; Height = 960; WindowWidth = 1440; WindowHeight = 960; Scale = 1; Query = 'view=library&count=100&layout=grid&search=1&scope=content&index=building&detail=0&review=0&theme=light' },
  [pscustomobject]@{ File = 'desktop-reader-controls.png'; Width = 1440; Height = 960; WindowWidth = 1440; WindowHeight = 960; Scale = 1; Query = 'view=reader&count=100&reader=controls&panel=toc&detail=0&review=0&theme=paper' },
  [pscustomobject]@{ File = 'mobile-library.png'; Width = 390; Height = 844; WindowWidth = 488; WindowHeight = 1055; Scale = 0.8; Query = 'view=library&count=10&layout=grid&detail=0&review=0&theme=light' },
  [pscustomobject]@{ File = 'mobile-reader-controls.png'; Width = 390; Height = 844; WindowWidth = 488; WindowHeight = 1055; Scale = 0.8; Query = 'view=reader&count=10&reader=controls&panel=settings&detail=0&review=0&theme=paper' }
)

if (Test-Path -LiteralPath $profilePath) {
  Remove-Item -LiteralPath $profilePath -Recurse -Force
}
New-Item -ItemType Directory -Path $profilePath | Out-Null

try {
  foreach ($capture in $captures) {
    $outputPath = [System.IO.Path]::GetFullPath((Join-Path $evidenceRoot $capture.File))
    if (-not $outputPath.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing screenshot path outside isolated Phase 2 root: $outputPath"
    }

    $url = '{0}?{1}' -f $baseUri, $capture.Query
    $browserArguments = @(
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--run-all-compositor-stages-before-draw',
      "--force-device-scale-factor=$($capture.Scale)",
      '--virtual-time-budget=1800',
      "--user-data-dir=$profilePath",
      "--window-size=$($capture.WindowWidth),$($capture.WindowHeight)",
      "--screenshot=$outputPath",
      $url
    )

    & $browser @browserArguments | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Headless browser failed for $($capture.File) with exit code $LASTEXITCODE"
    }
    $artifact = Get-Item -LiteralPath $outputPath -ErrorAction Stop
    if ($artifact.Length -le 0) {
      throw "Empty screenshot: $outputPath"
    }
    Write-Output ("CAPTURED {0} ({1} bytes)" -f $artifact.FullName, $artifact.Length)
  }
}
finally {
  $resolvedProfile = [System.IO.Path]::GetFullPath($profilePath)
  if ($resolvedProfile.StartsWith($requiredPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedProfile)) {
    Remove-Item -LiteralPath $resolvedProfile -Recurse -Force
  }
}

Write-Output ("DONE {0} isolated screenshots; browser={1}" -f $captures.Count, $browser)
