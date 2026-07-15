param(
    [Parameter(Mandatory = $true)]
    [string]$WorkbookPath,

    [string]$WorksheetName = "",
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$ImagesRootPath = "",
    [Parameter(Mandatory = $true)]
    [string]$City,
    [string]$Email = "bipper9879@hotmail.com"
)

$ErrorActionPreference = "Stop"

$pythonScript = Join-Path $PSScriptRoot "build-gallery-data.py"
if (-not (Test-Path -Path $pythonScript -PathType Leaf)) {
    throw "Missing Python build script: $pythonScript"
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    throw "Python is not installed or not in PATH."
}

$args = @(
    $pythonScript,
    "--workbook-path", $WorkbookPath,
    "--repo-root", $RepoRoot,
    "--email", $Email
)

if (-not [string]::IsNullOrWhiteSpace($WorksheetName)) {
    $args += @("--worksheet-name", $WorksheetName)
}
if (-not [string]::IsNullOrWhiteSpace($ImagesRootPath)) {
    $args += @("--images-root", $ImagesRootPath)
}
$args += @("--city", $City)

& python @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
