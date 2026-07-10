param(
    [string]$WorkbookPath = "",
    [string]$WorksheetName = "",
    [string]$ImagesRootPath = "",
    [string]$City = "",
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

function Is-WorkbookLockError {
    param([string]$MessageText)
    if ([string]::IsNullOrWhiteSpace($MessageText)) { return $false }
    return (
        $MessageText -match "(?i)permission denied" -or
        $MessageText -match "(?i)being used by another process" -or
        $MessageText -match "(?i)winerror\s*32" -or
        $MessageText -match "(?i)sharing violation"
    )
}

function Prompt-WorkbookSaveAndClose {
    param([string]$WorkbookPath)

    $message = "Workbook appears to be open or locked:`n$WorkbookPath`n`nPlease save and close it, then click OK to continue.`nClick Cancel to stop."
    try {
        Add-Type -AssemblyName System.Windows.Forms | Out-Null
        Add-Type -AssemblyName System.Drawing | Out-Null
        $owner = New-Object System.Windows.Forms.Form
        $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
        $owner.Location = New-Object System.Drawing.Point(-32000, -32000)
        $owner.Size = New-Object System.Drawing.Size(1, 1)
        $owner.ShowInTaskbar = $false
        $owner.TopMost = $true
        $owner.Opacity = 0
        $owner.Show()
        $owner.Activate()
        $result = [System.Windows.Forms.MessageBox]::Show(
            $owner,
            $message,
            "Workbook is open",
            [System.Windows.Forms.MessageBoxButtons]::OKCancel,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        $owner.Close()
        $owner.Dispose()
        return $result -eq [System.Windows.Forms.DialogResult]::OK
    } catch {
        Write-Warning $message
        $choice = Read-Host "Type Y to continue or N to cancel"
        return $choice -match "^(?i)y(es)?$"
    }
}

function Select-WorkbookPath {
    try {
        Add-Type -AssemblyName System.Windows.Forms | Out-Null
        Add-Type -AssemblyName System.Drawing | Out-Null
    } catch {
        throw "Could not load Windows file dialog. Pass -WorkbookPath explicitly."
    }

    $owner = New-Object System.Windows.Forms.Form
    $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $owner.Location = New-Object System.Drawing.Point(-32000, -32000)
    $owner.Size = New-Object System.Drawing.Size(1, 1)
    $owner.ShowInTaskbar = $false
    $owner.TopMost = $true
    $owner.Opacity = 0
    $owner.Show()
    $owner.Activate()
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Select source workbook"
    $dialog.Filter = "Excel Workbook (*.xlsx;*.xlsm;*.xls)|*.xlsx;*.xlsm;*.xls|All files (*.*)|*.*"
    $dialog.CheckFileExists = $true
    $dialog.Multiselect = $false

    $result = $dialog.ShowDialog($owner)
    $owner.Close()
    $owner.Dispose()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($dialog.FileName)) {
        throw "Workbook selection was canceled."
    }
    return $dialog.FileName
}

function Select-ImagesRootPath {
    try {
        Add-Type -AssemblyName System.Windows.Forms | Out-Null
        Add-Type -AssemblyName System.Drawing | Out-Null
    } catch {
        throw "Could not load Windows folder dialog. Pass -ImagesRootPath explicitly."
    }

    $owner = New-Object System.Windows.Forms.Form
    $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $owner.Location = New-Object System.Drawing.Point(-32000, -32000)
    $owner.Size = New-Object System.Drawing.Size(1, 1)
    $owner.ShowInTaskbar = $false
    $owner.TopMost = $true
    $owner.Opacity = 0
    $owner.Show()
    $owner.Activate()

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Select image root folder (contains location subfolders)"
    $dialog.ShowNewFolderButton = $false
    $result = $dialog.ShowDialog($owner)
    $owner.Close()
    $owner.Dispose()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
        throw "Image-root folder selection was canceled."
    }
    return $dialog.SelectedPath
}

