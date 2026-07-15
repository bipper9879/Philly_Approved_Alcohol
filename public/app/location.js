const titleEl = document.getElementById("title");
const coverEl = document.getElementById("cover");
const metaEl = document.getElementById("meta");
const coordsEl = document.getElementById("location-coords");
const streetViewContainer = document.getElementById("street-view-container");
const requestFormEl = document.getElementById("request-form");
const requestStatusEl = document.getElementById("request-status");
const accessFormEl = document.getElementById("public-access-form");
const accessKeyEl = document.getElementById("public-access-key");
const accessStatusEl = document.getElementById("public-access-status");

let publicAccessKey = "";

function getLocationParam() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("location") || "").trim();
}

function getKeyParam() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("key") || "").trim();
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

function getStoredPublicKey() {
  return sessionStorage.getItem("publicAccessKey") || "";
}

function setStoredPublicKey(key) {
  sessionStorage.setItem("publicAccessKey", key);
}

function withPublicKey(url) {
  const query = new URLSearchParams();
  query.set("key", publicAccessKey);
  return `${url}?${query.toString()}`;
}

function renderCover(locationName, coverImage) {
  if (!coverImage || !coverImage.url) {
    coverEl.innerHTML = "<div class=\"empty\">No cover image is published for this location yet.</div>";
    return;
  }

  coverEl.innerHTML = "";
  const img = document.createElement("img");
  img.src = `/${coverImage.url}`;
  img.alt = `${locationName} cover image`;
  coverEl.appendChild(img);
}

function renderLocationMeta(payload) {
  if (payload.lat && payload.lon) {
    coordsEl.textContent = `Lat: ${payload.lat}  |  Lon: ${payload.lon}`;
    coordsEl.classList.remove("hidden");
  } else {
    coordsEl.classList.add("hidden");
  }

  if (payload.streetViewUrl) {
    streetViewContainer.innerHTML = "";
    const link = document.createElement("a");
    link.href = payload.streetViewUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "button";
    link.style.marginTop = "12px";
    link.style.display = "inline-flex";
    link.textContent = "Open Street View";
    streetViewContainer.appendChild(link);
    streetViewContainer.classList.remove("hidden");
  } else {
    streetViewContainer.classList.add("hidden");
  }
}

async function loadLocation() {
  const locationName = getLocationParam();
  if (!locationName) {
    titleEl.textContent = "No location selected";
    coverEl.innerHTML = "<div class=\"empty\">Use the public page to open a location.</div>";
    return null;
  }
  if (!publicAccessKey) {
    throw new Error("Public access key is required.");
  }

  titleEl.textContent = locationName;
  const locationId = normalizeLocationKey(locationName);
  const response = await fetch(withPublicKey(`/api/public/locations/${encodeURIComponent(locationId)}`), {
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Location not found (${response.status}).`);
  }

  const payload = await response.json();
  renderCover(payload.locationName, payload.coverImage);
  renderLocationMeta(payload);
  metaEl.textContent = `Public mode: only cover image shown. Total images in location: ${payload.imageCount}.`;
  return payload;
}

requestFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  const locationName = getLocationParam();
  const locationId = normalizeLocationKey(locationName);
  if (!locationId) {
    requestStatusEl.textContent = "Missing location context.";
    return;
  }
  if (!publicAccessKey) {
    requestStatusEl.textContent = "Connect public access first.";
    return;
  }

  const payload = {
    key: publicAccessKey,
    locationId,
    requesterName: document.getElementById("requester-name").value,
    requesterEmail: document.getElementById("requester-email").value,
    note: document.getElementById("request-note").value
  };

  requestStatusEl.textContent = "Submitting request...";

  try {
    const response = await fetch("/api/public/cover-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      requestStatusEl.textContent = error.error || "Request failed.";
      return;
    }

    requestStatusEl.textContent = "Your request has been submitted. You will receive a notification when a new photo has been selected.";
    requestFormEl.reset();
  } catch {
    requestStatusEl.textContent = "Could not submit request right now. Please try again.";
  }
});

async function connectPublicAccess(key) {
  publicAccessKey = key.trim();
  if (!publicAccessKey) {
    throw new Error("Public access key is required.");
  }
  setStoredPublicKey(publicAccessKey);
  await loadLocation();
}

accessFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  accessStatusEl.textContent = "Connecting...";
  try {
    await connectPublicAccess(accessKeyEl.value);
    accessStatusEl.textContent = "Public access connected.";
  } catch (error) {
    accessStatusEl.textContent = error.message;
    coverEl.innerHTML = `<div class="empty">${error.message}</div>`;
  }
});

coverEl.innerHTML = "<div class=\"empty\">Connect with a public access key to load this location.</div>";
const initialKey = getKeyParam() || getStoredPublicKey();
if (initialKey) {
  accessKeyEl.value = initialKey;
  connectPublicAccess(initialKey)
    .then(() => {
      accessStatusEl.textContent = "Public access connected.";
    })
    .catch((error) => {
      accessStatusEl.textContent = error.message;
      coverEl.innerHTML = `<div class="empty">${error.message}</div>`;
    });
}
