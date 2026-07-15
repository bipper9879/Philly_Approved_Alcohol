# buildPortfolio

Multi-city field photo review and client portfolio approval platform.

**GitHub repo:** `bipper9879/buildPortfolio`  
**Active branch:** `addingJobNumber` (feature branch — not yet merged to `main`)

---

## Local machine paths (bipper9879)

These are machine-specific and must **never** be committed to GitHub.
Store them in `.env` and `data/city-sources.json` (both gitignored).

| Purpose | Path |
|---|---|
| Repo clone (worktree) | `C:\Users\bippe\.copilot\repos\copilot-worktrees\Philly_Approved_Alcohol\bipper9879-studious-engine` |
| Repo clone (main) | `C:\Users\bippe\OneDrive\Workspace\Projects\Philly_Approved_Alcohol` |
| Philly images root | `C:\Users\bippe\OneDrive\Documents\posters\Philly` |
| DC images root | `C:\Users\bippe\OneDrive\Documents\posters\dc` |
| Boston images root | `C:\Users\bippe\OneDrive\Documents\posters\boston` |
| City sources config | `data/city-sources.json` (gitignored — local only) |
| Environment config | `.env` (gitignored — local only) |

---

## What this app does

A Node.js + Express web app that serves a **multi-city location gallery**
with a full reviewer → owner → public approval workflow.

- **Public** — browse approved locations, view cover photo, submit cover requests (key-gated).
- **Reviewer** — browse full photo sets by city/job, select cover candidates, submit to owner queue.
- **Owner** — approve/reject reviewer submissions, publish locations to public, manage queue.
- **Background refresh** — automatically rebuilds gallery data from city workbooks + image folders every 60 seconds.

Routes:
- Public: `http://localhost:3000/app/`
- Reviewer: `http://localhost:3000/app/reviewer.html`
- Owner: `http://localhost:3000/app/owner.html`
- Legacy: `http://localhost:3000/legacy`

---

## Local setup

## Local setup

1. Install Node.js 20+.
2. Install packages:
   ```powershell
   npm install
   ```
3. Copy env template and fill in your values:
   ```powershell
   Copy-Item .env.example .env
   ```
   Key `.env` values to set:
   - `REVIEWER_KEY` — secret key for reviewer login
   - `OWNER_KEY` — secret key for owner login
   - `PUBLIC_KEY` — global public access key (full access)
   - `GALLERY_WORKBOOK_PATH` — path to your workbook (used by single-city legacy mode)
   - `GALLERY_IMAGES_ROOT_PATH` — path to your images root (legacy mode)
   - `DATA_REFRESH_INTERVAL_MS` — how often to rebuild gallery data (default 60000ms)

4. Configure city sources for multi-city mode.
   Create `data/city-sources.json` (this file is gitignored — stays local only):
   ```json
   [
     {
       "id": "philly",
       "city": "Philly",
       "workbookPath": "C:\\Users\\bippe\\OneDrive\\Documents\\posters\\Philly\\Philly_Workbook.xlsx",
       "imagesRootPath": "C:\\Users\\bippe\\OneDrive\\Documents\\posters\\Philly",
       "active": true
     },
     {
       "id": "dc",
       "city": "DC",
       "workbookPath": "C:\\Users\\bippe\\OneDrive\\Documents\\posters\\dc\\DC_Workbook.xlsx",
       "imagesRootPath": "C:\\Users\\bippe\\OneDrive\\Documents\\posters\\dc",
       "active": true
     },
     {
       "id": "boston",
       "city": "Boston",
       "workbookPath": "C:\\Users\\bippe\\OneDrive\\Documents\\posters\\boston\\Boston_Workbook.xlsx",
       "imagesRootPath": "C:\\Users\\bippe\\OneDrive\\Documents\\posters\\boston",
       "active": true
     }
   ]
   ```

5. Start server:
   ```powershell
   npm run dev
   ```

6. Open:
   - Public: `http://localhost:3000/app/`
   - Reviewer: `http://localhost:3000/app/reviewer.html`
   - Owner: `http://localhost:3000/app/owner.html`

### Dev credentials (local only)

