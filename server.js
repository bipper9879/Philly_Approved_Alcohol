require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const app = express();
const port = Number(process.env.PORT || 3000);

const repoRoot = __dirname;
const galleryDataPath = path.join(repoRoot, "gallery-data.json");
const dataDir = path.join(repoRoot, "data");
const coverOverridesPath = path.join(dataDir, "cover-overrides.json");
const coverRequestsPath = path.join(dataDir, "cover-requests.json");
const publishedLocationsPath = path.join(dataDir, "published-locations.json");
const imageSourcePath = path.join(dataDir, "image-source.json");
const citiesConfigPath = path.join(dataDir, "cities.json");
const citySourcesPath = path.join(dataDir, "city-sources.json");
const galleryCacheDir = path.join(dataDir, "gallery-cache");
const publicAccessKeysPath = path.join(dataDir, "public-access-keys.json");
const jobCatalogPath = path.join(dataDir, "job-catalog.json");
const locationJobMapPath = path.join(dataDir, "location-job-map.json");
const galleryBuilderPath = path.join(repoRoot, "scripts", "build-gallery-data.py");
const jobCatalogBuilderPath = path.join(repoRoot, "scripts", "build-job-catalog.py");
const jobCatalogCsvPath = process.env.JOB_CATALOG_CSV_PATH || path.join(repoRoot, "data", "job-catalog.csv");
const galleryWorkbookPath = process.env.GALLERY_WORKBOOK_PATH || "";
const galleryWorksheetName = process.env.GALLERY_WORKSHEET_NAME || "";
const galleryImagesRootPath = process.env.GALLERY_IMAGES_ROOT_PATH || "";
const galleryCity = process.env.GALLERY_CITY || "";
const dataRefreshIntervalMs = Number(process.env.DATA_REFRESH_INTERVAL_MS || 60000);
let lastJobCatalogCsvMtimeMs = null;
let lastGalleryBuildFingerprints = {};
let lastLocationMapSourceMtimeMs = null;
let refreshLoopInProgress = false;
let refreshLoopQueued = false;

const reviewerKey = process.env.REVIEWER_KEY || "dev-reviewer-key";
const ownerKey = process.env.OWNER_KEY || "dev-owner-key";
const publicKey = process.env.PUBLIC_KEY || "dev-public-key";
const allowlistEmails = (process.env.REVIEWER_EMAIL_ALLOWLIST || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const allowlistDomains = (process.env.REVIEWER_EMAIL_DOMAIN_ALLOWLIST || "")
  .split(",")
  .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);
const ownerEmails = (process.env.OWNER_EMAIL_ALLOWLIST || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

app.use(cors());
app.use(express.json());

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(coverOverridesPath)) {
    fs.writeFileSync(coverOverridesPath, "{}", "utf8");
  }
  if (!fs.existsSync(coverRequestsPath)) {
    fs.writeFileSync(coverRequestsPath, "[]", "utf8");
  }
  if (!fs.existsSync(publishedLocationsPath)) {
    fs.writeFileSync(publishedLocationsPath, "{}", "utf8");
  }
  if (!fs.existsSync(imageSourcePath)) {
    saveJson(imageSourcePath, {
      imagesRootPath: path.join(repoRoot, "index_files"),
      city: null
    });
  }
  if (!fs.existsSync(citiesConfigPath)) {
    saveJson(citiesConfigPath, [
      { id: "philly", name: "Philly", active: true },
      { id: "dc", name: "DC", active: true },
      { id: "boston", name: "Boston", active: true }
    ]);
  }
  if (!fs.existsSync(locationJobMapPath)) {
    saveJson(locationJobMapPath, {
      version: 1,
      assignments: []
    });
  }
  if (!fs.existsSync(citySourcesPath)) {
    saveJson(citySourcesPath, []);
  }
  if (!fs.existsSync(publicAccessKeysPath)) {
    saveJson(publicAccessKeysPath, []);
  }
  if (!fs.existsSync(galleryCacheDir)) {
    fs.mkdirSync(galleryCacheDir, { recursive: true });
  }
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveConfiguredPath(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  return path.isAbsolute(text) ? text : path.resolve(repoRoot, text);
}

function tryStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function normalizeLocationKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeJobToken(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    const integer = Math.trunc(numeric);
    if (Math.abs(numeric - integer) < 1e-9 && integer > 0) {
      return String(integer);
    }
  }
  const token = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9][A-Z0-9\-_]{1,}$/.test(token) ? token : "";
}

function loadJson(filePath, fallbackValue) {
  try {
    const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return fallbackValue;
  }
}

function saveJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadGalleryData() {
  const data = loadJson(galleryDataPath, { locations: [] });
  if (!Array.isArray(data.locations)) {
    throw new Error("gallery-data.json has invalid shape.");
  }
  return data;
}

function loadOverrides() {
  const data = loadJson(coverOverridesPath, {});
  return data && typeof data === "object" ? data : {};
}

function loadRequests() {
  const data = loadJson(coverRequestsPath, []);
  return Array.isArray(data) ? data : [];
}

function isCompletedRequestStatus(status) {
  return ["approved", "rejected", "dismissed", "resolved"].includes(status);
}

function markRequestArchived(request, archivedBy, archivedReason, fallbackTimestamp) {
  let changed = false;
  if (!request.archivedAt) {
    request.archivedAt = request.resolvedAt || fallbackTimestamp;
    changed = true;
  }
  if (!request.archivedBy) {
    request.archivedBy = archivedBy;
    changed = true;
  }
  if (archivedReason && !request.archivedReason) {
    request.archivedReason = archivedReason;
    changed = true;
  }
  return changed;
}

