const authFormEl = document.getElementById("auth-form");
const authStatusEl = document.getElementById("auth-status");
const requestListEl = document.getElementById("request-list");
const searchInput = document.getElementById("search");
const locationCardsEl = document.getElementById("location-cards");
const detailPanelEl = document.getElementById("detail-panel");
const detailTitleEl = document.getElementById("detail-title");
const detailMetaEl = document.getElementById("detail-meta");
const ownerGridEl = document.getElementById("owner-grid");
const requestTemplate = document.getElementById("request-template");
const locationCardTemplate = document.getElementById("location-card-template");
const imageTemplate = document.getElementById("image-template");

let locations = [];
let selectedLocationId = "";

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

function statusBadge(status) {
  const map = {
    pending: "🟡 Pending",
    approved: "✅ Approved",
    rejected: "❌ Rejected",
    dismissed: "⛔ Dismissed"
  };
  return map[status] || status;
}

async function loadRequests() {
  const auth = getAuth();
  const payload = await fetchJson(
    `/api/owner/cover-requests?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
  );
  renderRequests(payload.requests || []);
}

function renderRequests(requests) {
  requestListEl.innerHTML = "";

  if (!requests.length) {
    requestListEl.innerHTML = "<p class=\"empty\">No requests yet.</p>";
    return;
  }

  requests.forEach((request) => {
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

    if (request.status === "pending") {
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
          const freshLocations = await fetchJson("/api/public/locations");
          locations = freshLocations.locations || [];
          renderLocationCards(getFilteredLocations());
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
          authStatusEl.textContent = `Request rejected.`;
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
    if (request.status !== "pending") {
      row.classList.add("list-row-resolved");
    }

    requestListEl.appendChild(fragment);
  });
}

function getFilteredLocations() {
  const query = normalizeText(searchInput.value).toLowerCase();
  if (!query) return locations;
  return locations.filter((item) =>
    normalizeText(item.locationName).toLowerCase().includes(query)
  );
}

async function loadOwnerLocation(locationId) {
  const auth = getAuth();
  if (!auth.email || !auth.key) {
    authStatusEl.textContent = "Enter owner email and key first.";
    return;
  }

  selectedLocationId = locationId;
  authStatusEl.textContent = "Loading images...";

  try {
    const imagesPayload = await fetchJson(
      `/api/reviewer/locations/${encodeURIComponent(locationId)}/images?email=${encodeURIComponent(auth.email)}&key=${encodeURIComponent(auth.key)}`
    );

    detailPanelEl.classList.remove("hidden");
    detailTitleEl.textContent = `${imagesPayload.locationName} — set cover directly`;
    detailMetaEl.textContent = `Total images: ${imagesPayload.images.length}. Setting cover here creates a tracking ticket.`;
    ownerGridEl.innerHTML = "";

    imagesPayload.images.forEach((image) => {
      const fragment = imageTemplate.content.cloneNode(true);
      const img = fragment.querySelector("img");
      const meta = fragment.querySelector(".meta");
      const button = fragment.querySelector("button");

      img.src = `/${image.url}`;
      img.alt = `${imagesPayload.locationName} - ${image.name}`;
      meta.textContent = imagesPayload.effectiveCover && imagesPayload.effectiveCover.name === image.name
        ? `${image.name} — current public cover`
        : image.name;

      button.addEventListener("click", async () => {
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
          authStatusEl.textContent = `✅ Cover set for ${imagesPayload.locationName}. Share: ${window.location.origin}${result.shareUrl}`;
          const freshLocations = await fetchJson("/api/public/locations");
          locations = freshLocations.locations || [];
          renderLocationCards(getFilteredLocations());
          await loadOwnerLocation(locationId);
          await loadRequests();
        } catch (error) {
          authStatusEl.textContent = error.message;
          button.disabled = false;
          button.textContent = "Set as public cover";
        }
      });

      ownerGridEl.appendChild(fragment);
    });

    detailPanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
    renderLocationCards(getFilteredLocations());
    authStatusEl.textContent = `Loaded images for ${imagesPayload.locationName}.`;
  } catch (error) {
    authStatusEl.textContent = error.message;
    detailPanelEl.classList.add("hidden");
  }
}

function renderLocationCards(items) {
  locationCardsEl.innerHTML = "";

  if (!items.length) {
    locationCardsEl.innerHTML = "<p class=\"empty\">No locations matched.</p>";
    return;
  }

  items.forEach((location) => {
    const fragment = locationCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const img = fragment.querySelector("img");
    const title = fragment.querySelector("h2");
    const meta = fragment.querySelector(".meta");

    title.textContent = location.locationName;
    meta.textContent = `${location.imageCount} images`;

    if (location.coverImage && location.coverImage.url) {
      img.src = `/${location.coverImage.url}`;
      img.alt = `${location.locationName} cover`;
    } else {
      card.querySelector(".cover-frame").innerHTML = "<div class=\"empty\">No cover yet.</div>";
    }

    if (location.locationId === selectedLocationId) {
      card.classList.add("card-active");
    }

    card.addEventListener("click", () => {
      loadOwnerLocation(location.locationId);
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
  authStatusEl.textContent = "Checking owner access...";
  try {
    await loadRequests();
    authStatusEl.textContent = "Owner access connected. Review requests above or browse locations below.";
  } catch (error) {
    authStatusEl.textContent = error.message;
  }
});

searchInput.addEventListener("input", () => {
  renderLocationCards(getFilteredLocations());
});

loadLocations().catch((error) => {
  authStatusEl.textContent = error.message;
});

