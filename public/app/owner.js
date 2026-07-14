const authFormEl = document.getElementById("auth-form");
const authStatusEl = document.getElementById("auth-status");
const ownerContextLabelEl = document.getElementById("owner-context-label");
const queueSectionEl = document.getElementById("queue-section");
const requestListEl = document.getElementById("request-list");
const archivedRequestListEl = document.getElementById("archived-request-list");
const togglePendingEl = document.getElementById("toggle-pending");
const toggleArchivedEl = document.getElementById("toggle-archived");
const searchInput = document.getElementById("search");
const changeFiltersEl = document.getElementById("change-filters");
const filterDialogEl = document.getElementById("filter-dialog");
const popupCitySelectEl = document.getElementById("popup-city-select");
const popupJobSelectEl = document.getElementById("popup-job-select");
const locationCardsEl = document.getElementById("location-cards");
const requestTemplate = document.getElementById("request-template");
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function updateOwnerContextLabel() {
  const { city, jobNumber } = selectedFilters;
  if (!jobNumber) {
    ownerContextLabelEl.textContent = "";
    return;
  }
  const cityLabel = city && city !== "All cities" ? city : "All Cities";
  ownerContextLabelEl.textContent = jobNumber === ALL_JOBS_VALUE
    ? `${cityLabel} Owner View — All jobs`
    : `${cityLabel} Owner View — ${jobNumber}`;
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
  const allCities = availableCities.filter((city) => city !== "All cities");
  if (!jobNumber || jobNumber === ALL_JOBS_VALUE) {
    return ["All cities", ...allCities];
  }
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
  updateOwnerContextLabel();
  return true;
}

function statusBadge(status) {
  const map = {
    pending: "🟡 Pending owner approval",
    approved: "✅ Approved",
    rejected: "❌ Rejected",
    dismissed: "⛔ Dismissed"
  };
  return map[status] || status;
}