function normalizeAndPartitionRequests(allRequests, archivedBy) {
  const requests = Array.isArray(allRequests) ? allRequests : [];
  const fallbackTimestamp = new Date().toISOString();
  let dirty = false;

  requests.forEach((request) => {
    if (request.status === "pending" && !request.requestedImageName) {
      request.status = "dismissed";
      request.resolvedBy = request.resolvedBy || archivedBy;
      request.resolvedAt = request.resolvedAt || fallbackTimestamp;
      dirty = true;
      dirty = markRequestArchived(
        request,
        archivedBy,
        "Stale pending request without selected image.",
        fallbackTimestamp
      ) || dirty;
      return;
    }

    if (isCompletedRequestStatus(request.status)) {
      dirty = markRequestArchived(request, request.resolvedBy || archivedBy, null, fallbackTimestamp) || dirty;
    }
  });

  const activeRequests = requests.filter((request) => !request.archivedAt);
  const archivedRequests = requests.filter((request) => Boolean(request.archivedAt));
  return { requests, activeRequests, archivedRequests, dirty };
}

function loadPublishedLocations() {
  const data = loadJson(publishedLocationsPath, {});
  return data && typeof data === "object" ? data : {};
}

function loadImageSource() {
  const fallback = {
    imagesRootPath: path.join(repoRoot, "index_files"),
    city: null,
    workbookPath: "",
    worksheetName: ""
  };
  const data = loadJson(imageSourcePath, fallback);
  if (!data || typeof data !== "object") {
    return fallback;
  }
  const configuredRoot = typeof data.imagesRootPath === "string"
    ? data.imagesRootPath.trim()
    : "";
  return {
    imagesRootPath: configuredRoot || fallback.imagesRootPath,
    city: data.city || null,
    workbookPath: typeof data.workbookPath === "string" ? data.workbookPath.trim() : "",
    worksheetName: typeof data.worksheetName === "string" ? data.worksheetName.trim() : ""
  };
}

function loadCityRegistry() {
  const data = loadJson(citiesConfigPath, []);
  if (!Array.isArray(data)) {
    return ["Philly", "DC", "Boston"];
  }
  const names = data
    .filter((item) => item && typeof item === "object" && item.active !== false)
    .map((item) => normalizeText(item.name))
    .filter(Boolean);
  return Array.from(new Set(names));
}
function loadJobCatalogJobs() {
  const data = loadJson(jobCatalogPath, { jobs: [] });
  if (!data || typeof data !== "object" || !Array.isArray(data.jobs)) {
    return [];
  }
  return data.jobs;
}

function loadLocationJobAssignments() {
  const data = loadJson(locationJobMapPath, { assignments: [] });
  if (!data || typeof data !== "object" || !Array.isArray(data.assignments)) {
    return [];
  }

  return data.assignments
    .filter((entry) => entry && typeof entry === "object" && entry.active !== false)
    .map((entry) => ({
      jobNumber: normalizeJobToken(entry.jobNumber),
      city: normalizeText(entry.city),
      locationId: normalizeLocationKey(entry.locationId || entry.locationName || entry.siteCode)
    }))
    .filter((entry) => entry.jobNumber && entry.locationId);
}

function buildImageRootFingerprint(imagesRootPath) {
  const rootStats = tryStat(imagesRootPath);
  if (!rootStats || !rootStats.isDirectory()) {
    return "";
  }

  const folderStamps = fs.readdirSync(imagesRootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folderPath = path.join(imagesRootPath, entry.name);
      const folderStats = tryStat(folderPath);
      const stamp = folderStats ? Math.trunc(folderStats.mtimeMs) : 0;
      return `${entry.name}:${stamp}`;
    })
    .sort((a, b) => a.localeCompare(b));

  return `${Math.trunc(rootStats.mtimeMs)}|${folderStamps.join(",")}`;
}

function normalizeSourceId(value) {
  const normalized = normalizeText(value).toLowerCase().replace(/[^a-z0-9\-_]/g, "-");
  return normalized || "city";
}

function resolveGalleryBuildConfig() {
  const source = loadImageSource();
  const city = normalizeText(galleryCity || source.city);
  return {
    id: normalizeSourceId(city || "default"),
    city,
    workbookPath: resolveConfiguredPath(galleryWorkbookPath || source.workbookPath),
    worksheetName: normalizeText(galleryWorksheetName || source.worksheetName),
    imagesRootPath: resolveConfiguredPath(galleryImagesRootPath || source.imagesRootPath)
  };
}

function loadCitySources() {
  const configured = loadJson(citySourcesPath, []);
  if (Array.isArray(configured)) {
    const active = configured
      .filter((entry) => entry && typeof entry === "object" && entry.active !== false)
      .map((entry) => ({
        id: normalizeSourceId(entry.id || entry.city),
        city: normalizeText(entry.city),
        workbookPath: resolveConfiguredPath(entry.workbookPath),
        worksheetName: normalizeText(entry.worksheetName),
        imagesRootPath: resolveConfiguredPath(entry.imagesRootPath)
      }))
      .filter((entry) => entry.city && entry.workbookPath && entry.imagesRootPath);
    if (active.length > 0) {
      return active;
    }
  }

  const legacy = resolveGalleryBuildConfig();
  return legacy.city && legacy.workbookPath && legacy.imagesRootPath ? [legacy] : [];
}

function buildCityArtifactPath(sourceId) {
  return path.join(galleryCacheDir, `gallery-data.${normalizeSourceId(sourceId)}.json`);
}

function buildMergedGalleryPayload(artifactPaths) {
  const mergedLocations = [];
  const seen = new Set();
  let email = "bipper9879@hotmail.com";
  let issueUrlBase = "https://github.com/bipper9879/buildPortfolio/issues/new";

  artifactPaths.forEach((artifactPath) => {
    const cityData = loadJson(artifactPath, { locations: [] });
    if (cityData && typeof cityData === "object") {
      if (normalizeText(cityData.email)) {
        email = normalizeText(cityData.email);
      }
      if (normalizeText(cityData.issueUrlBase)) {
        issueUrlBase = normalizeText(cityData.issueUrlBase);
      }
    }
    const locations = Array.isArray(cityData.locations) ? cityData.locations : [];
    locations.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }
      const key = `${normalizeText(entry.city).toLowerCase()}|${normalizeLocationKey(entry.location)}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      mergedLocations.push(entry);
    });
  });

  mergedLocations.sort((a, b) =>
    normalizeText(a.city).localeCompare(normalizeText(b.city))
    || normalizeText(a.location).localeCompare(normalizeText(b.location))
  );

  return {
    email,
    issueUrlBase,
    locations: mergedLocations
  };
}

function refreshJobCatalogIfNeeded() {
  if (!jobCatalogCsvPath) {
    return false;
  }
  if (!fs.existsSync(jobCatalogBuilderPath)) {
    throw new Error(`Missing builder script: ${jobCatalogBuilderPath}`);
  }
  if (!fs.existsSync(jobCatalogCsvPath)) {
    return false;
  }

  const csvStats = fs.statSync(jobCatalogCsvPath);
  const csvMtimeMs = csvStats.mtimeMs;
  if (lastJobCatalogCsvMtimeMs != null && csvMtimeMs <= lastJobCatalogCsvMtimeMs && fs.existsSync(jobCatalogPath)) {
    return false;
  }

  const result = spawnSync("python", [
    jobCatalogBuilderPath,
    "--csv-path", jobCatalogCsvPath,
    "--repo-root", repoRoot,
    "--output", jobCatalogPath
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.error) {
    throw new Error(`Failed to start Python builder: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const details = normalizeText(result.stderr) || normalizeText(result.stdout) || "Unknown job catalog build error.";
    throw new Error(details);
  }

  lastJobCatalogCsvMtimeMs = csvMtimeMs;
  return true;
}

