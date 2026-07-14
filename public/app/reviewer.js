const authFormEl = document.getElementById("auth-form");
const authStatusEl = document.getElementById("auth-status");
const reviewContextLabelEl = document.getElementById("review-context-label");
const requestListEl = document.getElementById("request-list");
const archivedRequestListEl = document.getElementById("archived-request-list");
const togglePendingEl = document.getElementById("toggle-pending");
const toggleArchivedEl = document.getElementById("toggle-archived");
const changeFiltersEl = document.getElementById("change-filters");
const filterDialogEl = document.getElementById("filter-dialog");
const popupCitySelectEl = document.getElementById("popup-city-select");
const popupJobSelectEl = document.getElementById("popup-job-select");
const searchInput = document.getElementById("search");
const locationCardsEl = document.getElementById("location-cards");
const locationCardTemplate = document.getElementById("location-card-template");
const imageTemplate = document.getElementById("image-template");
const ALL_JOBS_VALUE = "__ALL_JOBS__";

let locations = [];
let openLocationId = "";
let pendingCollapsed = false;
let archivedVisible = false;
let selectedFilters = { city: "All cities", jobNumber: "" };
let availableCities = [];
let availableJobs = [];
let jobCityMap = {};
let jobPostDateMap = {};

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAuth() {
  return {
    email: document.getElementById("email").value.trim(),
    key: document.getElementById("key").value.trim()
  };
}

function getSelectedFilters() {
  return selectedFilters;
}

function updateReviewContextLabel() {
  const { city, jobNumber } = selectedFilters;
  if (!jobNumber) {
    reviewContextLabelEl.textContent = "";
    return;
  }
  const cityLabel = city && city !== "All cities" ? city : "All Cities";
  if (jobNumber === ALL_JOBS_VALUE) {
    reviewContextLabelEl.textContent = `${cityLabel} Raw Photos — All jobs`;
    return;
  }
  const postDateLabel = getSelectedPostDateLabel(jobNumber, city);
  reviewContextLabelEl.textContent = postDateLabel
    ? `${cityLabel} Raw Photos — ${jobNumber} • Post: ${postDateLabel}`
    : `${cityLabel} Raw Photos — ${jobNumber}`;
}

function getSelectedPostDateLabel(jobNumber, city) {
  if (jobNumber === ALL_JOBS_VALUE) {
    return "";
  }
  const metadata = jobPostDateMap[jobNumber];
  if (!metadata || typeof metadata !== "object") {
    return "";
  }

  const byCity = metadata.byCity && typeof metadata.byCity === "object" ? metadata.byCity : {};
  const allDates = Array.isArray(metadata.all) ? metadata.all.filter(Boolean) : [];
  const selectedCity = city && city !== "All cities" ? city : "";
  const cityDates = selectedCity && Array.isArray(byCity[selectedCity]) ? byCity[selectedCity].filter(Boolean) : [];
  const dates = cityDates.length ? cityDates : allDates;
  if (!dates.length) {
    return "";
  }
  return dates.length > 1 ? `${dates[0]}+` : dates[0];
}

function populateSelect(selectEl, options, placeholder) {
  selectEl.innerHTML = "";
  if (!options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    selectEl.appendChild(option);
    selectEl.disabled = true;
    return;
  }

  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    selectEl.appendChild(option);
  });
  selectEl.disabled = false;
}

function populateJobSelect(selectEl) {
  selectEl.innerHTML = "";
  if (!availableJobs.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No job options";
    selectEl.appendChild(option);
    selectEl.disabled = true;
    return;
  }

  const allOption = document.createElement("option");
  allOption.value = ALL_JOBS_VALUE;
  allOption.textContent = "All jobs";
  selectEl.appendChild(allOption);

  availableJobs.forEach((job) => {
    const option = document.createElement("option");
    option.value = String(job);
    option.textContent = String(job);
    selectEl.appendChild(option);
  });
  selectEl.disabled = false;
}

function cityOptionsForJob(jobNumber) {
  if (!jobNumber || jobNumber === ALL_JOBS_VALUE) {
    const allCities = availableCities.filter((city) => city !== "All cities");
    return ["All cities", ...allCities];
  }
  const allCities = availableCities.filter((city) => city !== "All cities");
  const jobCities = (jobCityMap[jobNumber] || []).filter(Boolean);
  const scoped = jobCities.length ? jobCities : allCities;
  return ["All cities", ...scoped];
}

