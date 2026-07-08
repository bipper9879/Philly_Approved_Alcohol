param(
    [string]$WorkbookPath = "",
    [string]$WorksheetName = "",
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
        $result = [System.Windows.Forms.MessageBox]::Show(
            $message,
            "Workbook is open",
            [System.Windows.Forms.MessageBoxButtons]::OKCancel,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
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
    } catch {
        throw "Could not load Windows file dialog. Pass -WorkbookPath explicitly."
    }

    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Select source workbook"
    $dialog.Filter = "Excel Workbook (*.xlsx;*.xlsm;*.xls)|*.xlsx;*.xlsm;*.xls|All files (*.*)|*.*"
    $dialog.CheckFileExists = $true
    $dialog.Multiselect = $false

    $result = $dialog.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($dialog.FileName)) {
        throw "Workbook selection was canceled."
    }
    return $dialog.FileName
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = Split-Path -Parent $scriptDir
}

if ([string]::IsNullOrWhiteSpace($WorkbookPath)) {
    $WorkbookPath = Select-WorkbookPath
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
    "-RepoRoot", $RepoRoot
)
if (-not [string]::IsNullOrWhiteSpace($WorksheetName)) {
    $args += @("-WorksheetName", $WorksheetName)
}

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
