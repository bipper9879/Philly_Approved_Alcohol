# Philly Approved Alcohol

Public site:
https://bipper9879.github.io/Philly_Approved_Alcohol

## What This Site Does

This project publishes a location gallery website from GitHub Pages.

- Main landing page comes from Excel-exported files at the repo root and in index_files.
- Each Click to View Photos link routes to gallery.html with a location query parameter.
- Gallery behavior:
  - Shows a public cover image first.
  - Hides the rest of photos by default.
  - Lets viewers click Show all photos to reveal thumbnails.
  - Provides request buttons to propose a cover change:
	 - GitHub issue request
	 - Email fallback

## Repository Structure

- index.html
  - Excel-exported entry page.
- index_files/
  - Per-location folders and photo files.
  - Includes sheet001.html and related Excel support files.
- gallery.html
  - Gallery UI and behavior.
- gallery-links.js
  - Rewrites Excel photo links to gallery.html URLs.
- gallery-data.json
  - Generated index of locations, images, and cover image name.
- scripts/build-gallery-data.ps1
  - Rebuilds gallery-data.json from folders and images.
- scripts/set-cover-from-image.ps1
  - Helper script to set cover.jpg from an image, rebuild data, commit, and optionally push.

## Cover Image Rules

Public cover selection for each location:

1. cover.jpg if present
2. otherwise first image in that folder

If cover.jpg is deleted later, the site falls back to first image after rebuilding and pushing gallery-data.json.

## Daily Update Workflow

When you add, remove, or rename images in index_files:

1. Rebuild data

	powershell -ExecutionPolicy Bypass -File .\scripts\build-gallery-data.ps1

2. Stage changes

	git add index_files gallery-data.json

3. Commit

	git commit -m "Update photos and gallery data"

4. Push

	git push origin main

5. Verify deployment in Actions and test live URL

	https://bipper9879.github.io/Philly_Approved_Alcohol

## Manual Cover Change (Step-by-Step)

Use this when you accept a cover request ticket.

1. Copy chosen image to cover.jpg in that location folder

	Example:
	Copy-Item "index_files/N 15th St & Race St/IMG_20260522_061203_DRO.jpg" "index_files/N 15th St & Race St/cover.jpg" -Force

2. Rebuild gallery data

	powershell -ExecutionPolicy Bypass -File .\scripts\build-gallery-data.ps1

3. Stage

	git add index_files gallery-data.json

4. Commit

	git commit -m "Set cover photo for N 15th St & Race St"

5. Push

	git push origin main

## Smart One-Command Cover Update

Helper script supports two modes.

Mode A: known full image path

powershell -ExecutionPolicy Bypass -File .\scripts\set-cover-from-image.ps1 -ImagePath "C:\full\path\to\image.jpg" -Push

Mode B: image filename only (auto-searches configured source root)

powershell -ExecutionPolicy Bypass -File .\scripts\set-cover-from-image.ps1 -ImageName "IMG_20260522_061203_DRO.jpg" -Push

Notes:

- If filename appears in more than one folder, the script will stop and ask you to use ImagePath.
- Push is optional. Remove -Push if you want to inspect commit before publishing.

## Viewer Request Flow

In gallery.html, users can request public cover changes.

- Make this the public cover opens a prefilled GitHub issue.
- Email this request opens a prefilled mail draft to bipper9879@hotmail.com.

You review request details, then apply manual cover change or smart script flow.

## GitHub Pages Configuration

Recommended source in repo Settings -> Pages:

- Source: GitHub Actions

Why:

- Avoids conflicts between branch-based default pages build and custom workflow deploy.
- Uses .github/workflows/pages.yml as single deployment path.

## Troubleshooting

### Site appears stale

- Check latest Actions deploy is green for newest commit.
- Test in incognito or use cache-buster query, for example ?v=12.

### Gallery says location not matched

- Ensure URL location parameter is encoded correctly.
- Ensure location folder exists under index_files.
- Rebuild and push gallery-data.json.

### Cover not changing

- Verify cover.jpg exists in the exact location folder.
- Rebuild gallery-data.json and push.

### Red X on deploy

- Confirm Pages source is GitHub Actions, not Branch.
- Re-run Deploy GitHub Pages workflow manually.
- Node.js deprecation notices are warnings unless run status is failure.

## Quick Publish Checklist

1. git status -sb is clean after push
2. Latest Deploy GitHub Pages run is success
3. Root URL loads:
	https://bipper9879.github.io/Philly_Approved_Alcohol
4. Test one location gallery:
	- Cover first
	- Show all photos toggle works