function refreshGalleryDataIfNeeded() {
  const sources = loadCitySources();
  if (sources.length === 0) {
    return false;
  }
  if (!fs.existsSync(galleryBuilderPath)) {
    throw new Error(`Missing builder script: ${galleryBuilderPath}`);
  }

  const artifactPaths = [];
  let anyCityChanged = false;

  sources.forEach((source) => {
    if (!fs.existsSync(source.workbookPath)) {
      console.warn(`[data-refresh] skipped city "${source.city}" (missing workbook: ${source.workbookPath})`);
      return;
    }
    if (!fs.existsSync(source.imagesRootPath)) {
      console.warn(`[data-refresh] skipped city "${source.city}" (missing images root: ${source.imagesRootPath})`);
      return;
    }

    const workbookStats = fs.statSync(source.workbookPath);
    const imageFingerprint = buildImageRootFingerprint(source.imagesRootPath);
    const nextFingerprint = JSON.stringify({
      workbookMtimeMs: Math.trunc(workbookStats.mtimeMs),
      imageFingerprint,
      worksheetName: source.worksheetName,
      city: source.city
    });

    const artifactPath = buildCityArtifactPath(source.id);
    const previousFingerprint = lastGalleryBuildFingerprints[source.id] || "";
    const needsBuild = nextFingerprint !== previousFingerprint || !fs.existsSync(artifactPath);
    if (needsBuild) {
      const urlPrefix = `images/${source.id}`;
      const args = [
        galleryBuilderPath,
        "--workbook-path", source.workbookPath,
        "--repo-root", repoRoot,
        "--images-root", source.imagesRootPath,
        "--city", source.city,
        "--url-prefix", urlPrefix,
        "--output-path", artifactPath,
        "--skip-image-source-write"
      ];
      if (source.worksheetName) {
        args.push("--worksheet-name", source.worksheetName);
      }

      const result = spawnSync("python", args, {
        cwd: repoRoot,
        encoding: "utf8"
      });
      if (result.error) {
        throw new Error(`Failed to start gallery builder for city "${source.city}": ${result.error.message}`);
      }
      if (result.status !== 0) {
        const details = normalizeText(result.stderr) || normalizeText(result.stdout) || "Unknown gallery build error.";
        throw new Error(`Gallery build failed for city "${source.city}": ${details}`);
      }

      anyCityChanged = true;
      lastGalleryBuildFingerprints[source.id] = nextFingerprint;
    }

    artifactPaths.push(artifactPath);
  });

  if (artifactPaths.length === 0) {
    return false;
  }

  const mergedPayload = buildMergedGalleryPayload(artifactPaths);
  const nextContent = `${JSON.stringify(mergedPayload, null, 2)}\n`;
  const currentContent = fs.existsSync(galleryDataPath) ? fs.readFileSync(galleryDataPath, "utf8").replace(/^\uFEFF/, "") : "";
  if (nextContent !== currentContent) {
    fs.writeFileSync(galleryDataPath, nextContent, "utf8");
    return true;
  }

  return anyCityChanged;
}