function Get-ActiveCities {
    param([string]$RepoRoot)
    $citiesPath = Join-Path $RepoRoot "data\\cities.json"
    if (-not (Test-Path -Path $citiesPath -PathType Leaf)) {
        return @()
    }
    try {
        $raw = Get-Content -Path $citiesPath -Raw | ConvertFrom-Json
        if ($raw -is [System.Array]) {
            return @(
                $raw |
                Where-Object { $_ -and $_.active -ne $false -and -not [string]::IsNullOrWhiteSpace([string]$_.name) } |
                ForEach-Object { [string]$_.name }
            )
        }
    } catch {
        return @()
    }
    return @()
}

function Select-City {
    param([string]$RepoRoot)

    $cities = Get-ActiveCities -RepoRoot $RepoRoot
    if ($cities.Count -gt 0) {
        Write-Host "Select City:"
        for ($i = 0; $i -lt $cities.Count; $i++) {
            Write-Host "  $($i + 1)) $($cities[$i])"
        }
        $choice = Read-Host "Enter city number or type city name"
        $choiceText = [string]$choice
        $idx = 0
        if ([int]::TryParse($choiceText, [ref]$idx)) {
            if ($idx -ge 1 -and $idx -le $cities.Count) {
                return $cities[$idx - 1]
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($choiceText)) {
            return $choiceText.Trim()
        }
    }

    $manualCity = Read-Host "City is required. Enter city tag (example: DC)"
    if ([string]::IsNullOrWhiteSpace($manualCity)) {
        throw "City is required."
    }
    return $manualCity.Trim()
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = Split-Path -Parent $scriptDir
}

if ([string]::IsNullOrWhiteSpace($WorkbookPath)) {
    $WorkbookPath = Select-WorkbookPath
}
if ([string]::IsNullOrWhiteSpace($ImagesRootPath)) {
    $ImagesRootPath = Select-ImagesRootPath
}
if ([string]::IsNullOrWhiteSpace($City)) {
    $City = Select-City -RepoRoot $RepoRoot
}

$buildScriptPath = Join-Path $PSScriptRoot "build-gallery-data.ps1"
if (-not (Test-Path -Path $buildScriptPath -PathType Leaf)) {
    throw "Missing build script: $buildScriptPath"
}

Write-Host "Building gallery data from workbook: $WorkbookPath"

$args = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $buildScriptPath,
    "-WorkbookPath", $WorkbookPath,
    "-ImagesRootPath", $ImagesRootPath,
    "-RepoRoot", $RepoRoot
)
if (-not [string]::IsNullOrWhiteSpace($WorksheetName)) {
    $args += @("-WorksheetName", $WorksheetName)
}
$args += @("-City", $City)

$attempt = 1
while ($true) {
    Write-Host "Build attempt $attempt..."
    $stdoutFile = [System.IO.Path]::GetTempFileName()
    $stderrFile = [System.IO.Path]::GetTempFileName()
    try {
        $process = Start-Process -FilePath "powershell" -ArgumentList $args -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
        $exitCode = $process.ExitCode
        $stdoutText = if (Test-Path $stdoutFile) { Get-Content -Path $stdoutFile -Raw } else { "" }
        $stderrText = if (Test-Path $stderrFile) { Get-Content -Path $stderrFile -Raw } else { "" }
        $outputText = ($stdoutText + "`n" + $stderrText).Trim()
    }
    finally {
        if (Test-Path $stdoutFile) { Remove-Item $stdoutFile -Force }
        if (Test-Path $stderrFile) { Remove-Item $stderrFile -Force }
    }

    if (-not [string]::IsNullOrWhiteSpace($outputText)) {
        Write-Host $outputText
    }

    if ($exitCode -eq 0) {
        break
    }

    if (Is-WorkbookLockError -MessageText $outputText) {
        $retry = Prompt-WorkbookSaveAndClose -WorkbookPath $WorkbookPath
        if ($retry) {
            $attempt++
            continue
        }
        throw "Sync canceled because workbook stayed locked."
    }

    throw "Sync failed. See errors above."
}

Write-Host "Sync complete."
