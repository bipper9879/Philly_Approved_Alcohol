require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");

const app = express();
const port = Number(process.env.PORT || 3000);

const repoRoot = __dirname;
const galleryDataPath = path.join(repoRoot, "gallery-data.json");
const dataDir = path.join(repoRoot, "data");
const coverOverridesPath = path.join(dataDir, "cover-overrides.json");
const coverRequestsPath = path.join(dataDir, "cover-requests.json");

const reviewerKey = process.env.REVIEWER_KEY || "dev-reviewer-key";
const ownerKey = process.env.OWNER_KEY || "dev-owner-key";
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
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocationKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]/g, "");
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

app.use("/app", express.static(path.join(repoRoot, "public", "app")));
app.use("/index_files", express.static(path.join(repoRoot, "index_files")));

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

app.get("/api/public/locations", (_, res) => {
  const data = loadGalleryData();
  const overrides = loadOverrides();
  const locations = data.locations.map((entry, index) => {
    const locationId = normalizeLocationKey(entry.location);
    const cover = getEffectiveCover(entry, overrides);
    return {
      siteId: index + 1,
      siteCode: entry.siteCode || null,
      locationId,
      locationName: entry.location,
      imageCount: entry.images.length,
      coverImage: cover.image,
      coverSource: cover.source
    };
  });

  res.json({ locations });
});

app.get("/api/public/locations/:locationId", (req, res) => {
  const data = loadGalleryData();
  const overrides = loadOverrides();
  const entry = findLocationEntry(data, req.params.locationId);
  if (!entry) {
    res.status(404).json({ error: "Location not found." });
    return;
  }

  const cover = getEffectiveCover(entry, overrides);
  res.json({
    locationId: normalizeLocationKey(entry.location),
    locationName: entry.location,
    imageCount: entry.images.length,
    coverImage: cover.image,
    coverSource: cover.source
  });
});

app.post("/api/public/cover-requests", (req, res) => {
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

  const requests = loadRequests();
  res.json({ reviewerEmail, requests });
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

  const requests = loadRequests();
  res.json({ ownerEmail, requests });
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

  request.status = "approved";
  request.resolvedBy = ownerEmail;
  request.resolvedAt = new Date().toISOString();
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
    resolvedAt: new Date().toISOString()
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

ensureDataFiles();
app.listen(port, () => {
  console.log(`Philly Approved Alcohol server running at http://localhost:${port}`);
});


