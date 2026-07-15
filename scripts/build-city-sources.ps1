param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath,

    [string]$RepoRoot = "",
    [string]$Output = "data/city-sources.json",
    [string]$Cities = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = Split-Path -Parent $scriptDir
}

$pythonScript = Join-Path $PSScriptRoot "build-city-sources.py"
if (-not (Test-Path -Path $pythonScript -PathType Leaf)) {
    throw "Missing Python build script: $pythonScript"
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    throw "Python is not installed or not in PATH."
}

$args = @(
    $pythonScript,
    "--root-path", $RootPath,
    "--repo-root", $RepoRoot,
    "--output", $Output
)

if (-not [string]::IsNullOrWhiteSpace($Cities)) {
    $args += @("--cities", $Cities)
}

& python @args
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
