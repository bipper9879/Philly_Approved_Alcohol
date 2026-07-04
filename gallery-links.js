(() => {
  function normalizeText(value) {
    return (value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function rewriteGalleryLinks() {
    const rows = document.querySelectorAll("table tr");

    rows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 9) {
        return;
      }

      const location = normalizeText(cells[2].textContent);
      const photoLink = row.querySelector('a[href*="index_files/"]');
      if (!location || !photoLink || normalizeText(photoLink.textContent) !== "Click to View Photos") {
        return;
      }

      photoLink.href = `../gallery.html?location=${encodeURIComponent(location)}`;
      photoLink.target = "_parent";
      photoLink.dataset.location = location;
      photoLink.title = `Open photo gallery for ${location}`;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", rewriteGalleryLinks);
  } else {
    rewriteGalleryLinks();
  }
})();