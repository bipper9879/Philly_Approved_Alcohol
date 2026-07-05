const authFormEl = document.getElementById("auth-form");
const authStatusEl = document.getElementById("auth-status");
const requestListEl = document.getElementById("request-list");
const searchInput = document.getElementById("search");
const locationCardsEl = document.getElementById("location-cards");
const locationCardTemplate = document.getElementById("location-card-template");
const imageTemplate = document.getElementById("image-template");

let locations = [];
let openLocationId = "";
let queueRefreshTimer = null;

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFilteredLocations() {
  const query = normalizeText(searchInput.value).toLowerCase();
  if (!query) return locations;
  return locations.filter((item) =>
    normalizeText(item.locationName).toLowerCase().includes(query)
  );
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

function statusBadge(status) {
  const map = { pending: "🟡 Pending", reviewed: "🟣 Reviewed", resolved: "✅ Resolved", dismissed: "⛔ Dismissed", approved: "✅ Approved", rejected: "❌ Rejected" };
  return map[status] || status;
}

function renderRequests(requests) {
  requestListEl.innerHTML = "";
  if (!requests.length) {
    requestListEl.innerHTML = "<p class=\"empty\">No requests yet.</p>";
    return;
  }

  requests.forEach((request) => {
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
      <span class="muted">${new Date(request.createdAt).toLocaleString()}</span>
    `;

    row.style.cursor = "pointer";
    row.title = "Open this location";
    row.addEventListener("click", async () => {
      const locationId = row.dataset.locationId;
      if (!locationId) {
        return;
      }

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

    requestListEl.appendChild(row);
  });
}


function buildAccordionImages(data, accordionEl) {
  accordionEl.innerHTML = "";

  const header = document.createElement("div");
  header.className = "accordion-header";
  header.innerHTML = `<p class="meta">Reviewer mode — ${data.images.length} images. Select one to request as public cover.</p>`;
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

    button.textContent = "Request this as cover";
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
        authStatusEl.textContent = `Cover request submitted for ${data.locationName}. The owner will review and approve.`;
        await loadRequests();
      } catch (error) {
        authStatusEl.textContent = error.message;
        button.disabled = false;
        button.textContent = "Request this as cover";
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

  // Close if already open
  if (openLocationId === locationId) {
    openLocationId = "";
    accordionEl.classList.add("hidden");
    cardEl.classList.remove("card-active");
    return;
  }

  // Close previously open accordion
  const prev = locationCardsEl.querySelector(".card-active");
  if (prev) {
    prev.querySelector(".accordion-panel").classList.add("hidden");
    prev.classList.remove("card-active");
  }

  openLocationId = locationId;
  cardEl.classList.add("card-active");
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
    openLocationId = "";
  }
}

async function loadRequests() {
  const auth = getAuth();
  const requestsPayload = await fetchJson(
    `/api/reviewer/cover-requests?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
  );
  renderRequests(requestsPayload.requests || []);
}

function renderLocationCards(items) {
  locationCardsEl.innerHTML = "";

  if (!items.length) {
    locationCardsEl.innerHTML = "<p class=\"empty\">No locations matched your search.</p>";
    return;
  }

  items.forEach((location) => {
    const fragment = locationCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const img = fragment.querySelector("img");
    const siteLabel = fragment.querySelector(".site-id-label");
    const title = fragment.querySelector("h2");
    const meta = fragment.querySelector(".meta");
    const button = fragment.querySelector(".button-primary");
    const accordionEl = fragment.querySelector(".accordion-panel");
    card.dataset.locationId = location.locationId;

    siteLabel.textContent = location.siteCode || `Site #${location.siteId}`;
    siteLabel.className = "site-id-label";
    title.textContent = location.locationName;
    meta.textContent = `${location.imageCount} image${location.imageCount !== 1 ? "s" : ""}`;

    if (location.coverImage && location.coverImage.url) {
      img.src = `/${location.coverImage.url}`;
      img.alt = `${location.locationName} public cover image`;
    } else {
      card.querySelector(".cover-frame").innerHTML = "<div class=\"empty\">No cover yet.</div>";
    }

    if (location.locationId === openLocationId) {
      card.classList.add("card-active");
    }

    card.style.cursor = "pointer";

    const toggle = () => toggleLocationAccordion(location.locationId, card);

    card.addEventListener("click", (event) => {
      if (event.target.closest("button") && !event.target.closest(".button-primary")) return;
      toggle();
    });

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle();
    });

    locationCardsEl.appendChild(fragment);
  });
}

async function loadLocations() {
  locationCardsEl.innerHTML = "<p class=\"empty\">Loading locations...</p>";
  const payload = await fetchJson("/api/public/locations");
  locations = payload.locations || [];
  renderLocationCards(locations);
}

authFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  authStatusEl.textContent = "Checking reviewer access...";
  try {
    await loadRequests();
    authStatusEl.textContent = "Reviewer access connected. Click any location card to browse its photos.";
  } catch (error) {
    authStatusEl.textContent = error.message;
    requestListEl.innerHTML = "";
  }
});

searchInput.addEventListener("input", () => {
  renderLocationCards(getFilteredLocations());
});

loadLocations().catch((error) => {
  authStatusEl.textContent = error.message;
});







