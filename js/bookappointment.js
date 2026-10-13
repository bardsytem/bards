const MIN_DAYS_NOTICE = 1; // must book at least 1 day ahead
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

let viewYear;
let viewMonth;
let selectedDate = null;
let isSubmitting = false;
let blockedRows = []; // blocked windows set by the admin
const COOLDOWN_MS = 60 * 1000;

// =========== Helpers ==============
// "03:00 - 04:00 PM" and "03:00 - 4:00 PM" count as the same slot
function norm(label) {
  return String(label || "")
    .trim()
    .replace(/(^|\s)0(\d:)/g, "$1$2");
}

// Date.UTC milliseconds -> "2026-10-14"
function isoOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Date.UTC milliseconds -> "October 14, 2026" (the format saved in the database)
function dateTextOf(ms) {
  return new Date(ms).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function blocksFor(iso) {
  return blockedRows.filter((b) => b.start_date <= iso && iso <= b.end_date);
}

function isAllDayBlocked(ms) {
  return blocksFor(isoOf(ms)).some((b) => norm(b.time_range) === "All Day");
}

async function loadBlockedDates() {
  const { data, error } = await supabaseClient
    .from("blocked_dates")
    .select("start_date, end_date, time_range");

  if (error) {
    console.error("Could not load blocked dates:", error);
    return;
  }
  blockedRows = data || [];
  renderCalendar();
  refreshSlots();
}

// =========== Calendar ==============
function getTodayPHT() {
  const [y, m, d] = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })
    .split("-")
    .map(Number);
  return Date.UTC(y, m - 1, d);
}

function renderCalendar() {
  const today = getTodayPHT();
  const earliest = today + MIN_DAYS_NOTICE * DAY_MS;

  document.querySelector(".calendar-month").textContent =
    `${MONTHS[viewMonth]} ${viewYear}`;

  const firstWeekday = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
  const totalDays = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();

  let html = "";

  // Empty cells before the 1st
  for (let i = 0; i < firstWeekday; i++) {
    html += `<span class="is-muted"></span>`;
  }

  // One button per day
  for (let d = 1; d <= totalDays; d++) {
    const time = Date.UTC(viewYear, viewMonth, d);
    let classes = "calendar-day";
    let disabled = "";

    // Past days and days the admin blocked for the whole day
    if (time < earliest || isAllDayBlocked(time)) {
      classes += " is-past";
      disabled = "disabled";
    }
    if (time === today) classes += " is-today";
    if (time === selectedDate) classes += " is-selected";

    html += `<button type="button" class="${classes}" data-time="${time}" ${disabled}>${d}</button>`;
  }

  document.querySelector(".calendar-days").innerHTML = html;

  // Can't go back before the current month
  const now = new Date(today);
  const currentMonthIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  document.querySelector(".calendar-nav button").disabled =
    viewYear * 12 + viewMonth <= currentMonthIndex;
}

function changeMonth(step) {
  viewMonth += step;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear--;
  }
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear++;
  }
  renderCalendar();
}

function setupCalendar() {
  const [prevBtn, nextBtn] = document.querySelectorAll(".calendar-nav button");
  prevBtn.addEventListener("click", () => changeMonth(-1));
  nextBtn.addEventListener("click", () => changeMonth(1));

  // One listener for all days (buttons are re-created on every render)
  document.querySelector(".calendar-days").addEventListener("click", (e) => {
    const btn = e.target.closest(".calendar-day");
    if (!btn || btn.disabled) return;
    selectedDate = Number(btn.dataset.time);
    renderCalendar();
    refreshSlots();
  });

  const today = new Date(getTodayPHT());
  viewYear = today.getUTCFullYear();
  viewMonth = today.getUTCMonth();
  renderCalendar();

  setInterval(renderCalendar, 60 * 1000);
}

// ===================== Time slots =====================
function setupTimeSlotSelection() {
  const timeSlots = document.querySelectorAll(".slot");

  timeSlots.forEach((slot) => {
    slot.addEventListener("click", () => {
      if (slot.disabled) return;
      timeSlots.forEach((s) => {
        s.classList.remove("is-selected");
        delete s.dataset.selected;
      });
      slot.classList.add("is-selected");
      slot.dataset.selected = "true";
    });
  });
}

// Disable slots the admin blocked or that someone already booked
async function refreshSlots() {
  const slots = document.querySelectorAll(".slot");

  if (!selectedDate) {
    slots.forEach((s) => {
      s.disabled = false;
      s.title = "";
    });
    return;
  }

  const chosenDate = selectedDate;
  const blocks = blocksFor(isoOf(chosenDate));
  const allDay = blocks.some((b) => norm(b.time_range) === "All Day");

  let booked = [];
  const { data, error } = await supabaseClient.rpc("booked_slots", {
    p_date: dateTextOf(chosenDate),
  });
  if (error) console.error("Could not load booked slots:", error);
  else booked = (data || []).map((row) => norm(row.time_slot));

  // The visitor picked another date while we were loading
  if (chosenDate !== selectedDate) return;

  slots.forEach((slot) => {
    const label = norm(slot.textContent);
    const taken =
      allDay ||
      blocks.some((b) => norm(b.time_range) === label) ||
      booked.includes(label);

    slot.disabled = taken;
    slot.title = taken ? "Not available" : "";

    if (taken) {
      slot.classList.remove("is-selected");
      delete slot.dataset.selected;
    }
  });
}