function syncPopupCitiesForJob(preserveSelection = true) {
  const selectedJob = popupJobSelectEl.value;
  const cityOptions = cityOptionsForJob(selectedJob);
  const previousCity = preserveSelection ? popupCitySelectEl.value : "";
  populateSelect(popupCitySelectEl, cityOptions, "No city options");

  if (previousCity && cityOptions.includes(previousCity)) {
    popupCitySelectEl.value = previousCity;
  } else if (selectedFilters.city && cityOptions.includes(selectedFilters.city)) {
    popupCitySelectEl.value = selectedFilters.city;
  } else {
    popupCitySelectEl.value = "All cities";
  }
}

function getDialogResult() {
  return new Promise((resolve) => {
    const onClose = () => {
      filterDialogEl.removeEventListener("close", onClose);
      resolve(filterDialogEl.returnValue);
    };
    filterDialogEl.addEventListener("close", onClose);
  });
}

async function promptForFilters(required = false) {
  populateJobSelect(popupJobSelectEl);
  if (selectedFilters.jobNumber && (selectedFilters.jobNumber === ALL_JOBS_VALUE || availableJobs.includes(selectedFilters.jobNumber))) {
    popupJobSelectEl.value = selectedFilters.jobNumber;
  } else if (availableJobs.length > 0) {
    popupJobSelectEl.value = ALL_JOBS_VALUE;
  }

  syncPopupCitiesForJob(false);
  popupJobSelectEl.onchange = () => syncPopupCitiesForJob(true);

  filterDialogEl.showModal();
  const result = await getDialogResult();
  popupJobSelectEl.onchange = null;

  if (result !== "continue") {
    if (required) {
      throw new Error("Selection canceled.");
    }
    return false;
  }

  selectedFilters = {
    city: popupCitySelectEl.value || "All cities",
    jobNumber: popupJobSelectEl.value || ""
  };
  updateReviewContextLabel();
  return true;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function getFilteredLocations() {
  const query = normalizeText(searchInput.value).toLowerCase();
  if (!query) return locations;
  return locations.filter((item) =>
    normalizeText(item.locationName).toLowerCase().includes(query)
  );
}

function statusBadge(status) {
  const map = {
    pending: "🟡 Pending owner approval",
    reviewed: "🟣 Reviewed",
    resolved: "✅ Resolved",
    dismissed: "⛔ Dismissed",
    approved: "✅ Approved",
    rejected: "❌ Rejected"
  };
  return map[status] || status;
}

function sortRequests(requests) {
  const rank = { pending: 0, reviewed: 1, approved: 2, rejected: 3, dismissed: 4, resolved: 5 };
  return [...requests].sort((a, b) => {
    const aRank = rank[a.status] ?? 99;
    const bRank = rank[b.status] ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function createRequestRow(request) {
  const matchingLocation = locations.find((location) => location.locationId === request.locationId);
  const siteCode = matchingLocation && matchingLocation.siteCode ? matchingLocation.siteCode : "No site code";

  const row = document.createElement("div");
  row.className = `list-row ${request.status !== "pending" ? "list-row-resolved" : ""}`;
  row.dataset.locationId = request.locationId;
  row.innerHTML = `
    <div class="list-row-header">
      <strong>${request.locationName}</strong>
      <span class="badge">${statusBadge(request.status)}</span>
    </div>
    <span class="meta">Site: ${siteCode}</span>
    <span>${request.requesterName} (${request.requesterEmail})</span>
    <span>${request.note || "No note provided."}</span>
    <span class="meta">${request.requestType === "reviewer-selection" ? "Submitted by reviewer for owner approval." : "Submitted by public requester."}</span>
    <span class="muted">${new Date(request.createdAt).toLocaleString()}</span>
  `;

  row.style.cursor = "pointer";
  row.title = "Open this location";
  row.addEventListener("click", async () => {
    const locationId = row.dataset.locationId;
    if (!locationId) return;

    if (searchInput.value) {
      searchInput.value = "";
      renderLocationCards(locations);
    }

    const card = locationCardsEl.querySelector(`[data-location-id="${locationId}"]`);
    if (!card) {
      authStatusEl.textContent = "Could not find a location card for that request.";
      return;
    }

    await toggleLocationAccordion(locationId, card);
  });

  return row;
}

function setQueueToggleLabels(pendingCount, archivedCount) {
  togglePendingEl.textContent = pendingCollapsed
    ? `Show pending (${pendingCount})`
    : `Collapse pending (${pendingCount})`;
  toggleArchivedEl.textContent = archivedVisible
    ? `Hide archived (${archivedCount})`
    : `View archived requests (${archivedCount})`;
}

function renderRequests(activeRequests, archivedRequests) {
  requestListEl.innerHTML = "";
  archivedRequestListEl.innerHTML = "";
  const visibleLocationIds = new Set(locations.map((entry) => entry.locationId));

  const pending = sortRequests(activeRequests || []).filter((request) =>
    request.status === "pending" && visibleLocationIds.has(request.locationId)
  );
  const archived = sortRequests(archivedRequests || []).filter((request) =>
    visibleLocationIds.has(request.locationId)
  );
  setQueueToggleLabels(pending.length, archived.length);

  if (!pending.length) {
    requestListEl.classList.remove("hidden");
    requestListEl.innerHTML = "<p class=\"empty\">No requests yet.</p>";
  } else if (pendingCollapsed) {
    requestListEl.classList.add("hidden");
  } else {
    requestListEl.classList.remove("hidden");
    pending.forEach((request) => {
      requestListEl.appendChild(createRequestRow(request));
    });
  }

  if (!archived.length) {
    archivedRequestListEl.innerHTML = "<p class=\"empty\">No archived requests.</p>";
  } else {
    archived.forEach((request) => {
      archivedRequestListEl.appendChild(createRequestRow(request));
    });
  }

  archivedRequestListEl.classList.toggle("hidden", !archivedVisible);
}

function buildAccordionImages(data, accordionEl) {
  accordionEl.innerHTML = "";

  const header = document.createElement("div");
  header.className = "accordion-header";
  header.innerHTML = `<p class="meta">Reviewer mode — ${data.images.length} images. Select one and send it to owner approval.</p>`;
  accordionEl.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "cards accordion-grid";
  accordionEl.appendChild(grid);

  data.images.forEach((image) => {
    const fragment = imageTemplate.content.cloneNode(true);
    const img = fragment.querySelector("img");
    const meta = fragment.querySelector(".meta");
    const button = fragment.querySelector("button");

    img.src = `/${image.url}`;
    img.alt = `${data.locationName} - ${image.name}`;
    meta.textContent = data.effectiveCover && data.effectiveCover.name === image.name
      ? `${image.name} — current public cover`
      : image.name;

    button.textContent = "Submit for owner approval";
    button.addEventListener("click", async () => {
      const auth = getAuth();
      button.disabled = true;
      button.textContent = "Submitting...";
      try {
        await fetchJson(
          `/api/reviewer/locations/${encodeURIComponent(data.locationId)}/cover`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: auth.email, key: auth.key, imageName: image.name })
          }
        );
        button.textContent = "✅ Requested!";
        authStatusEl.textContent = `Submitted for owner approval: ${data.locationName}. Public updates only after owner approval.`;
        await loadRequests();
      } catch (error) {
        authStatusEl.textContent = error.message;
        button.disabled = false;
        button.textContent = "Submit for owner approval";
      }
    });

    grid.appendChild(fragment);
  });
}

async function toggleLocationAccordion(locationId, cardEl) {
  const auth = getAuth();
  if (!auth.email || !auth.key) {
    authStatusEl.textContent = "Enter reviewer email and key first, then connect.";
    return;
  }

  const accordionEl = cardEl.querySelector(".accordion-panel");
  const button = cardEl.querySelector(".button-primary");

  if (openLocationId === locationId) {
    openLocationId = "";
    accordionEl.classList.add("hidden");
    cardEl.classList.remove("card-active");
    if (button) button.textContent = "Open all images";
    return;
  }

  const prev = locationCardsEl.querySelector(".card-active");
  if (prev) {
    prev.querySelector(".accordion-panel").classList.add("hidden");
    prev.classList.remove("card-active");
    const prevBtn = prev.querySelector(".button-primary");
    if (prevBtn) prevBtn.textContent = "Open all images";
  }

  openLocationId = locationId;
  cardEl.classList.add("card-active");
  if (button) button.textContent = "Collapse";
  accordionEl.innerHTML = "<p class=\"empty\" style=\"padding:16px\">Loading images...</p>";
  accordionEl.classList.remove("hidden");

  try {
    const imagesPayload = await fetchJson(
      `/api/reviewer/locations/${encodeURIComponent(locationId)}/images?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
    );
    buildAccordionImages(imagesPayload, accordionEl);
    authStatusEl.textContent = `Loaded ${imagesPayload.images.length} images for ${imagesPayload.locationName}.`;
    cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    authStatusEl.textContent = error.message;
    accordionEl.classList.add("hidden");
    cardEl.classList.remove("card-active");
    if (button) button.textContent = "Open all images";
    openLocationId = "";
  }
}

async function loadRequests() {
  const auth = getAuth();
  if (!auth.email || !auth.key) {
    return;
  }
  const requestsPayload = await fetchJson(
    `/api/reviewer/cover-requests?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
  );
  renderRequests(requestsPayload.requests || [], requestsPayload.archivedRequests || []);
}

async function loadFilterOptions() {
  const auth = getAuth();
  const payload = await fetchJson(
    `/api/reviewer/filter-options?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
  );
  availableCities = (payload.cities || []).map((city) => String(city));
  availableJobs = (payload.jobNumbers || []).map((job) => String(job));
  jobCityMap = payload.jobCities || {};
  jobPostDateMap = payload.jobPostDates || {};
  if (!availableJobs.length) {
    throw new Error("No city-tagged reviewer jobs are available. Re-sync with a City value first.");
  }
}

function renderLocationCards(items) {
  locationCardsEl.innerHTML = "";
  locationCardsEl.classList.remove("cards");

  if (!items.length) {
    locationCardsEl.innerHTML = "<p class=\"empty\">No locations matched your search.</p>";
    return;
  }

  if (selectedFilters.jobNumber === ALL_JOBS_VALUE) {
    renderGroupedLocationCards(items);
    return;
  }

  locationCardsEl.classList.add("cards");
  items.forEach((location) => {
    locationCardsEl.appendChild(createLocationCard(location, selectedFilters.jobNumber));
  });
}

function createLocationCard(location, focusJobNumber = "") {
    const fragment = locationCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const img = fragment.querySelector("img");
    const jobBadge = fragment.querySelector(".job-number-label");
    const siteLabel = fragment.querySelector(".site-id-label");
    const title = fragment.querySelector("h2");
    const meta = fragment.querySelector(".meta");
    const button = fragment.querySelector(".button-primary");
    card.dataset.locationId = location.locationId;

    const allJobs = Array.isArray(location.jobNumbers) ? location.jobNumbers.filter(Boolean) : [];
    const badgeJob = focusJobNumber || allJobs[0] || "Unassigned";
    jobBadge.textContent = `Job ${badgeJob}`;
    siteLabel.textContent = location.siteCode || `Site #${location.siteId}`;
    title.textContent = location.locationName;
    const jobsMeta = allJobs.length
      ? ` • Jobs: ${allJobs.join(", ")}`
      : "";
    const publishedMeta = location.published ? " • Public: live" : " • Public: hidden";
    meta.textContent = `${location.imageCount} image${location.imageCount !== 1 ? "s" : ""}${jobsMeta}${publishedMeta}`;

    if (location.coverImage && location.coverImage.url) {
      img.src = `/${location.coverImage.url}`;
      img.alt = `${location.locationName} public cover image`;
    } else {
      card.querySelector(".cover-frame").innerHTML = "<div class=\"empty\">No cover yet.</div>";
    }

    if (location.locationId === openLocationId) {
      card.classList.add("card-active");
    }

    const toggle = () => toggleLocationAccordion(location.locationId, card);
    card.addEventListener("click", (event) => {
      if (event.target.closest("button") && !event.target.closest(".button-primary")) return;
      toggle();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle();
    });

    return fragment;
}

function renderGroupedLocationCards(items) {
  const grouped = new Map();

  items.forEach((location) => {
    const jobs = Array.isArray(location.jobNumbers) && location.jobNumbers.length
      ? location.jobNumbers
      : ["Unassigned"];
    jobs.forEach((jobNumber) => {
      if (!grouped.has(jobNumber)) {
        grouped.set(jobNumber, []);
      }
      grouped.get(jobNumber).push(location);
    });
  });

  const sortedJobs = Array.from(grouped.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  sortedJobs.forEach((jobNumber) => {
    const section = document.createElement("section");
    section.className = "job-group";
    section.innerHTML = `
      <div class="job-group-header">
        <h3>Job ${jobNumber}</h3>
        <p>${grouped.get(jobNumber).length} location${grouped.get(jobNumber).length !== 1 ? "s" : ""}</p>
      </div>
    `;

    const grid = document.createElement("div");
    grid.className = "cards";
    grouped.get(jobNumber).forEach((location) => {
      grid.appendChild(createLocationCard(location, jobNumber));
    });
    section.appendChild(grid);
    locationCardsEl.appendChild(section);
  });
}

async function loadLocations() {
  const auth = getAuth();
  const filters = getSelectedFilters();
  if (!filters.jobNumber) {
    locations = [];
    renderLocationCards(locations);
    renderRequests([], []);
    authStatusEl.textContent = "Select a job to load locations.";
    updateReviewContextLabel();
    return;
  }

  locationCardsEl.innerHTML = "<p class=\"empty\">Loading reviewer-eligible locations...</p>";
  const params = {
    email: auth.email,
    key: auth.key
  };
  if (filters.jobNumber && filters.jobNumber !== ALL_JOBS_VALUE) {
    params.jobNumber = filters.jobNumber;
  }
  if (filters.city && filters.city !== "All cities") {
    params.city = filters.city;
  }

  const payload = await fetchJson(`/api/reviewer/locations?${new URLSearchParams(params).toString()}`);
  locations = payload.locations || [];
  renderLocationCards(locations);
  await loadRequests();
  updateReviewContextLabel();
}

authFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();

  // Reset all prior state on each new connect attempt
  openLocationId = "";
  locations = [];
  selectedFilters = { city: "All cities", jobNumber: "" };
  availableCities = [];
  availableJobs = [];
  jobCityMap = {};
  jobPostDateMap = {};
  pendingCollapsed = false;
  archivedVisible = false;
  reviewContextLabelEl.textContent = "";
  requestListEl.innerHTML = "";
  archivedRequestListEl.innerHTML = "";
  locationCardsEl.innerHTML = "";
  changeFiltersEl.disabled = true;
  authStatusEl.textContent = "Checking reviewer access...";

  try {
    await loadFilterOptions();
    await promptForFilters(true);
    changeFiltersEl.disabled = false;
    await loadLocations();
    const jobLabel = selectedFilters.jobNumber === ALL_JOBS_VALUE ? "All jobs" : selectedFilters.jobNumber;
    authStatusEl.textContent = `Connected — ${locations.length} location${locations.length !== 1 ? "s" : ""} loaded for ${jobLabel}.`;
  } catch (error) {
    authStatusEl.textContent = error.message;
    locationCardsEl.innerHTML = "";
    changeFiltersEl.disabled = true;
    reviewContextLabelEl.textContent = "";
  }
});

searchInput.addEventListener("input", () => {
  renderLocationCards(getFilteredLocations());
});

togglePendingEl.addEventListener("click", () => {
  pendingCollapsed = !pendingCollapsed;
  requestListEl.classList.toggle("hidden", pendingCollapsed);
  const pendingCount = requestListEl.querySelectorAll(".list-row").length;
  const archivedCount = archivedRequestListEl.querySelectorAll(".list-row").length;
  setQueueToggleLabels(pendingCount, archivedCount);
});

toggleArchivedEl.addEventListener("click", () => {
  archivedVisible = !archivedVisible;
  archivedRequestListEl.classList.toggle("hidden", !archivedVisible);
  const pendingCount = requestListEl.querySelectorAll(".list-row").length;
  const archivedCount = archivedRequestListEl.querySelectorAll(".list-row").length;
  setQueueToggleLabels(pendingCount, archivedCount);
});

changeFiltersEl.addEventListener("click", async () => {
  try {
    await promptForFilters(false);
    await loadLocations();
    authStatusEl.textContent = "Reviewer filters updated.";
  } catch (error) {
    authStatusEl.textContent = error.message;
  }
});

reviewContextLabelEl.textContent = "";
locationCardsEl.innerHTML = "<p class=\"empty\">Connect reviewer access to load eligible locations.</p>";
