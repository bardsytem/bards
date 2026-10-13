let isSubmitting = false;
const COOLDOWN_MS = 60 * 1000;

// Prices saved by the admin, filled in from Supabase. Key: "category|scale"
let livePrices = {};

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

  const price1 = saved ? saved.base : Number(category.dataset.price);
  const price2 = noScale
    ? 0
    : saved
      ? saved.scaleFee
      : Number(scale.dataset.price);
  const price3 = saved ? saved.materials : Number(category.dataset.coatPrice);

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
  // Block double clicks and rapid repeats
  const last = Number(localStorage.getItem("lastCommission") || 0);
  if (isSubmitting || Date.now() - last < COOLDOWN_MS) {
    alert("Please wait a minute before submitting again.");
    return;
  }
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

    // Remember the time of this successful submission
    localStorage.setItem("lastCommission", Date.now());

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
      activeCategory,
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
});
