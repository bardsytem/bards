function esc(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function imgSrc(url) {
  return url || "";
}

// Build one gallery card from a database row
function buildCard(item) {
  const categoryNames = {
    mural: "Mural",
    canvas: "Canvas Art",
    others: "Others",
  };
  const categoryLabel = categoryNames[item.category] || "Mural";

  const tags = [`<span class="pill pill-accent">${categoryLabel}</span>`];
  if (item.is_featured) tags.push(`<span class="pill">Featured</span>`);
  if (item.is_sold) tags.push(`<span class="pill">Sold</span>`);
  if (item.not_for_sale) tags.push(`<span class="pill">Not for Sale</span>`);
  if (item.year) tags.push(`<span class="pill">${esc(item.year)}</span>`);

  const infoText = [item.location, item.dimensions].filter(Boolean).join(" • ");

  const metaParts = [];
  if (infoText) {
    metaParts.push(`<span class="dim-label">${esc(infoText)}</span>`);
  }
  if (item.category === "canvas" && !item.is_sold && !item.not_for_sale) {
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

async function loadGallery() {
  const grid = document.querySelector(".gallery-grid");
  if (!grid || typeof supabaseClient === "undefined") return;

  const { data, error } = await supabaseClient
    .from("gallery_items")
    .select("*")
    .eq("is_visible", true)
    .order("id", { ascending: false });

  if (error || !data || !data.length) {
    if (error) console.error("Gallery load failed:", error);
    return;
  }

  grid.innerHTML = data.map(buildCard).join("");
  applyFilter(document.querySelector(".filter-tab.is-active"));
}

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

// ---------- Copy to clipboard (contact buttons) ----------
(function () {
  const toast = document.createElement("div");
  toast.className = "copy-toast";
  toast.setAttribute("role", "status");
  document.body.appendChild(toast);

  let timer;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove("show"), 2000);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    box.remove();
    if (!ok) throw new Error("copy failed");
  }

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await copyText(btn.dataset.copy);
        showToast((btn.dataset.label || "Text") + " copied");
      } catch (err) {
        console.error(err);
        showToast("Could not copy. Please copy it manually.");
      }
    });
  });
})();

// ---------- Studio profile + contact info from the admin ----------
(async function loadProfile() {
  if (typeof supabaseClient === "undefined") return;

  const { data, error } = await supabaseClient
    .from("site_profile")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("Profile not loaded:", error);
    return;
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el && value) el.textContent = value;
  };

  setText("hero-tagline", data.tagline);
  setText("hero-story", data.story);
  setText("hero-signature", data.signature_name);
  setText("hero-location", data.location_tag);

  for (const n of [1, 2, 3]) {
    setText(`stat${n}-num`, data[`stat${n}_num`]);
    setText(`stat${n}-label`, data[`stat${n}_label`]);
  }

  const headline = document.getElementById("hero-headline");
  if (headline && data.headline) {
    const match = data.headline.match(/^(.*?)(\S+?)([?!.]*)$/);
    headline.innerHTML = match
      ? `${esc(match[1])}<span class="accent">${esc(match[2])}</span>${esc(match[3])}`
      : esc(data.headline);
  }

  // Portrait
  const portrait = document.getElementById("hero-portrait");
  if (portrait && data.portrait_url) portrait.src = data.portrait_url;

  const status = document.getElementById("hero-status");
  if (status) status.style.display = data.open_for_commissions ? "" : "none";

  const fbLink = document.getElementById("contact-fb");
  const callBtn = document.getElementById("contact-call");

  if (fbLink && data.contact_facebook) {
    if (/^https?:\/\//i.test(data.contact_facebook)) {
      fbLink.href = data.contact_facebook;
    }
    setText("contact-name", data.contact_name);
  }

  if (callBtn && data.contact_phone) {
    callBtn.dataset.copy = data.contact_phone.replace(/[^0-9+]/g, "");
    setText("contact-phone", data.contact_phone);
  }
})();
