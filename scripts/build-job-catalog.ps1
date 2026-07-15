param(
    [Parameter(Mandatory = $true)]
    [string]$CsvPath,

    [string]$RepoRoot = "",
    [string]$Output = "data/job-catalog.json"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = Split-Path -Parent $scriptDir
}

$pythonScript = Join-Path $PSScriptRoot "build-job-catalog.py"
if (-not (Test-Path -Path $pythonScript -PathType Leaf)) {
    throw "Missing Python build script: $pythonScript"
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    throw "Python is not installed or not in PATH."
}

$args = @(
    $pythonScript,
    "--csv-path", $CsvPath,
    "--repo-root", $RepoRoot,
    "--output", $Output
)

& python @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
