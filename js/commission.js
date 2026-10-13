let isSubmitting = false;

// Prices saved by the admin, filled in from Supabase. Key: "category|scale"
let livePrices = {};

// Makes text safe to place inside HTML
function esc(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML.replace(/"/g, "&quot;");
}

// Show the price next to an artwork's name only when Canvas Piece is picked
function updatePieceLabels(showPrice, defaultMaterials) {
  const select = document.getElementById("artwork-type-select");
  if (!select) return;

  Array.from(select.options).forEach((option) => {
    if (!option.dataset.title) return; // skip the "Choose an artwork" line

    const price = option.dataset.price;
    if (showPrice && price !== "") {
      // An artwork without its own materials price uses the default one
      const materials =
        option.dataset.materials === ""
          ? defaultMaterials
          : Number(option.dataset.materials);
      const total = Number(price) + materials;
      option.textContent =
        option.dataset.title + " - ₱" + total.toLocaleString("en-US");
    } else {
      option.textContent = option.dataset.title;
    }
  });
}

// Fill the dropdown with the canvas pieces Bard added in the gallery
async function loadCanvasPieces() {
  const select = document.getElementById("artwork-type-select");
  if (!select) return;

  const piecesResult = await supabaseClient
    .from("gallery_items")
    .select("id, title, is_sold, not_for_sale")
    .eq("category", "canvas")
    .eq("is_visible", true)
    .order("id", { ascending: false });

  const pricesResult = await supabaseClient
    .from("canvas_prices")
    .select("item_id, price, materials");

  if (piecesResult.error || pricesResult.error) {
    console.error(piecesResult.error || pricesResult.error);
    select.innerHTML = `<option value="">Could not load pieces</option>`;
    return;
  }

  // Look up a price by artwork id
  const priceById = {};
  pricesResult.data.forEach((row) => {
    priceById[row.item_id] = {
      base: Number(row.price),
      materials: row.materials === null ? "" : Number(row.materials),
    };
  });

  let html = `<option value="">Choose an artwork...</option>`;
  piecesResult.data.forEach((piece) => {
    // Sold or not-for-sale pieces can't be bought, so skip them
    if (piece.is_sold || piece.not_for_sale) return;

    const own = priceById[piece.id];

    // The prices and title are stored on the option itself
    html += `<option value="${piece.id}"
                     data-title="${esc(piece.title)}"
                     data-price="${own ? own.base : ""}"
                     data-materials="${own ? own.materials : ""}">
               ${esc(piece.title)}
             </option>`;
  });

  select.innerHTML = html;
  updateCalculation();
}

// The buttons have no ids, so match them by their text / position
const CATEGORY_KEYS = {
  mural: "mural",
  "canvas piece": "canvas",
  "vehicle mural": "vehicle",
  others: "others",
};
const SCALE_KEYS = ["small", "medium", "large"];

function categoryKey(button) {
  return CATEGORY_KEYS[button.textContent.trim().toLowerCase()] || "others";
}

function scaleKey(button) {
  const all = document.querySelectorAll(".field-group:nth-of-type(2) .option");
  return SCALE_KEYS[Array.from(all).indexOf(button)] || "small";
}

// Get the latest prices the admin saved
async function loadPrices() {
  const { data, error } = await supabaseClient.from("pricing").select("*");

  if (error) {
    // Keep the built-in prices from Commission.html as a backup
    console.error("Could not load prices:", error);
    return;
  }

  livePrices = {};
  data.forEach((row) => {
    livePrices[`${row.category}|${row.scale}`] = {
      base: Number(row.base),
      scaleFee: Number(row.scale_fee),
      materials: Number(row.materials),
    };
  });

  updateCalculation();
}

// Function to update the running total price on the summary side panel
function updateCalculation() {
  const category = document.querySelector(
    ".field-group:nth-of-type(1) .option.is-active",
  );
  const scale = document.querySelector(
    ".field-group:nth-of-type(2) .option.is-active",
  );
  const scaleButtons = document.querySelectorAll(
    ".field-group:nth-of-type(2) .option",
  );
  const rows = document.querySelectorAll(".line-item");

  // true when the picked category doesn't need a scale
  const noScale = category.dataset.noScale === "true";

  // disable or enable the scale buttons
  scaleButtons.forEach((btn) => {
    btn.disabled = noScale;
  });

  // Admin prices if saved, otherwise the numbers written in the HTML
  const saved =
    livePrices[
      `${categoryKey(category)}|${noScale ? "none" : scaleKey(scale)}`
    ];

  let price1 = saved ? saved.base : Number(category.dataset.price);

  const price2 = noScale
    ? 0
    : saved
      ? saved.scaleFee
      : Number(scale.dataset.price);
  let price3 = saved ? saved.materials : Number(category.dataset.coatPrice);

  // Step 3 is always visible, but only a Canvas Piece uses the artwork's own prices
  const isCanvas = categoryKey(category) === "canvas";
  const pieceSelect = document.getElementById("artwork-type-select");

  const typeGroup = pieceSelect ? pieceSelect.closest(".field-group") : null;
  if (typeGroup) typeGroup.style.display = "";

  updatePieceLabels(isCanvas, price3);

  if (isCanvas && pieceSelect) {
    const option = pieceSelect.options[pieceSelect.selectedIndex];
    if (option && option.dataset.price) price1 = Number(option.dataset.price);
    if (option && option.dataset.materials) {
      price3 = Number(option.dataset.materials);
    }
  }

  const money = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

  rows[0].children[0].textContent = category.dataset.material;
  rows[0].children[1].textContent = money(price1);

  // Canvas pieces have no equipment line, so hide it
  rows[1].style.display = noScale ? "none" : "";
  rows[1].children[0].textContent = scale.dataset.equipment;
  rows[1].children[1].textContent = money(price2);

  rows[2].children[0].textContent = category.dataset.coat;
  rows[2].children[1].textContent = money(price3);

  document.querySelector(".total-num").textContent = money(
    price1 + price2 + price3,
  );
}

// Function to handle single choice selection inside option groups
function setupOptionGroupSelection() {
  const optionGroups = document.querySelectorAll(".option-row");

  optionGroups.forEach((group) => {
    const options = group.querySelectorAll(".option");

    options.forEach((button) => {
      button.addEventListener("click", () => {
        // Remove highlight from siblings in the same group
        options.forEach((opt) => opt.classList.remove("is-active"));

        // Mark clicked option as active
        button.classList.add("is-active");

        // Recalculate price
        updateCalculation();
      });
    });
  });

  const select = document.getElementById("artwork-type-select");
  const customBtn = document.getElementById("artwork-custom-btn");
  if (!select || !customBtn) return;

  // Picking a piece turns off "Custom / Others"
  select.addEventListener("change", () => {
    customBtn.classList.remove("is-active");
    updateCalculation();
  });

  // Picking "Custom / Others" clears the piece, so the default price is used
  customBtn.addEventListener("click", () => {
    select.value = "";
    updateCalculation();
  });
}

// Function to check if a value contains only digits
function isOnlyNumbers(value) {
  const phonePattern = /^\+?[0-9]*$/;
  return phonePattern.test(value);
}

// Function to check if an email string follows standard format
function isValidEmail(email) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
  return emailPattern.test(email);
}

