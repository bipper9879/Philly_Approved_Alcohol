param(
    [string]$ImagePath,

    [string]$ImageName,

    [string]$SourceRoot = "C:\Users\bippe\OneDrive\Documents\posters\Philly\07-03-2026_Philly",

    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),

    [string]$Branch = "main",

    [string]$CommitMessage,

    [switch]$Push
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,

        [string]$FailureMessage = "Command failed"
    )

    Write-Host "> $Command"
    Invoke-Expression $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code: $LASTEXITCODE)"
    }
}

function Normalize-LocationName {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }

    $normalized = $Value.ToLowerInvariant()
    $normalized = $normalized -replace "&", " and "
    $normalized = $normalized -replace "[^a-z0-9]", ""
    return $normalized
}

function Resolve-ImageFile {
    param(
        [string]$InputPath,
        [string]$InputName,
        [string]$LookupRoot
    )

    if (-not [string]::IsNullOrWhiteSpace($InputPath)) {
        $resolved = Resolve-Path -Path $InputPath -ErrorAction Stop
        return Get-Item -LiteralPath $resolved
    }

    if ([string]::IsNullOrWhiteSpace($InputName)) {
        throw "Provide -ImagePath or -ImageName."
    }

    if (-not (Test-Path -LiteralPath $LookupRoot)) {
        throw "Source root not found: $LookupRoot"
    }

    $matches = Get-ChildItem -LiteralPath $LookupRoot -Recurse -File |
        Where-Object { $_.Name -ieq $InputName }

    if ($matches.Count -eq 0) {
        throw "No file named '$InputName' found under: $LookupRoot"
    }

    if ($matches.Count -gt 1) {
        $list = ($matches | Select-Object -First 10 | ForEach-Object { $_.FullName }) -join "`n"
        throw "More than one file named '$InputName' was found. Use -ImagePath to disambiguate.`n$list"
    }

    return $matches[0]
}

$imageItem = Resolve-ImageFile -InputPath $ImagePath -InputName $ImageName -LookupRoot $SourceRoot
if (-not $imageItem.PSIsContainer -and $imageItem.Extension -eq "") {
    throw "Image path must point to a file"
}

$indexFilesRoot = Join-Path $RepoRoot "index_files"
if (-not (Test-Path -LiteralPath $indexFilesRoot)) {
    throw "index_files folder not found at: $indexFilesRoot"
}

$sourceFolderName = Split-Path -Leaf (Split-Path -Parent $imageItem.FullName)
$destFolder = Join-Path $indexFilesRoot $sourceFolderName

if (-not (Test-Path -LiteralPath $destFolder)) {
    $sourceNorm = Normalize-LocationName -Value $sourceFolderName
    $candidateDirs = Get-ChildItem -LiteralPath $indexFilesRoot -Directory

    $matches = $candidateDirs | Where-Object {
        $destNorm = Normalize-LocationName -Value $_.Name
        $destNorm -eq $sourceNorm -or $destNorm.Contains($sourceNorm) -or $sourceNorm.Contains($destNorm)
    }

    if ($matches.Count -eq 1) {
        $destFolder = $matches[0].FullName
        $sourceFolderName = $matches[0].Name
    } else {
        throw "Could not match source folder '$sourceFolderName' to a single location in index_files."
    }
}

$destCover = Join-Path $destFolder "cover.jpg"
Copy-Item -LiteralPath $imageItem.FullName -Destination $destCover -Force
Write-Host "Copied cover image to: $destCover"

$buildScript = Join-Path $PSScriptRoot "build-gallery-data.ps1"
if (-not (Test-Path -LiteralPath $buildScript)) {
    throw "Required script missing: $buildScript"
}

Push-Location $RepoRoot
try {
    Invoke-Checked -Command "git switch $Branch" -FailureMessage "Failed to switch branch"
    Invoke-Checked -Command "powershell -ExecutionPolicy Bypass -File `"$buildScript`"" -FailureMessage "Failed to rebuild gallery-data.json"

    $relativeCover = "index_files/$sourceFolderName/cover.jpg"
    Invoke-Checked -Command "git add -- `"$relativeCover`" gallery-data.json" -FailureMessage "Failed to stage files"

    if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
        $CommitMessage = "Set cover photo for $sourceFolderName"
    }

    $staged = git diff --cached --name-only
    if (-not $staged) {
        Write-Host "No staged changes detected. Nothing to commit."
        return
    }

    Invoke-Checked -Command "git commit -m `"$CommitMessage`"" -FailureMessage "Failed to commit changes"

    if ($Push) {
        Invoke-Checked -Command "git push origin $Branch" -FailureMessage "Failed to push changes"
    }

    Write-Host "Done."
} finally {
    Pop-Location
}