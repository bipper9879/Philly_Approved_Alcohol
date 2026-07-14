const accessFormEl = document.getElementById("public-access-form");
const accessKeyEl = document.getElementById("public-access-key");
const accessStatusEl = document.getElementById("public-access-status");
const cardsRoot = document.getElementById("cards");
const searchInput = document.getElementById("search");
const cityFilterEl = document.getElementById("city-filter");
const jobFilterEl = document.getElementById("job-filter");
const cardTemplate = document.getElementById("card-template");

let publicAccessKey = "";
let locations = [];
let allLocations = [];
let availableCities = [];
let availableJobs = [];
let jobCityMap = {};

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getStoredPublicKey() {
  return sessionStorage.getItem("publicAccessKey") || "";
}

function setStoredPublicKey(key) {
  sessionStorage.setItem("publicAccessKey", key);
}

function withPublicKey(url, params = {}) {
  const query = new URLSearchParams(params);
  query.set("key", publicAccessKey);
  return `${url}?${query.toString()}`;
}

function populateSelect(selectEl, options, allLabel) {
  selectEl.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  selectEl.appendChild(allOption);
  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    selectEl.appendChild(option);
  });
}

function renderCards(items) {
  cardsRoot.innerHTML = "";

  if (!items.length) {
    cardsRoot.innerHTML = "<p class=\"empty\">No locations are published for this view right now.</p>";
    return;
  }

  items.forEach((location) => {
    const fragment = cardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const img = fragment.querySelector("img");
    const title = fragment.querySelector("h2");
    const meta = fragment.querySelector(".meta");
    const openLink = fragment.querySelector(".button-primary");

    title.textContent = location.locationName;
    const cityMeta = location.city ? `City: ${location.city}` : "City: N/A";
    const jobsMeta = Array.isArray(location.jobNumbers) && location.jobNumbers.length
      ? `Jobs: ${location.jobNumbers.join(", ")}`
      : "Jobs: N/A";
    meta.textContent = `${cityMeta} • ${jobsMeta} • Published total: ${location.imageCount}`;

    const siteLabel = fragment.querySelector(".site-id-label");
    if (siteLabel) siteLabel.textContent = location.siteCode || `Site #${location.siteId}`;

    if (location.coverImage && location.coverImage.url) {
      img.src = `/${location.coverImage.url}`;
      img.alt = `${location.locationName} public cover image`;
    } else {
      card.querySelector(".cover-frame").innerHTML = "<div class=\"empty\">No cover published yet.</div>";
    }

    const href = `./location.html?location=${encodeURIComponent(location.locationName)}&key=${encodeURIComponent(publicAccessKey)}`;
    openLink.href = href;
    openLink.textContent = "Open location";

    cardsRoot.appendChild(fragment);
  });
}

async function loadLocations() {
  cardsRoot.innerHTML = "<p class=\"empty\">Loading locations...</p>";
  const params = {};
  if (cityFilterEl.value) {
    params.city = cityFilterEl.value;
  }
  if (jobFilterEl.value) {
    params.jobNumber = jobFilterEl.value;
  }
  const response = await fetch(withPublicKey("/api/public/locations", params), { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Failed to load locations: ${response.status}`);
  }
  const payload = await response.json();
  locations = payload.locations || [];
  allLocations = locations;
  renderCards(locations);
}

async function loadFilterOptions() {
  const response = await fetch(withPublicKey("/api/public/filter-options"), { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Failed to load filter options: ${response.status}`);
  }
  const payload = await response.json();
  availableCities = (payload.cities || []).map((city) => String(city));
  availableJobs = (payload.jobNumbers || []).map((job) => String(job));
  jobCityMap = payload.jobCities || {};
  populateSelect(cityFilterEl, availableCities, "All cities");
  populateSelect(jobFilterEl, availableJobs, "All jobs");
}

function syncCityOptionsForJob() {
  const selectedJob = jobFilterEl.value;
  const citiesForJob = selectedJob && Array.isArray(jobCityMap[selectedJob])
    ? jobCityMap[selectedJob].filter(Boolean)
    : availableCities;
  const currentCity = cityFilterEl.value;
  populateSelect(cityFilterEl, citiesForJob, "All cities");
  if (currentCity && citiesForJob.includes(currentCity)) {
    cityFilterEl.value = currentCity;
  }
}

async function connectPublicAccess(key) {
  publicAccessKey = key.trim();
  if (!publicAccessKey) {
    throw new Error("Public access key is required.");
  }
  setStoredPublicKey(publicAccessKey);
  await Promise.all([loadFilterOptions(), loadLocations()]);
}

searchInput.addEventListener("input", () => {
  const query = normalizeText(searchInput.value);
  if (!query) {
    renderCards(allLocations);
    return;
  }

  renderCards(
    allLocations.filter((item) => normalizeText(item.locationName).includes(query))
  );
});

cityFilterEl.addEventListener("change", () => {
  loadLocations().catch((error) => {
    cardsRoot.innerHTML = `<p class="empty">Could not load locations. ${error.message}</p>`;
  });
});

jobFilterEl.addEventListener("change", () => {
  syncCityOptionsForJob();
  loadLocations().catch((error) => {
    cardsRoot.innerHTML = `<p class="empty">Could not load locations. ${error.message}</p>`;
  });
});

accessFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  accessStatusEl.textContent = "Connecting...";
  try {
    await connectPublicAccess(accessKeyEl.value);
    accessStatusEl.textContent = "Public access connected.";
  } catch (error) {
    accessStatusEl.textContent = error.message;
    cardsRoot.innerHTML = "<p class=\"empty\">Connect with a public access key to view published locations.</p>";
  }
});

cardsRoot.innerHTML = "<p class=\"empty\">Connect with a public access key to view published locations.</p>";
const initialKey = getStoredPublicKey();
if (initialKey) {
  accessKeyEl.value = initialKey;
  connectPublicAccess(initialKey)
    .then(() => {
      accessStatusEl.textContent = "Public access connected.";
    })
    .catch((error) => {
      accessStatusEl.textContent = error.message;
    });
}