These are default fallback keys when `.env` values are not set:

| Role | Login key |
|---|---|
| Reviewer | `dev-reviewer-key` |
| Owner | `dev-owner-key` |
| Public | `dev-public-key` |

Set real keys in `.env` before sharing or demoing.

### Troubleshooting startup

- **Gallery build failed / Permission denied on workbook** — close the workbook in Excel first, then restart.
- **Failed to load filter options: 500** — check that `data/city-sources.json` exists and paths are correct.
- **No locations showing for reviewer/owner** — confirm workbook has numeric values in column D or E for the rows you want visible.
- **`Active Root Directory` wrong in UID log** — set `WILDPOSTING_POSTERS_ROOT` env var before running UID scripts.

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
  - PowerShell wrapper that rebuilds gallery-data.json from workbook + image folders.
- scripts/build-gallery-data.py
  - Direct workbook parser (`.xlsx`) used by the wrapper script.
- scripts/set-cover-from-image.ps1
  - Helper script to set cover.jpg from an image, rebuild data, commit, and optionally push.
- server.js
  - Express API + web server for public/reviewer experiences.
- public/app/
  - New UI pages (public list, public location page, reviewer console).
- data/cover-overrides.json
  - Reviewer-selected cover overrides by location.
- data/cover-requests.json
  - Stored public cover requests for reviewer queue.
- data/image-source.json
  - Active image-root source used by `/images` route.

## Cover Image Rules

Public cover selection for each location:

1. cover.jpg if present
2. otherwise first image in that folder

If cover.jpg is deleted later, the site falls back to first image after rebuilding and pushing gallery-data.json.

## Daily Update Workflow

When you add, remove, or rename images in index_files:

1. Rebuild data

	powershell -ExecutionPolicy Bypass -File .\scripts\build-gallery-data.ps1 -WorkbookPath "C:\full\path\to\your-workbook.xlsx" -ImagesRootPath "C:\full\path\to\images-root" -City "DC"

2. Stage changes

	git add index_files gallery-data.json

3. Commit

	git commit -m "Update photos and gallery data"

4. Push

	git push origin main

5. Verify deployment in Actions and test live URL

	https://bipper9879.github.io/Philly_Approved_Alcohol

## One-Command Workbook Sync

If your source workbook changed, run this script to:
1. pick workbook (or pass path),
2. parse workbook directly (`.xlsx`) with Python,
3. rebuild `gallery-data.json`.

Command:

`powershell -ExecutionPolicy Bypass -File .\scripts\sync-workbook-and-build.ps1 -WorkbookPath "C:\full\path\to\your-workbook.xlsx" -City "DC"`

If you omit `-WorkbookPath`, the script opens a file picker dialog. If you omit `-City`, the script requires a city selection before build runs.

`powershell -ExecutionPolicy Bypass -File .\scripts\sync-workbook-and-build.ps1`

If workbook is locked/open, the script shows a popup asking you to save/close the workbook, then click OK to retry.

Optional worksheet name:

`powershell -ExecutionPolicy Bypass -File .\scripts\sync-workbook-and-build.ps1 -WorkbookPath "C:\full\path\to\your-workbook.xlsx" -WorksheetName "Sheet1"`

Optional image-root and city:

`powershell -ExecutionPolicy Bypass -File .\scripts\sync-workbook-and-build.ps1 -WorkbookPath "C:\full\path\to\your-workbook.xlsx" -ImagesRootPath "C:\full\path\to\images-root" -City "DC"`


## Job Catalog Build (CSV -> JSON)

Use this to generate data/job-catalog.json from your planning/export CSV.

Command:

powershell -ExecutionPolicy Bypass -File .\scripts\build-job-catalog.ps1 -CsvPath "C:\full\path\to\job-catalog.csv"

Required CSV columns:

Post,Remove,job#,Campaign,Market/Borough

Notes:

