param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Email = "bipper9879@hotmail.com"
)

$indexFilesRoot = Join-Path $RepoRoot "index_files"
$outputPath = Join-Path $RepoRoot "gallery-data.json"
$imageExtensions = @(".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")

function Get-EncodedSegment {
    param([string]$Value)

    return [System.Uri]::EscapeDataString($Value)
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
                    url = $folderUrl + (Get-EncodedSegment -Value $_.Name)
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

        [ordered]@{
            location = $folder.Name
            folderName = $folder.Name
            folderUrl = $folderUrl
            coverImageName = $coverImageName
            images = @($images)
        }
    }

$payload = [ordered]@{
    email = $Email
    issueUrlBase = "https://github.com/bipper9879/Philly_Approved_Alcohol/issues/new"
    locations = @($locations)
}

$payload |
    ConvertTo-Json -Depth 6 |
    Set-Content -Path $outputPath -Encoding UTF8