// ===================== Booking =====================
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function handleBookingSubmit(
  name,
  email,
  phone,
  date,
  timeSlot,
  meetingType,
  details,
) {
  // Block double clicks and rapid repeats
  const last = Number(localStorage.getItem("lastBooking") || 0);
  if (isSubmitting || Date.now() - last < COOLDOWN_MS) {
    alert("Please wait a minute before submitting again.");
    return;
  }
  isSubmitting = true;

  try {
    // 1. Save data into Supabase table
    const { error } = await supabaseClient.from("appointments").insert([
      {
        client_name: name,
        client_email: email,
        client_phone: phone,
        booking_date: date,
        time_slot: timeSlot,
        meeting_type: meetingType,
        details: details,
      },
    ]);

    if (error) {
      // 23505 = someone else just booked this exact slot
      if (error.code === "23505") {
        alert("Sorry, that time slot was just taken. Please pick another.");
        refreshSlots();
        return;
      }
      throw error;
    }

    // 2. Send email notification via EmailJS
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      from_name: name,
      from_email: email,
      from_phone: phone,
      booking_date: date,
      time_slot: timeSlot,
      meeting_type: meetingType,
      message: details,
    });

    // Remember the time of this successful booking
    localStorage.setItem("lastBooking", Date.now());

    alert(
      `Thank you, ${name}! Your appointment has been saved and confirmed via email.`,
    );
    refreshSlots();
  } catch (err) {
    console.error("Error submitting appointment:", err);
    alert("Error: " + (err.message || err.text || JSON.stringify(err)));
  } finally {
    isSubmitting = false; // always unlock, even if there was an error
  }
}

function setupAppointmentSubmission() {
  const confirmButton = document.querySelector(".details-col .btn");
  const inputFields = document.querySelectorAll(".details-col .field");
  const emailInput = inputFields[1];
  const phoneInput = document.getElementById("client-phone");

  if (!emailInput || !confirmButton) return;

  emailInput.addEventListener("input", () => {
    const value = emailInput.value.trim();
    emailInput.classList.toggle(
      "input-error",
      value !== "" && !isValidEmail(value),
    );
  });

  // Only digits and + are allowed in the phone box
  if (phoneInput) {
    phoneInput.addEventListener("input", () => {
      const clean = phoneInput.value.replace(/[^0-9+]/g, "");
      phoneInput.classList.toggle("input-error", phoneInput.value !== clean);
      phoneInput.value = clean;
    });
  }

  confirmButton.addEventListener("click", () => {
    const nameInput = inputFields[0].value.trim();
    const emailValue = emailInput.value.trim();
    const phoneValue = phoneInput ? phoneInput.value.trim() : "";
    // The details box is always the last field
    const detailsInput = inputFields[inputFields.length - 1].value.trim();
    const selectedSlot = document.querySelector('.slot[data-selected="true"]');
    const meetingType =
      document
        .querySelector('input[name="meeting-type"]:checked')
        ?.closest("label")
        ?.querySelector("strong")?.textContent || "Standard";

    if (!nameInput || !emailValue) {
      alert("Please fill out both your name and email address.");
      return;
    }

    if (!isValidEmail(emailValue)) {
      emailInput.classList.add("input-error");
      alert("Please enter a valid email address.");
      return;
    }

    if (phoneInput && !/^\+?[0-9]{7,15}$/.test(phoneValue)) {
      phoneInput.classList.add("input-error");
      alert("Please enter a valid phone number (7 to 15 digits).");
      return;
    }

    if (!selectedDate) {
      alert("Please select a date from the calendar.");
      return;
    }

    // Safety check in case the page was left open past midnight
    if (selectedDate < getTodayPHT() + MIN_DAYS_NOTICE * DAY_MS) {
      alert("That date is no longer available. Please pick another.");
      selectedDate = null;
      renderCalendar();
      refreshSlots();
      return;
    }

    if (!selectedSlot) {
      alert("Please select a time slot.");
      return;
    }

    handleBookingSubmit(
      nameInput,
      emailValue,
      phoneValue,
      dateTextOf(selectedDate),
      selectedSlot.textContent.trim(),
      meetingType,
      detailsInput,
    );
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupCalendar();
  setupTimeSlotSelection();
  setupAppointmentSubmission();
  loadBlockedDates();
});
