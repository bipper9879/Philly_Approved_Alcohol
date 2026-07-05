param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Email = "bipper9879@hotmail.com"
)

$indexFilesRoot = Join-Path $RepoRoot "index_files"
$sheetPath      = Join-Path $indexFilesRoot "sheet001.html"
$outputPath     = Join-Path $RepoRoot "gallery-data.json"
$imageExtensions = @(".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")

function Get-EncodedSegment {
    param([string]$Value)
    return [System.Uri]::EscapeDataString($Value)
}

# Parse site codes from sheet001.html.
# Each data row has: <td class=xl65>PHI-XXXXXX</td> ... <td>Location Name</td>
$siteCodeMap = @{}
if (Test-Path $sheetPath) {
    $html = Get-Content -Path $sheetPath -Encoding Default -Raw

    # Match every <tr> that contains a PHI- site code
    $rowPattern  = '(?s)<tr[^>]*>.*?</tr>'
    $rows        = [regex]::Matches($html, $rowPattern)

    foreach ($row in $rows) {
        $rowHtml = $row.Value

        # Site code cell: xl65 class contains PHI-XXXXXX
        $codeMatch = [regex]::Match($rowHtml, 'class=xl65[^>]*>\s*(PHI-[A-Fa-f0-9]+)\s*<')
        if (-not $codeMatch.Success) { continue }
        $siteCode = $codeMatch.Groups[1].Value.Trim()

        # Location name: third <td> (index 2), strip HTML tags
        # Match cells including multiline content (span tags etc.)
        $cells = [regex]::Matches($rowHtml, '(?s)<td[^>]*>(.*?)</td>')
        if ($cells.Count -lt 3) { continue }
        $rawLocation = $cells[2].Groups[1].Value
        $locationName = [regex]::Replace($rawLocation, '<[^>]+>', '').Trim()
        $locationName = [System.Net.WebUtility]::HtmlDecode($locationName)

        if ($locationName -and $siteCode) {
            $siteCodeMap[$locationName] = $siteCode
        }
    }
}

function Normalize-LocationKey {
    param([string]$Value)
    $v = $Value.ToLowerInvariant()
    $v = $v -replace '&', ' and '
    $v = $v -replace '[^a-z0-9]', ''
    return $v
}

# Build a normalized lookup so folder names that differ slightly still match.
$normalizedCodeMap = @{}
foreach ($key in $siteCodeMap.Keys) {
    $normalizedCodeMap[(Normalize-LocationKey $key)] = $siteCodeMap[$key]
}

$locations = Get-ChildItem -Path $indexFilesRoot -Directory |
    Sort-Object Name |
    ForEach-Object {
        $folder = $_
        $folderUrl = "index_files/$([System.Uri]::EscapeDataString($folder.Name))/"

        $images = Get-ChildItem -Path $folder.FullName -File |
            Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() } |
            Sort-Object Name |
            ForEach-Object {
                [ordered]@{
                    name = $_.Name
                    url  = $folderUrl + (Get-EncodedSegment -Value $_.Name)
                }
            }

        $coverImageName = $null
        if ($images.Count -gt 0) {
            $explicitCover = $images | Where-Object { $_.name -ieq "cover.jpg" } | Select-Object -First 1
            if ($explicitCover) {
                $coverImageName = $explicitCover.name
            } else {
                $coverImageName = $images[0].name
            }
        }

        # Look up site code by exact name first, then normalized key.
        $siteCode = $null
        if ($siteCodeMap.ContainsKey($folder.Name)) {
            $siteCode = $siteCodeMap[$folder.Name]
        } else {
            $normKey = Normalize-LocationKey $folder.Name
            if ($normalizedCodeMap.ContainsKey($normKey)) {
                $siteCode = $normalizedCodeMap[$normKey]
            }
        }

        [ordered]@{
            siteCode      = $siteCode
            location      = $folder.Name
            folderName    = $folder.Name
            folderUrl     = $folderUrl
            coverImageName = $coverImageName
            images        = @($images)
        }
    }

$payload = [ordered]@{
    email        = $Email
    issueUrlBase = "https://github.com/bipper9879/Philly_Approved_Alcohol/issues/new"
    locations    = @($locations)
}

$payload |
    ConvertTo-Json -Depth 6 |
    Set-Content -Path $outputPath -Encoding UTF8

Write-Host "gallery-data.json rebuilt. $($locations.Count) locations written."
$matched   = ($locations | Where-Object { $_.siteCode }).Count
$unmatched = ($locations | Where-Object { -not $_.siteCode }).Count
Write-Host "  Site codes matched: $matched  |  Unmatched: $unmatched"
if ($unmatched -gt 0) {
    $locations | Where-Object { -not $_.siteCode } | ForEach-Object {
        Write-Host "  No site code: $($_.location)"
    }
}