function sortRequests(requests) {
  const rank = { pending: 0, approved: 1, rejected: 2, dismissed: 3 };
  return [...requests].sort((a, b) => {
    const aRank = rank[a.status] ?? 99;
    const bRank = rank[b.status] ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function setQueueToggleLabels(pendingCount, archivedCount) {
  togglePendingEl.textContent = pendingCollapsed
    ? `Show pending (${pendingCount})`
    : `Collapse pending (${pendingCount})`;
  toggleArchivedEl.textContent = archivedVisible
    ? `Hide archived (${archivedCount})`
    : `View archived requests (${archivedCount})`;
}

function createRequestRow(request, interactive) {
  const fragment = requestTemplate.content.cloneNode(true);
  fragment.querySelector(".req-location").textContent = request.locationName;
  fragment.querySelector(".badge").textContent = statusBadge(request.status);
  fragment.querySelector(".req-requester").textContent =
    `${request.requesterName} (${request.requesterEmail})`;
  fragment.querySelector(".req-note").textContent = request.note || "No note.";
  fragment.querySelector(".muted.req-date").textContent =
    new Date(request.createdAt).toLocaleString();

  const preview = fragment.querySelector(".req-preview");
  if (request.requestedImageUrl) {
    const img = document.createElement("img");
    img.src = `/${request.requestedImageUrl}`;
    img.alt = `Requested cover: ${request.requestedImageName}`;
    img.style.cssText = "max-width:100%;max-height:220px;border-radius:10px;margin-top:8px;object-fit:contain;background:#ece2d3;";
    preview.appendChild(img);

    const nameEl = document.createElement("p");
    nameEl.className = "meta";
    nameEl.textContent = request.requestedImageName;
    preview.appendChild(nameEl);
  }

  const actionsEl = fragment.querySelector(".req-actions");
  actionsEl.style.marginTop = "10px";
  actionsEl.style.display = "flex";
  actionsEl.style.gap = "8px";
  actionsEl.style.flexWrap = "wrap";
  const inlineAccordionEl = document.createElement("div");
  inlineAccordionEl.className = "accordion-panel hidden";
  let inlineOpen = false;

  if (interactive && request.status === "pending" && request.requestedImageName) {
    const previewBtn = document.createElement("button");
    previewBtn.className = "button";
    previewBtn.type = "button";
    previewBtn.textContent = "Open location photos";
    previewBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (inlineOpen) {
        inlineOpen = false;
        inlineAccordionEl.classList.add("hidden");
        previewBtn.textContent = "Open location photos";
        return;
      }

      inlineOpen = true;
      previewBtn.textContent = "Collapse photos";
      inlineAccordionEl.classList.remove("hidden");
      inlineAccordionEl.innerHTML = "<p class=\"empty\" style=\"padding:12px\">Loading images...</p>";
      const auth = getAuth();
      try {
        const imagesPayload = await fetchJson(
          `/api/owner/locations/${encodeURIComponent(request.locationId)}/images?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
        );
        buildOwnerAccordionImages(imagesPayload, inlineAccordionEl, request.locationId);
      } catch (error) {
        inlineAccordionEl.innerHTML = `<p class="empty" style="padding:12px">${error.message}</p>`;
      }
    });
    actionsEl.appendChild(previewBtn);

    const approveBtn = document.createElement("button");
    approveBtn.className = "button button-primary";
    approveBtn.type = "button";
    approveBtn.textContent = "✅ Approve";
    approveBtn.addEventListener("click", async () => {
      approveBtn.disabled = true;
      approveBtn.textContent = "Approving...";
      const auth = getAuth();
      try {
        const result = await fetchJson(
          `/api/owner/cover-requests/${request.id}/approve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: auth.email, key: auth.key })
          }
        );
        authStatusEl.textContent = `✅ Approved! Public cover updated for ${result.request.locationName}. Share: ${window.location.origin}${result.shareUrl}`;
        await loadLocations();
        await loadRequests();
      } catch (error) {
        authStatusEl.textContent = error.message;
        approveBtn.disabled = false;
        approveBtn.textContent = "✅ Approve";
      }
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "button";
    rejectBtn.type = "button";
    rejectBtn.textContent = "❌ Reject";
    rejectBtn.addEventListener("click", async () => {
      rejectBtn.disabled = true;
      rejectBtn.textContent = "Rejecting...";
      const auth = getAuth();
      try {
        await fetchJson(
          `/api/owner/cover-requests/${request.id}/reject`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: auth.email, key: auth.key })
          }
        );
        authStatusEl.textContent = "Request rejected.";
        await loadRequests();
      } catch (error) {
        authStatusEl.textContent = error.message;
        rejectBtn.disabled = false;
        rejectBtn.textContent = "❌ Reject";
      }
    });

    actionsEl.appendChild(approveBtn);
    actionsEl.appendChild(rejectBtn);
  }

  const row = fragment.querySelector(".list-row");
  row.dataset.locationId = request.locationId;
  if (request.status !== "pending") {
    row.classList.add("list-row-resolved");
  }
  row.appendChild(inlineAccordionEl);
  return fragment;
}

function renderRequests(activeRequests, archivedRequests) {
  requestListEl.innerHTML = "";
  archivedRequestListEl.innerHTML = "";
  const visibleLocationIds = new Set(locations.map((entry) => entry.locationId));

  const pending = sortRequests(activeRequests || [])
    .filter((request) => request.status === "pending")
    .filter((request) => visibleLocationIds.has(request.locationId));
  const archived = sortRequests(archivedRequests || [])
    .filter((request) => visibleLocationIds.has(request.locationId));
  setQueueToggleLabels(pending.length, archived.length);

  if (!pending.length) {
    requestListEl.classList.remove("hidden");
    requestListEl.innerHTML = "<p class=\"empty\">No requests in this view.</p>";
  } else if (pendingCollapsed) {
    requestListEl.classList.add("hidden");
  } else {
    requestListEl.classList.remove("hidden");
    pending.forEach((request) => {
      requestListEl.appendChild(createRequestRow(request, true));
    });
  }

  if (!archived.length) {
    archivedRequestListEl.innerHTML = "<p class=\"empty\">No archived requests in this view.</p>";
  } else {
    archived.forEach((request) => {
      archivedRequestListEl.appendChild(createRequestRow(request, false));
    });
  }
  archivedRequestListEl.classList.toggle("hidden", !archivedVisible);
}

