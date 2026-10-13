// Makes text safe to place inside HTML
function esc(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

// Old images are saved like "assets/x.png", new uploads are full https links
function imgSrc(url) {
  return url || "";
}

// Build one gallery card from a database row
function buildCard(item) {
  const categoryLabel = item.category === "canvas" ? "Canvas Art" : "Mural";

  const tags = [`<span class="pill pill-accent">${categoryLabel}</span>`];
  if (item.is_featured) tags.push(`<span class="pill">Featured</span>`);
  if (item.is_sold) tags.push(`<span class="pill">Sold</span>`);
  if (item.year) tags.push(`<span class="pill">${esc(item.year)}</span>`);

  const metaParts = [];
  if (item.dimensions) {
    metaParts.push(`<span class="dim-label">${esc(item.dimensions)}</span>`);
  }
  if (item.category === "canvas" && !item.is_sold) {
    metaParts.push(
      `<a href="html/Commission.html" class="btn btn-outline">Acquire</a>`,
    );
  }
  const meta = metaParts.length
    ? `<div class="card-meta">${metaParts.join("")}</div>`
    : "";

  return `
    <article class="art-card" data-category="${esc(item.category)}">
      <div class="card-visual">
        <img src="${esc(imgSrc(item.image_url))}" alt="${esc(item.title)}" class="mandala-logo" loading="lazy" />
        <div class="card-tags">${tags.join("")}</div>
      </div>
      <div class="card-body">
        <h4 class="card-title">${esc(item.title)}</h4>
        <p class="card-desc">${esc(item.description)}</p>
        ${meta}
      </div>
    </article>
  `;
}

// Load artworks from Supabase and replace the hand-written cards
async function loadGallery() {
  const grid = document.querySelector(".gallery-grid");
  if (!grid || typeof supabaseClient === "undefined") return;

  const { data, error } = await supabaseClient
    .from("gallery_items")
    .select("*")
    .eq("is_visible", true)
    .order("id", { ascending: false }); // newest upload first

  // If anything goes wrong, keep the hand-written cards in index.html
  if (error || !data || !data.length) {
    if (error) console.error("Gallery load failed:", error);
    return;
  }

  grid.innerHTML = data.map(buildCard).join("");
  applyFilter(document.querySelector(".filter-tab.is-active"));
}

// Show or hide cards based on the selected tab
function applyFilter(button) {
  if (!button) return;
  const selected = button.getAttribute("data-filter");

  document.querySelectorAll(".art-card").forEach((card) => {
    const category = card.getAttribute("data-category");
    card.style.display =
      selected === "all" || category === selected ? "" : "none";
  });
}

function setupGalleryFilters() {
  const buttons = document.querySelectorAll(".filter-tab");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((btn) => btn.classList.remove("is-active"));
      button.classList.add("is-active");
      applyFilter(button);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupGalleryFilters();
  loadGallery();
});
