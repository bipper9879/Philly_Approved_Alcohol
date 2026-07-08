const cardsRoot = document.getElementById("cards");
const searchInput = document.getElementById("search");
const cardTemplate = document.getElementById("card-template");

let locations = [];

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function renderCards(items) {
  cardsRoot.innerHTML = "";

  if (!items.length) {
    cardsRoot.innerHTML = "<p class=\"empty\">No locations are published for public view right now.</p>";
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
    meta.textContent = `Images hidden from public view. Published total: ${location.imageCount}`;

    const siteLabel = fragment.querySelector(".site-id-label");
    if (siteLabel) siteLabel.textContent = location.siteCode || `Site #${location.siteId}`;

    if (location.coverImage && location.coverImage.url) {
      img.src = `/${location.coverImage.url}`;
      img.alt = `${location.locationName} public cover image`;
    } else {
      card.querySelector(".cover-frame").innerHTML = "<div class=\"empty\">No cover published yet.</div>";
    }

    const href = `./location.html?location=${encodeURIComponent(location.locationName)}`;
    openLink.href = href;
    openLink.textContent = "Open location";

    cardsRoot.appendChild(fragment);
  });
}

async function loadLocations() {
  cardsRoot.innerHTML = "<p class=\"empty\">Loading locations...</p>";
  const response = await fetch("/api/public/locations", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load locations: ${response.status}`);
  }
  const payload = await response.json();
  locations = payload.locations || [];
  renderCards(locations);
}

searchInput.addEventListener("input", () => {
  const query = normalizeText(searchInput.value);
  if (!query) {
    renderCards(locations);
    return;
  }

  renderCards(
    locations.filter((item) => normalizeText(item.locationName).includes(query))
  );
});

loadLocations().catch((error) => {
  cardsRoot.innerHTML = `<p class="empty">Could not load locations. ${error.message}</p>`;
});