function getFilteredLocations() {
  const query = normalizeText(searchInput.value).toLowerCase();
  if (!query) return locations;
  return locations.filter((item) =>
    normalizeText(item.locationName).toLowerCase().includes(query)
  );
}

function buildOwnerAccordionImages(data, accordionEl, locationId) {
  accordionEl.innerHTML = "";

  const header = document.createElement("div");
  header.className = "accordion-header";
  header.innerHTML = `<p class="meta">Owner mode — ${data.images.length} images. Set cover directly.</p>`;
  if (queueSectionEl) {
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "button";
    backButton.textContent = "Back to pending requests";
    backButton.style.marginTop = "8px";
    backButton.addEventListener("click", (event) => {
      event.stopPropagation();
      queueSectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    header.appendChild(backButton);
  }
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

    button.addEventListener("click", async () => {
      const auth = getAuth();
      button.disabled = true;
      button.textContent = "Setting...";
      try {
        const result = await fetchJson(
          `/api/owner/locations/${encodeURIComponent(locationId)}/cover`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: auth.email, key: auth.key, imageName: image.name })
          }
        );
        authStatusEl.textContent = `✅ Cover set for ${data.locationName}. Share: ${window.location.origin}${result.shareUrl}`;
        await loadLocations();
        await loadRequests();
      } catch (error) {
        authStatusEl.textContent = error.message;
        button.disabled = false;
        button.textContent = "Set as public cover";
      }
    });

    grid.appendChild(fragment);
  });
}

async function toggleLocationAccordion(locationId, cardEl) {
  const auth = getAuth();
  if (!auth.email || !auth.key) {
    authStatusEl.textContent = "Enter owner email and key first.";
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
      `/api/owner/locations/${encodeURIComponent(locationId)}/images?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
    );
    buildOwnerAccordionImages(imagesPayload, accordionEl, locationId);
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

function createLocationCard(location, focusJobNumber = "") {
  const fragment = locationCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".card");
  const img = fragment.querySelector("img");
  const jobLabel = fragment.querySelector(".job-number-label");
  const siteLabel = fragment.querySelector(".site-id-label");
  const title = fragment.querySelector("h2");
  const meta = fragment.querySelector(".meta");
  const openButton = fragment.querySelector(".button-primary");
  card.dataset.locationId = location.locationId;

  const allJobs = Array.isArray(location.jobNumbers) ? location.jobNumbers.filter(Boolean) : [];
  const badgeJob = focusJobNumber || allJobs[0] || "Unassigned";
  jobLabel.textContent = `Job ${badgeJob}`;
  siteLabel.textContent = location.siteCode || "No site code";
  title.textContent = location.locationName;
  const visibility = location.published ? "Public: live" : "Public: hidden";
  const jobsMeta = allJobs.length ? ` • Jobs: ${allJobs.join(", ")}` : "";
  meta.textContent = `${location.imageCount} images • ${visibility}${jobsMeta}`;

  if (location.coverImage && location.coverImage.url) {
    img.src = `/${location.coverImage.url}`;
    img.alt = `${location.locationName} cover`;
  } else {
    card.querySelector(".cover-frame").innerHTML = "<div class=\"empty\">No cover yet.</div>";
  }

  if (location.locationId === openLocationId) {
    card.classList.add("card-active");
    openButton.textContent = "Collapse";
  }

  const toggle = () => toggleLocationAccordion(location.locationId, card);
  card.addEventListener("click", (event) => {
    if (event.target.closest("button") && !event.target.closest(".button-primary")) return;
    toggle();
  });
  openButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggle();
  });

  const actions = card.querySelector(".actions");
  const publishButton = document.createElement("button");
  publishButton.type = "button";
  publishButton.className = "button";
  publishButton.textContent = location.published ? "Unpublish from public" : "Hidden (awaiting approval)";
  if (!location.published) {
    publishButton.disabled = true;
  }
  publishButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!location.published) {
      authStatusEl.textContent = "Location is already hidden until an owner approval publishes it.";
      return;
    }

    const auth = getAuth();
    publishButton.disabled = true;
    publishButton.textContent = "Updating...";
    try {
      await fetchJson(`/api/owner/locations/${encodeURIComponent(location.locationId)}/unpublish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: auth.email, key: auth.key })
      });
      authStatusEl.textContent = `Unpublished ${location.locationName}.`;
      await loadLocations();
      await loadRequests();
    } catch (error) {
      authStatusEl.textContent = error.message;
    } finally {
      publishButton.disabled = false;
    }
  });
  actions.appendChild(publishButton);

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