// Function to submit commission details to Supabase and EmailJS
async function handleCommissionSubmit(
  name,
  phone,
  email,
  address,
  category,
  scale,
  cost,
  details,
) {
  isSubmitting = true;

  try {
    // 1. Save record to Supabase table
    const { error } = await supabaseClient.from("commissions").insert([
      {
        client_name: name,
        client_phone: phone,
        client_email: email,
        address: address,
        artwork_category: category,
        artwork_scale: scale,
        estimated_cost: cost,
        details: details,
      },
    ]);

    if (error) throw error;

    // 2. Send email alert via EmailJS (uses the commission template)
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_COMMISSION_TEMPLATE_ID, {
      from_name: name,
      from_phone: phone,
      from_email: email,
      address: address,
      artwork_category: category,
      artwork_scale: scale,
      estimated_cost: cost,
      message: details,
    });

    alert(
      `Thank you ${name}! Your commission quote has been stored and emailed.`,
    );
  } catch (err) {
    console.error("Error submitting commission:", err);
    alert("Error: " + (err.message || err.text || JSON.stringify(err)));
  } finally {
    isSubmitting = false;
  }
}

function setupCommissionSubmission() {
  const submitButton = document.querySelector(".estimate-col .btn");
  const nameInput = document.getElementById("customer-name");
  const phoneInput = document.getElementById("customer-phone");
  const emailInput = document.getElementById("customer-email");
  const addressInput = document.getElementById("customer-address");

  if (
    !nameInput ||
    !phoneInput ||
    !emailInput ||
    !addressInput ||
    !submitButton
  ) {
    console.error(
      "Commission form: missing button or input. Check the ids in Commission.html",
    );
    return;
  }

  phoneInput.addEventListener("input", () => {
    const cleanValue = phoneInput.value.replace(/[^0-9+]/g, "");
    if (phoneInput.value !== cleanValue) {
      phoneInput.classList.add("input-error");
      phoneInput.value = cleanValue;
    } else {
      phoneInput.classList.remove("input-error");
    }
  });

  // Turns the email box red when the format is wrong
  function checkEmailField() {
    const value = emailInput.value.trim();
    const isInvalid = value !== "" && !isValidEmail(value);

    emailInput.classList.toggle("input-error", isInvalid);
  }

  emailInput.addEventListener("input", checkEmailField);
  emailInput.addEventListener("blur", checkEmailField);

  submitButton.addEventListener("click", () => {
    const customerName = nameInput.value.trim();
    const customerPhone = phoneInput.value.trim();
    const customerEmail = emailInput.value.trim();
    const customerAddress = addressInput.value.trim();
    const details =
      document.querySelector(".form-col textarea")?.value.trim() || "";

    const activeCategory =
      document
        .querySelector(".field-group:nth-of-type(1) .option.is-active")
        ?.textContent.trim() || "Mural";

    // If an artwork was picked, record it next to the category
    let categoryLabel = activeCategory;
    const pieceSelect = document.getElementById("artwork-type-select");
    if (pieceSelect && pieceSelect.value) {
      const option = pieceSelect.options[pieceSelect.selectedIndex];
      categoryLabel = activeCategory + " - " + option.dataset.title;
    }

    const scaleButton = document.querySelector(
      ".field-group:nth-of-type(2) .option.is-active",
    );
    const activeScale =
      scaleButton && !scaleButton.disabled
        ? scaleButton.textContent.trim()
        : "N/A";

    const estimatedCost =
      document.querySelector(".total-num")?.textContent || "0.00";

    // Empty fields first, so the visitor always gets a message
    if (!customerName || !customerPhone || !customerEmail) {
      alert("Please fill in your name, phone number, and email address.");
      return;
    }

    if (!isValidEmail(customerEmail)) {
      checkEmailField();
      emailInput.focus();
      alert("Please enter a valid email address.");
      return;
    }

    if (!isOnlyNumbers(customerPhone)) {
      phoneInput.classList.add("input-error");
      alert("Please enter a valid phone number using digits only.");
      return;
    }

    // Call async helper function
    handleCommissionSubmit(
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      categoryLabel,
      activeScale,
      estimatedCost,
      details,
    );
  });
}

// Initialize quotation page components when ready
document.addEventListener("DOMContentLoaded", () => {
  setupOptionGroupSelection();
  setupCommissionSubmission();
  updateCalculation();
  loadPrices();
  loadCanvasPieces();
});