- Keep source dates as MM/DD/YYYY in CSV.
- Builder stores both display dates (MM/DD/YYYY) and normalized dates (YYYY-MM-DD) in JSON.
- Any extra CSV columns are preserved under each job's attributes object for troubleshooting and future integrations.
- Background auto-refresh: on server startup and every DATA_REFRESH_INTERVAL_MS (default 60000), the app checks inputs and rebuilds data/job-catalog.json, gallery-data.json, and data/location-job-map.json only when sources changed.
- Multi-city gallery refresh: configure active city inputs in `data/city-sources.json` (workbook + images root per city). Each cycle builds per-city artifacts in `data/gallery-cache/` and merges them into `gallery-data.json`.
- Gallery scanner is recursive (up to 6 levels), so city roots can contain mixed nested structures like `city/year/date/location` or `city/date/location` as long as the final location folder contains image files.
- Reviewer location filtering now prefers data/location-job-map.json when a selected job has map assignments; if a job has no map entries yet, it falls back to gallery jobNumbers.
- Public access keys:
  - `PUBLIC_KEY` in `.env` is a global full-access public key.
  - `data/public-access-keys.json` supports client-scoped keys with `allowedJobs` and `allowedCities` (set `active: true` to enable).

## City Sources Build (SharePoint synced root -> city-sources.json)

Use this to auto-build `data/city-sources.json` from a synced SharePoint root folder shaped like:

`root\City\...`

Command:

`powershell -ExecutionPolicy Bypass -File .\scripts\build-city-sources.ps1 -RootPath "C:\full\path\to\synced\root"`

Notes:

- Uses active city names from `data/cities.json` by default.
- Picks workbook in each city folder using best match (`*city*workbook*.xls*` first, then `*workbook*.xls*`).
- Writes `workbookPath` + `imagesRootPath` per city so the 60s refresh loop can build merged gallery data.
- Optional city override:
  `-Cities "DC,Philly,Boston"`
## Manual Cover Change (Step-by-Step)

Use this when you accept a cover request ticket.

1. Copy chosen image to cover.jpg in that location folder

	Example:
	Copy-Item "index_files/N 15th St & Race St/IMG_20260522_061203_DRO.jpg" "index_files/N 15th St & Race St/cover.jpg" -Force

2. Rebuild gallery data

	powershell -ExecutionPolicy Bypass -File .\scripts\build-gallery-data.ps1 -WorkbookPath "C:\full\path\to\your-workbook.xlsx" -City "DC"

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

## Target Authentication and RBAC End State

This section describes the intended production security model after the current local/dev key phase.

### Identity Provider

- Microsoft Entra ID (Azure AD) is the source of identity.
- Users must authenticate with organizational accounts.

### Tenant and Domain Rules

- Only approved tenant users may sign in.
- Primary domain allow rule: `*@npa.net`.
- Optional explicit allowlist/denylist can be applied for edge cases.

### RBAC Roles

- **Public**
  - Can view public cover-only pages.
  - Can submit a generic cover-review request.
  - Cannot browse full image folders.
- **Reviewer**
  - Can browse full image sets only for workbook-eligible locations.
  - Can select an image and submit a reviewed ticket for owner approval.
  - Cannot directly publish final cover to production.
- **Owner/Admin**
  - Can approve/reject reviewed tickets.
  - Approval publishes that location to public.
  - Can set cover directly (with automatic ticket/audit trail).
  - Can unpublish locations from public.
  - Can manage role assignments and policy settings.

### Role Assignment Source

- Preferred: Entra App Roles and/or Entra Security Groups.
- API authorization should resolve user roles from token claims and/or group membership.

### Enforcement Points

- Authorization is enforced server-side in API middleware.
- UI visibility is convenience only and must never be the primary security boundary.

### Audit and Traceability

Each workflow action should store:
- requester identity and timestamp
- reviewer identity and timestamp
- approver identity and timestamp
- selected image metadata
- final decision and reason/note

### Migration Path (Current -> Target)

1. Current phase: local dev keys + email allowlists for rapid MVP testing.
2. Next phase: add Entra sign-in and token validation middleware.
3. Replace key-based checks with role claims.
4. Enforce domain/tenant policy in auth pipeline.
5. Move secrets/settings to Azure App Service configuration (or Key Vault).

### Non-Goals for Public Role