function renderLocationCards(items) {
  locationCardsEl.innerHTML = "";
  locationCardsEl.classList.remove("cards");

  if (!items.length) {
    locationCardsEl.innerHTML = "<p class=\"empty\">No locations matched.</p>";
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

async function loadFilterOptions() {
  const auth = getAuth();
  const payload = await fetchJson(
    `/api/owner/filter-options?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
  );
  availableCities = (payload.cities || []).map((city) => String(city));
  availableJobs = (payload.jobNumbers || []).map((job) => String(job));
  jobCityMap = payload.jobCities || {};
  if (!availableJobs.length) {
    throw new Error("No owner jobs are available yet.");
  }
}

async function loadRequests() {
  const auth = getAuth();
  const payload = await fetchJson(
    `/api/owner/cover-requests?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
  );
  renderRequests(payload.requests || [], payload.archivedRequests || []);
}

async function loadLocations() {
  const auth = getAuth();
  locationCardsEl.innerHTML = "<p class=\"empty\">Loading owner locations...</p>";
  const params = {
    email: auth.email,
    key: auth.key
  };
  if (selectedFilters.jobNumber && selectedFilters.jobNumber !== ALL_JOBS_VALUE) {
    params.jobNumber = selectedFilters.jobNumber;
  }
  if (selectedFilters.city && selectedFilters.city !== "All cities") {
    params.city = selectedFilters.city;
  }

  const payload = await fetchJson(`/api/owner/locations?${new URLSearchParams(params).toString()}`);
  locations = payload.locations || [];
  renderLocationCards(getFilteredLocations());
}

authFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  openLocationId = "";
  locations = [];
  selectedFilters = { city: "All cities", jobNumber: "" };
  availableCities = [];
  availableJobs = [];
  jobCityMap = {};
  pendingCollapsed = false;
  archivedVisible = false;
  ownerContextLabelEl.textContent = "";
  requestListEl.innerHTML = "";
  archivedRequestListEl.innerHTML = "";
  locationCardsEl.innerHTML = "";
  changeFiltersEl.disabled = true;
  authStatusEl.textContent = "Checking owner access...";

  try {
    await loadFilterOptions();
    await promptForFilters(true);
    changeFiltersEl.disabled = false;
    await loadLocations();
    await loadRequests();
    const jobLabel = selectedFilters.jobNumber === ALL_JOBS_VALUE ? "All jobs" : selectedFilters.jobNumber;
    authStatusEl.textContent = `Owner access connected — ${locations.length} location${locations.length !== 1 ? "s" : ""} loaded for ${jobLabel}.`;
  } catch (error) {
    authStatusEl.textContent = error.message;
    changeFiltersEl.disabled = true;
    ownerContextLabelEl.textContent = "";
    locationCardsEl.innerHTML = "<p class=\"empty\">Connect owner access to load locations.</p>";
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
    await loadRequests();
    authStatusEl.textContent = "Owner filters updated.";
  } catch (error) {
    authStatusEl.textContent = error.message;
  }
});

ownerContextLabelEl.textContent = "";
locationCardsEl.innerHTML = "<p class=\"empty\">Connect owner access to load locations.</p>";