function refreshLocationJobMapFromGalleryIfNeeded() {
  const galleryStats = tryStat(galleryDataPath);
  if (!galleryStats || !galleryStats.isFile()) {
    return false;
  }

  const sourceMtimeMs = Math.trunc(galleryStats.mtimeMs);
  if (lastLocationMapSourceMtimeMs != null && sourceMtimeMs <= lastLocationMapSourceMtimeMs && fs.existsSync(locationJobMapPath)) {
    return false;
  }

  const data = loadGalleryData();
  const assignments = [];
  const seen = new Set();

  data.locations.forEach((entry) => {
    const locationName = normalizeText(entry && entry.location);
    const locationId = normalizeLocationKey(locationName || entry.locationId || entry.siteCode);
    if (!locationId || !Array.isArray(entry && entry.jobNumbers)) {
      return;
    }

    const city = normalizeText(entry && entry.city);
    entry.jobNumbers.forEach((jobNumber) => {
      const token = normalizeJobToken(jobNumber);
      if (!token) {
        return;
      }
      const dedupeKey = `${token}|${city.toLowerCase()}|${locationId}`;
      if (seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      assignments.push({
        jobNumber: token,
        city: city || null,
        locationId,
        locationName: locationName || null,
        siteCode: normalizeText(entry.siteCode) || null,
        active: true
      });
    });
  });

  assignments.sort((a, b) =>
    a.jobNumber.localeCompare(b.jobNumber, undefined, { numeric: true })
    || (a.city || "").localeCompare(b.city || "")
    || a.locationId.localeCompare(b.locationId)
  );

  saveJson(locationJobMapPath, {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "gallery-data.json",
    assignments
  });

  lastLocationMapSourceMtimeMs = sourceMtimeMs;
  return true;
}

function runBackgroundDataRefreshCycle(trigger) {
  if (refreshLoopInProgress) {
    refreshLoopQueued = true;
    return;
  }

  refreshLoopInProgress = true;
  try {
    do {
      refreshLoopQueued = false;
      const refreshed = [];
      if (refreshJobCatalogIfNeeded()) {
        refreshed.push("job-catalog");
      }
      if (refreshGalleryDataIfNeeded()) {
        refreshed.push("gallery-data");
      }
      if (refreshLocationJobMapFromGalleryIfNeeded()) {
        refreshed.push("location-job-map");
      }
      if (refreshed.length > 0) {
        console.log(`[data-refresh:${trigger}] refreshed ${refreshed.join(", ")}`);
      }
    } while (refreshLoopQueued);
  } catch (error) {
    console.error(`[data-refresh:${trigger}] ${error.message}`);
  } finally {
    refreshLoopInProgress = false;
  }
}

function startBackgroundDataRefreshLoop() {
  runBackgroundDataRefreshCycle("startup");

  if (!Number.isFinite(dataRefreshIntervalMs) || dataRefreshIntervalMs <= 0) {
    return;
  }

  const intervalMs = Math.max(10000, Math.trunc(dataRefreshIntervalMs));
  const timer = setInterval(() => runBackgroundDataRefreshCycle("interval"), intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

function isEmailAllowed(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value || !value.includes("@")) {
    return false;
  }
  if (allowlistEmails.includes(value)) {
    return true;
  }
  const [, domain = ""] = value.split("@");
  return allowlistDomains.includes(domain);
}

function loadPublicAccessKeys() {
  const data = loadJson(publicAccessKeysPath, []);
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .filter((entry) => entry && typeof entry === "object" && entry.active !== false)
    .map((entry) => ({
      id: normalizeText(entry.id || entry.label || "client"),
      key: normalizeText(entry.key),
      allowedJobs: new Set(
        (Array.isArray(entry.allowedJobs) ? entry.allowedJobs : [])
          .map((job) => normalizeJobToken(job))
          .filter(Boolean)
      ),
      allowedCities: new Set(
        (Array.isArray(entry.allowedCities) ? entry.allowedCities : [])
          .map((city) => normalizeText(city).toLowerCase())
          .filter(Boolean)
      )
    }))
    .filter((entry) => entry.key);
}

function isLocationAllowedForPublicScope(entry, scope) {
  if (!scope) {
    return false;
  }
  const city = normalizeText(entry && entry.city).toLowerCase();
  if (scope.allowedCities.size > 0 && !scope.allowedCities.has(city)) {
    return false;
  }

  if (scope.allowedJobs.size > 0) {
    const jobs = Array.isArray(entry && entry.jobNumbers)
      ? entry.jobNumbers.map((job) => normalizeJobToken(job)).filter(Boolean)
      : [];
    if (!jobs.some((job) => scope.allowedJobs.has(job))) {
      return false;
    }
  }

  return true;
}

function assertPublicAccess(req, res) {
  const providedKey = normalizeText((req.query && req.query.key) || (req.body && req.body.key));
  if (!providedKey) {
    res.status(401).json({ error: "Public access key is required." });
    return null;
  }

  if (publicKey && providedKey === publicKey) {
    return {
      keyId: "global",
      allowedJobs: new Set(),
      allowedCities: new Set()
    };
  }

  const matchedKey = loadPublicAccessKeys().find((entry) => entry.key === providedKey);
  if (!matchedKey) {
    res.status(401).json({ error: "Invalid public access key." });
    return null;
  }

  return {
    keyId: matchedKey.id || "client",
    allowedJobs: matchedKey.allowedJobs,
    allowedCities: matchedKey.allowedCities
  };
}

function assertReviewerAccess(req, res) {
  const key = req.query.key || req.body.key;
  const email = req.query.email || req.body.email;

  if (!key || key !== reviewerKey) {
    res.status(401).json({ error: "Invalid reviewer key." });
    return null;
  }

  if (!isEmailAllowed(email)) {
    res.status(403).json({ error: "Reviewer email is not allowed." });
    return null;
  }

  return String(email).trim().toLowerCase();
}

function assertOwnerAccess(req, res) {
  const key = req.query.key || req.body.key;
  const email = req.query.email || req.body.email;
  const value = String(email || "").trim().toLowerCase();

  if (!key || key !== ownerKey) {
    res.status(401).json({ error: "Invalid owner key." });
    return null;
  }

  if (!ownerEmails.includes(value)) {
    res.status(403).json({ error: "Owner email is not allowed." });
    return null;
  }

  return value;
}

function findLocationEntry(data, locationId) {
  return data.locations.find(
    (entry) => normalizeLocationKey(entry.location) === normalizeLocationKey(locationId)
  );
}

function getEffectiveCover(entry, overrides) {
  const locationId = normalizeLocationKey(entry.location);
  const override = overrides[locationId];

  if (override && override.imageName) {
    const matched = entry.images.find((image) => image.name === override.imageName);
    if (matched) {
      return { image: matched, source: "reviewer-override" };
    }
  }

  if (entry.coverImageName) {
    const cover = entry.images.find((image) => image.name === entry.coverImageName);
    if (cover) {
      return { image: cover, source: "published-cover" };
    }
  }

  return entry.images.length > 0
    ? { image: entry.images[0], source: "first-image" }
    : { image: null, source: "no-images" };
}

function isReviewerEligible(entry) {
  if (Array.isArray(entry.jobNumbers) && entry.jobNumbers.length > 0) {
    return true;
  }
  if (entry.reviewerFilterValue != null && entry.reviewerFilterValue !== "") {
    const value = Number(entry.reviewerFilterValue);
    return Number.isFinite(value) && value > 0 && value < 10;
  }
  return Boolean(entry.reviewerEligible);
}

function hasCityTag(entry) {
  return Boolean(normalizeText(entry && entry.city));
}

function isReviewerVisibleEntry(entry) {
  return isReviewerEligible(entry) && hasCityTag(entry);
}

function buildLocationSummary(entry, overrides, published) {
  const locationId = normalizeLocationKey(entry.location);
  const cover = getEffectiveCover(entry, overrides);
  const publication = published[locationId] || null;

  return {
    siteCode: entry.siteCode || null,
    locationId,
    locationName: entry.location,
    imageCount: entry.images.length,
    coverImage: cover.image,
    coverSource: cover.source,
    reviewerEligible: isReviewerEligible(entry),
    reviewerFilterLabel: entry.reviewerFilterLabel || null,
    reviewerFilterValue: entry.reviewerFilterValue ?? null,
    city: entry.city || null,
    jobNumbers: Array.isArray(entry.jobNumbers) ? entry.jobNumbers : [],
    published: Boolean(publication && publication.published),
    publishedAt: publication && publication.publishedAt ? publication.publishedAt : null
  };
}

function registerImageStaticRoutes() {
  app.get("/images/:sourceId/*", (req, res, next) => {
    const sourceId = normalizeSourceId(req.params.sourceId);
    const relativePath = req.params[0] || "";
    const source = loadCitySources().find((entry) => entry.id === sourceId);
    if (!source || !source.imagesRootPath) {
      return next();
    }

    const rootPath = path.resolve(source.imagesRootPath);
    const targetPath = path.resolve(rootPath, relativePath);
    if (!targetPath.startsWith(`${rootPath}${path.sep}`) && targetPath !== rootPath) {
      return res.status(400).json({ error: "Invalid image path." });
    }

    return res.sendFile(targetPath, (error) => {
      if (error) {
        next();
      }
    });
  });

  // Legacy fallback for old single-source image URLs (/images/<folder>/<file>).
  app.use("/images", express.static(loadImageSource().imagesRootPath));
}

app.use("/app", express.static(path.join(repoRoot, "public", "app")));
app.use("/index_files", express.static(path.join(repoRoot, "index_files")));
registerImageStaticRoutes();

// Legacy pages remain available.
app.get("/legacy", (_, res) => {
  res.sendFile(path.join(repoRoot, "index.html"));
});
app.get("/index.html", (_, res) => {
  res.sendFile(path.join(repoRoot, "index.html"));
});
app.get("/gallery.html", (_, res) => {
  res.sendFile(path.join(repoRoot, "gallery.html"));
});
app.get("/gallery-links.js", (_, res) => {
  res.sendFile(path.join(repoRoot, "gallery-links.js"));
});
app.get("/gallery-data.json", (_, res) => {
  res.sendFile(galleryDataPath);
});

app.get("/", (_, res) => {
  res.redirect("/app/");
});

app.get("/api/public/filter-options", (req, res) => {
  const publicScope = assertPublicAccess(req, res);
  if (!publicScope) {
    return;
  }
  const data = loadGalleryData();
  const published = loadPublishedLocations();
  const cities = new Set();
  const jobNumbers = new Set();
  const jobCities = {};

  data.locations
    .filter((entry) => {
      const locationId = normalizeLocationKey(entry.location);
      const publication = published[locationId];
      return Boolean(publication && publication.published) && isLocationAllowedForPublicScope(entry, publicScope);
    })
    .forEach((entry) => {
      const city = normalizeText(entry.city);
      if (city) {
        cities.add(city);
      }
      if (Array.isArray(entry.jobNumbers)) {
        entry.jobNumbers.forEach((jobNumber) => {
          const token = normalizeJobToken(jobNumber);
          if (!token) {
            return;
          }
          jobNumbers.add(token);
          if (!jobCities[token]) {
            jobCities[token] = new Set();
          }
          if (city) {
            jobCities[token].add(city);
          }
        });
      }
    });

  const serializedJobCities = Object.fromEntries(
    Object.entries(jobCities).map(([job, citySet]) => [
      job,
      Array.from(citySet).sort((a, b) => a.localeCompare(b))
    ])
  );

  res.json({
    cities: Array.from(cities).sort((a, b) => a.localeCompare(b)),
    jobNumbers: Array.from(jobNumbers).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    jobCities: serializedJobCities
  });
});

app.get("/api/public/locations", (req, res) => {
  const publicScope = assertPublicAccess(req, res);
  if (!publicScope) {
    return;
  }
  const selectedCity = normalizeText(req.query.city);
  const selectedJobNumber = normalizeJobToken(req.query.jobNumber);
  const data = loadGalleryData();
  const overrides = loadOverrides();
  const published = loadPublishedLocations();
  let locations = data.locations
    .map((entry) => buildLocationSummary(entry, overrides, published))
    .filter((entry) => entry.published)
    .filter((entry) => isLocationAllowedForPublicScope(entry, publicScope));

  if (selectedJobNumber) {
    locations = locations.filter((entry) =>
      Array.isArray(entry.jobNumbers) &&
      entry.jobNumbers.map((job) => normalizeJobToken(job)).includes(selectedJobNumber)
    );
  }
  if (selectedCity) {
    const normalizedSelectedCity = selectedCity.toLowerCase();
    locations = locations.filter((entry) =>
      normalizeText(entry.city).toLowerCase() === normalizedSelectedCity
    );
  }

  res.json({ locations });
});

app.get("/api/public/locations/:locationId", (req, res) => {
  const publicScope = assertPublicAccess(req, res);
  if (!publicScope) {
    return;
  }
  const data = loadGalleryData();
  const overrides = loadOverrides();
  const published = loadPublishedLocations();
  const entry = findLocationEntry(data, req.params.locationId);
  if (!entry) {
    res.status(404).json({ error: "Location not found." });
    return;
  }
  const locationId = normalizeLocationKey(entry.location);
  const publication = published[locationId];
  if (!publication || !publication.published) {
    res.status(404).json({ error: "Location is not published for public view." });
    return;
  }
  if (!isLocationAllowedForPublicScope(entry, publicScope)) {
    res.status(403).json({ error: "Location is not available for this public key." });
    return;
  }

  const cover = getEffectiveCover(entry, overrides);
  res.json({
    locationId,
    locationName: entry.location,
    siteCode: entry.siteCode || null,
    streetViewUrl: entry.streetViewUrl || null,
    lat: (entry.lat != null) ? entry.lat : null,
    lon: (entry.lon != null) ? entry.lon : null,
    imageCount: entry.images.length,
    coverImage: cover.image,
    coverSource: cover.source
  });
});

app.post("/api/public/cover-requests", (req, res) => {
  const publicScope = assertPublicAccess(req, res);
  if (!publicScope) {
    return;
  }
  const { locationId, requesterName, requesterEmail, note } = req.body || {};
  if (!locationId || !requesterName || !requesterEmail) {
    res.status(400).json({
      error: "locationId, requesterName, and requesterEmail are required."
    });
    return;
  }

  const data = loadGalleryData();
  const entry = findLocationEntry(data, locationId);
  if (!entry) {
    res.status(404).json({ error: "Location not found." });
    return;
  }
  if (!isLocationAllowedForPublicScope(entry, publicScope)) {
    res.status(403).json({ error: "Location is not available for this public key." });
    return;
  }

  const requests = loadRequests();
  const newRequest = {
    id: `req_${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    locationId: normalizeLocationKey(entry.location),
    locationName: entry.location,
    requesterName: normalizeText(requesterName),
    requesterEmail: normalizeText(requesterEmail),
    note: normalizeText(note)
  };
  requests.unshift(newRequest);
  saveJson(coverRequestsPath, requests);
  res.status(201).json({ ok: true, request: newRequest });
});

app.get("/api/reviewer/cover-requests", (req, res) => {
  const reviewerEmail = assertReviewerAccess(req, res);
  if (!reviewerEmail) {
    return;
  }

  const prepared = normalizeAndPartitionRequests(loadRequests(), "system");
  if (prepared.dirty) {
    saveJson(coverRequestsPath, prepared.requests);
  }
  const data = loadGalleryData();
  const visibleLocationIds = new Set(
    data.locations
      .filter((entry) => isReviewerVisibleEntry(entry))
      .map((entry) => normalizeLocationKey(entry.location))
  );

  res.json({
    reviewerEmail,
    requests: prepared.activeRequests.filter((request) => visibleLocationIds.has(request.locationId)),
    archivedRequests: prepared.archivedRequests.filter((request) => visibleLocationIds.has(request.locationId))
  });
});

app.get("/api/reviewer/locations", (req, res) => {
  const reviewerEmail = assertReviewerAccess(req, res);
  if (!reviewerEmail) {
    return;
  }

  const selectedCity = normalizeText(req.query.city);
  const selectedJobNumber = normalizeJobToken(req.query.jobNumber);

  const data = loadGalleryData();
  const overrides = loadOverrides();
  const published = loadPublishedLocations();
  let locations = data.locations
    .filter((entry) => isReviewerVisibleEntry(entry))
    .map((entry) => buildLocationSummary(entry, overrides, published));

  let usedMapForJob = false;
  if (selectedJobNumber) {
    const assignments = loadLocationJobAssignments();
    const hasMappedJob = assignments.some((entry) => entry.jobNumber === selectedJobNumber);

    if (hasMappedJob) {
      usedMapForJob = true;
      const normalizedSelectedCity = selectedCity ? selectedCity.toLowerCase() : "";
      const allowedLocationIds = new Set(
        assignments
          .filter((entry) => entry.jobNumber === selectedJobNumber)
          .filter((entry) => !normalizedSelectedCity || !entry.city || entry.city.toLowerCase() === normalizedSelectedCity)
          .map((entry) => entry.locationId)
      );

      locations = locations.filter((entry) => allowedLocationIds.has(normalizeLocationKey(entry.locationId)));
    } else {
      locations = locations.filter((entry) =>
        Array.isArray(entry.jobNumbers) &&
        entry.jobNumbers.map((job) => normalizeJobToken(job)).includes(selectedJobNumber)
      );
    }
  }

  if (selectedCity && !usedMapForJob) {
    const normalizedSelectedCity = selectedCity.toLowerCase();
    locations = locations.filter((entry) =>
      normalizeText(entry.city).toLowerCase() === normalizedSelectedCity
    );
  }

  res.json({ reviewerEmail, locations });
});

app.get("/api/reviewer/filter-options", (req, res) => {
  const reviewerEmail = assertReviewerAccess(req, res);
  if (!reviewerEmail) {
    return;
  }

  const data = loadGalleryData();
  const catalogJobs = loadJobCatalogJobs();
  const cities = new Set(loadCityRegistry());
  const jobNumbers = new Set();
  const jobCities = {};
  const jobPostDates = {};

  if (catalogJobs.length > 0) {
    catalogJobs.forEach((job) => {
      const token = normalizeJobToken(job && job.jobNumber);
      const city = normalizeText(job && job.city);
      const postDateDisplay = normalizeText(
        (job && job.postDateDisplay)
        || (job && job.sourceFields && job.sourceFields.Post)
      );
      if (!token) {
        return;
      }
      jobNumbers.add(token);
      if (!jobCities[token]) {
        jobCities[token] = new Set();
      }
      if (!jobPostDates[token]) {
        jobPostDates[token] = { all: new Set(), byCity: {} };
      }
      if (city) {
        cities.add(city);
        jobCities[token].add(city);
        if (!jobPostDates[token].byCity[city]) {
          jobPostDates[token].byCity[city] = new Set();
        }
      }
      if (postDateDisplay) {
        jobPostDates[token].all.add(postDateDisplay);
        if (city) {
          jobPostDates[token].byCity[city].add(postDateDisplay);
        }
      }
    });
  } else {
    data.locations
      .filter((entry) => isReviewerVisibleEntry(entry))
      .forEach((entry) => {
        const city = normalizeText(entry.city);
        if (city) {
          cities.add(city);
        }
        if (Array.isArray(entry.jobNumbers)) {
          entry.jobNumbers.forEach((jobNumber) => {
            const token = normalizeJobToken(jobNumber);
            if (token) {
              jobNumbers.add(token);
              if (!jobCities[token]) {
                jobCities[token] = new Set();
              }
              if (city) {
                jobCities[token].add(city);
              }
            }
          });
        }
      });
  }

  const serializedJobCities = Object.fromEntries(
    Object.entries(jobCities).map(([job, citySet]) => [
      job,
      Array.from(citySet).sort((a, b) => a.localeCompare(b))
    ])
  );
  const serializedJobPostDates = Object.fromEntries(
    Object.entries(jobPostDates).map(([job, data]) => [
      job,
      {
        all: Array.from(data.all).sort((a, b) => a.localeCompare(b)),
        byCity: Object.fromEntries(
          Object.entries(data.byCity).map(([city, dates]) => [
            city,
            Array.from(dates).sort((a, b) => a.localeCompare(b))
          ])
        )
      }
    ])
  );

  res.json({
    reviewerEmail,
    cities: Array.from(cities).sort((a, b) => a.localeCompare(b)),
    jobNumbers: Array.from(jobNumbers).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    jobCities: serializedJobCities,
    jobPostDates: serializedJobPostDates
  });
});
app.get("/api/owner/filter-options", (req, res) => {
  const ownerEmail = assertOwnerAccess(req, res);
  if (!ownerEmail) {
    return;
  }

  const data = loadGalleryData();
  const catalogJobs = loadJobCatalogJobs();
  const cities = new Set(loadCityRegistry());
  const jobNumbers = new Set();
  const jobCities = {};

  if (catalogJobs.length > 0) {
    catalogJobs.forEach((job) => {
      const token = normalizeJobToken(job && job.jobNumber);
      const city = normalizeText(job && job.city);
      if (!token) {
        return;
      }
      jobNumbers.add(token);
      if (!jobCities[token]) {
        jobCities[token] = new Set();
      }
      if (city) {
        cities.add(city);
        jobCities[token].add(city);
      }
    });
  } else {
    data.locations
      .filter((entry) => isReviewerEligible(entry) && hasCityTag(entry))
      .forEach((entry) => {
        const city = normalizeText(entry.city);
        if (city) {
          cities.add(city);
        }
        if (Array.isArray(entry.jobNumbers)) {
          entry.jobNumbers.forEach((jobNumber) => {
            const token = normalizeJobToken(jobNumber);
            if (token) {
              jobNumbers.add(token);
              if (!jobCities[token]) {
                jobCities[token] = new Set();
              }
              if (city) {
                jobCities[token].add(city);
              }
            }
          });
        }
      });
  }

  const serializedJobCities = Object.fromEntries(
    Object.entries(jobCities).map(([job, citySet]) => [
      job,
      Array.from(citySet).sort((a, b) => a.localeCompare(b))
    ])
  );

  res.json({
    ownerEmail,
    cities: Array.from(cities).sort((a, b) => a.localeCompare(b)),
    jobNumbers: Array.from(jobNumbers).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    jobCities: serializedJobCities
  });
});
app.get("/api/reviewer/locations/:locationId/images", (req, res) => {
  const reviewerEmail = assertReviewerAccess(req, res);
  if (!reviewerEmail) {
    return;
  }

  const data = loadGalleryData();
  const overrides = loadOverrides();
  const entry = findLocationEntry(data, req.params.locationId);
  if (!entry) {
    res.status(404).json({ error: "Location not found." });
    return;
  }
  if (!isReviewerVisibleEntry(entry)) {
    res.status(403).json({ error: "Location is not eligible for reviewer workflow." });
    return;
  }

  const cover = getEffectiveCover(entry, overrides);
  res.json({
    reviewerEmail,
    locationId: normalizeLocationKey(entry.location),
    locationName: entry.location,
    effectiveCover: cover.image,
    images: entry.images
  });
});

app.post("/api/reviewer/locations/:locationId/cover", (req, res) => {
  const reviewerEmail = assertReviewerAccess(req, res);
  if (!reviewerEmail) {
    return;
  }

  const { imageName, note } = req.body || {};
  if (!imageName) {
    res.status(400).json({ error: "imageName is required." });
    return;
  }

  const data = loadGalleryData();
  const entry = findLocationEntry(data, req.params.locationId);
  if (!entry) {
    res.status(404).json({ error: "Location not found." });
    return;
  }
  if (!isReviewerVisibleEntry(entry)) {
    res.status(403).json({ error: "Location is not eligible for reviewer workflow." });
    return;
  }

  const selected = entry.images.find((image) => image.name === imageName);
  if (!selected) {
    res.status(400).json({ error: "imageName is not found in that location." });
    return;
  }

  const locationId = normalizeLocationKey(entry.location);
  const requests = loadRequests();
  const newRequest = {
    id: `req_${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    requestType: "reviewer-selection",
    locationId,
    locationName: entry.location,
    requesterName: reviewerEmail,
    requesterEmail: reviewerEmail,
    note: normalizeText(note),
    requestedImageName: selected.name,
    requestedImageUrl: selected.url
  };
  requests.unshift(newRequest);
  saveJson(coverRequestsPath, requests);

  res.status(201).json({
    ok: true,
    request: newRequest,
    message: "Cover request submitted. The owner will review and approve it."
  });
});

// Owner: get all requests
app.get("/api/owner/cover-requests", (req, res) => {
  const ownerEmail = assertOwnerAccess(req, res);
  if (!ownerEmail) return;

  const prepared = normalizeAndPartitionRequests(loadRequests(), ownerEmail);
  if (prepared.dirty) {
    saveJson(coverRequestsPath, prepared.requests);
  }
  res.json({
    ownerEmail,
    requests: prepared.activeRequests,
    archivedRequests: prepared.archivedRequests
  });
});

app.get("/api/owner/locations", (req, res) => {
  const ownerEmail = assertOwnerAccess(req, res);
  if (!ownerEmail) {
    return;
  }

  const selectedCity = normalizeText(req.query.city);
  const selectedJobNumber = normalizeJobToken(req.query.jobNumber);

  const data = loadGalleryData();
  const overrides = loadOverrides();
  const published = loadPublishedLocations();
  let locations = data.locations
    .filter((entry) => isReviewerEligible(entry))
    .map((entry) => buildLocationSummary(entry, overrides, published));

  if (selectedJobNumber) {
    locations = locations.filter((entry) =>
      Array.isArray(entry.jobNumbers) &&
      entry.jobNumbers.map((job) => normalizeJobToken(job)).includes(selectedJobNumber)
    );
  }

  if (selectedCity) {
    const normalizedSelectedCity = selectedCity.toLowerCase();
    locations = locations.filter((entry) =>
      normalizeText(entry.city).toLowerCase() === normalizedSelectedCity
    );
  }

  res.json({ ownerEmail, locations });
});

app.get("/api/owner/locations/:locationId/images", (req, res) => {
  const ownerEmail = assertOwnerAccess(req, res);
  if (!ownerEmail) {
    return;
  }

  const data = loadGalleryData();
  const overrides = loadOverrides();
  const entry = findLocationEntry(data, req.params.locationId);
  if (!entry) {
    res.status(404).json({ error: "Location not found." });
    return;
  }
  if (!isReviewerEligible(entry)) {
    res.status(403).json({ error: "Location is not eligible for reviewer workflow." });
    return;
  }

  const cover = getEffectiveCover(entry, overrides);
  res.json({
    ownerEmail,
    locationId: normalizeLocationKey(entry.location),
    locationName: entry.location,
    effectiveCover: cover.image,
    images: entry.images
  });
});

// Owner: approve a request (sets cover + marks resolved)
app.post("/api/owner/cover-requests/:requestId/approve", (req, res) => {
  const ownerEmail = assertOwnerAccess(req, res);
  if (!ownerEmail) return;

  const requests = loadRequests();
  const request = requests.find((r) => r.id === req.params.requestId);
  if (!request) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  if (!request.requestedImageName) {
    res.status(400).json({ error: "Request has no image attached." });
    return;
  }

  const data = loadGalleryData();
  const entry = findLocationEntry(data, request.locationId);
  if (!entry) {
    res.status(404).json({ error: "Location no longer exists." });
    return;
  }

  const selected = entry.images.find((i) => i.name === request.requestedImageName);
  if (!selected) {
    res.status(400).json({ error: "Requested image no longer exists in that location." });
    return;
  }

  const overrides = loadOverrides();
  overrides[request.locationId] = {
    imageName: selected.name,
    updatedBy: ownerEmail,
    updatedAt: new Date().toISOString(),
    reason: `Approved request ${request.id}`
  };
  saveJson(coverOverridesPath, overrides);

  const published = loadPublishedLocations();
  published[request.locationId] = {
    published: true,
    publishedAt: new Date().toISOString(),
    publishedBy: ownerEmail,
    sourceRequestId: request.id,
    imageName: selected.name
  };
  saveJson(publishedLocationsPath, published);

  request.status = "approved";
  request.resolvedBy = ownerEmail;
  request.resolvedAt = new Date().toISOString();
  markRequestArchived(request, ownerEmail, null, request.resolvedAt);
  saveJson(coverRequestsPath, requests);

  res.json({
    ok: true,
    request,
    coverImage: selected,
    shareUrl: `/app/location.html?location=${encodeURIComponent(entry.location)}`
  });
});

// Owner: reject a request
app.post("/api/owner/cover-requests/:requestId/reject", (req, res) => {
  const ownerEmail = assertOwnerAccess(req, res);
  if (!ownerEmail) return;

  const { reason } = req.body || {};
  const requests = loadRequests();
  const request = requests.find((r) => r.id === req.params.requestId);
  if (!request) {
    res.status(404).json({ error: "Request not found." });
    return;
  }

  request.status = "rejected";
  request.resolvedBy = ownerEmail;
  request.resolvedAt = new Date().toISOString();
  if (reason) request.reviewerNote = normalizeText(reason);
  markRequestArchived(request, ownerEmail, null, request.resolvedAt);
  saveJson(coverRequestsPath, requests);

  res.json({ ok: true, request });
});

// Owner: set cover directly (also creates a tracking ticket)
app.post("/api/owner/locations/:locationId/cover", (req, res) => {
  const ownerEmail = assertOwnerAccess(req, res);
  if (!ownerEmail) return;

  const { imageName, reason } = req.body || {};
  if (!imageName) {
    res.status(400).json({ error: "imageName is required." });
    return;
  }

  const data = loadGalleryData();
  const entry = findLocationEntry(data, req.params.locationId);
  if (!entry) {
    res.status(404).json({ error: "Location not found." });
    return;
  }

  const selected = entry.images.find((i) => i.name === imageName);
  if (!selected) {
    res.status(400).json({ error: "imageName not found in that location." });
    return;
  }

  const locationId = normalizeLocationKey(entry.location);
  const overrides = loadOverrides();
  overrides[locationId] = {
    imageName: selected.name,
    updatedBy: ownerEmail,
    updatedAt: new Date().toISOString(),
    reason: normalizeText(reason)
  };
  saveJson(coverOverridesPath, overrides);

  const published = loadPublishedLocations();
  published[locationId] = {
    published: true,
    publishedAt: new Date().toISOString(),
    publishedBy: ownerEmail,
    sourceRequestId: null,
    imageName: selected.name
  };
  saveJson(publishedLocationsPath, published);

  // Create a tracking ticket
  const requests = loadRequests();
  const ticket = {
    id: `req_${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: "approved",
    locationId,
    locationName: entry.location,
    requesterName: ownerEmail,
    requesterEmail: ownerEmail,
    note: normalizeText(reason) || "Owner set cover directly.",
    requestedImageName: selected.name,
    requestedImageUrl: selected.url,
    resolvedBy: ownerEmail,
    resolvedAt: new Date().toISOString(),
    archivedAt: new Date().toISOString(),
    archivedBy: ownerEmail
  };
  requests.unshift(ticket);
  saveJson(coverRequestsPath, requests);

  res.json({
    ok: true,
    coverImage: selected,
    ticket,
    shareUrl: `/app/location.html?location=${encodeURIComponent(entry.location)}`
  });
});

app.post("/api/owner/locations/:locationId/unpublish", (req, res) => {
  const ownerEmail = assertOwnerAccess(req, res);
  if (!ownerEmail) return;

  const data = loadGalleryData();
  const entry = findLocationEntry(data, req.params.locationId);
  if (!entry) {
    res.status(404).json({ error: "Location not found." });
    return;
  }

  const locationId = normalizeLocationKey(entry.location);
  const published = loadPublishedLocations();
  published[locationId] = {
    published: false,
    unpublishedAt: new Date().toISOString(),
    unpublishedBy: ownerEmail
  };
  saveJson(publishedLocationsPath, published);

  res.json({ ok: true, locationId });
});

ensureDataFiles();
startBackgroundDataRefreshLoop();
app.listen(port, () => {
  console.log(`buildPortfolio server running at http://localhost:${port}`);
});