- Public role must not access full folder images.
- Public role must not see reviewer/owner consoles.
- Public role must not bypass approval workflow.

## Azure Deployment Blocker and Recovery

If Azure CLI deployment fails with:
- `Current Limit (Total VMs): 0`
- `Operation cannot be completed without additional quota`

then App Service Plan creation is blocked at the subscription level.

### Switch subscriptions

List subscriptions:

`az account list -o table`

Set active subscription:

`az account set --subscription "<subscription-id-or-name>"`

Confirm active subscription:

`az account show -o table`

### Required quota fix

Request an Azure quota increase in the active subscription/region:
- Quota type: `Total VMs`
- Minimum target: `1`

Until quota is approved, App Service deployment cannot proceed.

### Runtime quoting note (PowerShell + az.cmd)

When creating the web app on Windows PowerShell, use:

`az webapp create --name philly-alcohol-app --resource-group philly-alcohol-rg --plan philly-alcohol-plan --runtime "NODE^|20-lts"`

### Temporary fallback while waiting for quota

Run locally with `npm run dev` and continue workflow testing until Azure quota is approved.

## Session Resume Snapshot

Use this section to resume quickly next month.

### Current working app routes

- Public: `http://localhost:3000/app/`
- Reviewer: `http://localhost:3000/app/reviewer.html`
- Owner: `http://localhost:3000/app/owner.html`
- Legacy: `http://localhost:3000/legacy`

### Current dev credentials

- Reviewer: `reviewer@local.test` / `philly-reviewer-dev`
- Owner: `owner@local.test` / `philly-owner-dev`

### Current workflow status

- Public can submit location-level request tickets.
- Reviewer can browse location photos and submit reviewed image selections.
- Owner can approve/reject and set cover directly.
- Site codes are parsed from workbook (column A) into `gallery-data.json`.

### Planned client-facing flow (future sprints)

- Client receives job-scoped link(s) so separate start-date jobs can be reviewed independently.
- Reviewer logs in, picks job number first, and city is derived/scoped from job mapping.
- Reviewer sees raw location-folder photos, selects a cover candidate, and submits to owner.
- Owner approval remains the gate before public changes are visible.
- Future automation target: owner approval triggers build link generation and email notification.

### Architecture direction (to keep future integration easy)

- Keep photo inventory in `gallery-data.json`, job/city planning in `data/job-catalog.json`, and job-to-location assignments in `data/location-job-map.json`.
- Keep ingestion pluggable: local CSV now, external client feed later with the same normalized contract.
- Keep reviewer flow consuming normalized job/city mapping so source-system changes do not require UI rewrites.

### Known remaining polish items

- Ticket ordering should keep pending/reviewed at top and completed below.
- Reviewer flow messaging needs final wording cleanup.
- Folder-open behavior and queue interaction need one final UX pass.
- Azure deployment blocked by tenant/auth/subscription context issues; local workflow is working.
- Multi-city support: make the app city-aware so it can serve Philly, DC, Boston, or any city.
  - Add city field to gallery-data.json per location.
  - Support multiple city data files or one merged file with city filter.
  - Add city picker to public/reviewer/owner UI.
  - Filter all API responses by selected city.
  - Update build script to accept city as a parameter.
  - Wire WildPosting project output as the input to the build step (depends on WildPosting output format).
  - WildPosting repos: C:\Users\bippe\OneDrive\Workspace\Projects\WildPosting (PowerShell) and WildPosting-DotNet (.NET).
  - WildPosting workflow: installer completes location list, dumps photos, runs WildPosting to generate lat/lon/street view and sort photos by GPS match to master city location list.
  - Do not start this work until WildPosting output format is finalized.
- Street view currently shows as a link (Open Street View button). To embed inline, add Google Maps Embed API key.
  - Get key from Google Cloud Console with Maps Embed API enabled.
  - Add allowed referrers for localhost and production domain in key settings.
  - Update .env with GOOGLE_MAPS_API_KEY and update location.js to use embed URL format:
    https://www.google.com/maps/embed/v1/streetview?key=YOUR_KEY&location=LAT,LON
  - No new key needed when moving to Azure; just add the new domain to allowed referrers.
