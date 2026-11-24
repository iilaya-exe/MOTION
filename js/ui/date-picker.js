import { esc } from "../dom.js";
import { icon } from "../icons.js";
import { dateKey, parseDateKey, todayKey, MONTH_NAMES } from "../lib/dates.js";

/* A friendlier stand-in for <input type="date">: a button that reads "Today"
   or "Fri, Nov 27", opening quick picks and a month grid.

   The original input stays in the page, visually hidden, and remains the one
   source of the value: code (and tests) that read or set input.value keep
   working, and setting it from outside updates the button. */

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const addDays = (key, n) => {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};

/** "Today", "Tomorrow", "Yesterday", else "Fri, Nov 27" (plus the year if not this one). */
export function friendlyDate(key) {
  if (!key) return "";
  const today = todayKey();
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  if (key === addDays(today, -1)) return "Yesterday";
  const d = parseDateKey(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Monday of next week, the usual meaning of "next week" for a due date. */
function nextMonday() {
  const d = parseDateKey(todayKey());
  const ahead = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + ahead);
  return dateKey(d);
}

/**
 * @param {HTMLInputElement} input  the existing date input, kept as the value holder
 * @param {{ placeholder?: string }} [opts]
 */
export function attachDatePicker(input, { placeholder = "Due date" } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "datepick";
  input.before(wrap);
  wrap.appendChild(input);
  input.classList.add("datepick-native");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "field datepick-btn";
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  wrap.appendChild(button);

  const pop = document.createElement("div");
  pop.className = "datepick-pop hidden";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Choose a due date");
  wrap.appendChild(pop);

  let month = null; // first of the month being shown, as a Date
  let focusKey = null; // the day that has keyboard focus in the grid

  const set = (key) => {
    input.value = key || "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
  };

  function sync() {
    const key = input.value;
    button.classList.toggle("is-empty", !key);
    button.classList.toggle("is-past", Boolean(key) && key < todayKey());
    button.innerHTML = `${icon("calendarSm")}<span>${esc(key ? friendlyDate(key) : placeholder)}</span>`;
    button.setAttribute("aria-label", key ? `Due ${friendlyDate(key)}. Change due date` : "Set a due date");
  }

  function renderPop() {
    const today = todayKey();
    const picked = input.value;
    const y = month.getFullYear();
    const m = month.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();

    const quick = [
      ["Today", today],
      ["Tomorrow", addDays(today, 1)],
      ["Next week", nextMonday()],
    ];

    let grid = WEEKDAYS.map((w) => `<span class="dp-dow" aria-hidden="true">${w}</span>`).join("");
    for (let i = 0; i < firstDow; i++) grid += '<span class="dp-blank"></span>';
    for (let d = 1; d <= days; d++) {
      const key = dateKey(new Date(y, m, d));
      const cls = ["dp-day"];
      if (key === today) cls.push("is-today");
      if (key === picked) cls.push("is-picked");
      grid +=
        `<button type="button" class="${cls.join(" ")}" data-key="${key}" tabindex="${key === focusKey ? 0 : -1}" ` +
        `aria-label="${esc(parseDateKey(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}"` +
        `${key === picked ? ' aria-pressed="true"' : ""}>${d}</button>`;
    }

    pop.innerHTML =
      `<div class="dp-quick">${quick
        .map(([label, key]) => `<button type="button" data-key="${key}"${key === picked ? ' class="is-picked"' : ""}>${label}<small>${esc(friendlyDate(key) === label ? parseDateKey(key).toLocaleDateString(undefined, { weekday: "short" }) : friendlyDate(key))}</small></button>`)
        .join("")}</div>` +
      `<div class="dp-head">` +
      `<button type="button" class="dp-nav" data-step="-1" aria-label="Previous month">${icon("chevronDown", "icon dp-prev")}</button>` +
      `<span class="dp-title">${MONTH_NAMES[m]} ${y}</span>` +
      `<button type="button" class="dp-nav" data-step="1" aria-label="Next month">${icon("chevronDown", "icon dp-next")}</button>` +
      `</div>` +
      `<div class="dp-grid">${grid}</div>` +
      (picked ? '<button type="button" class="dp-clear" data-key="">Remove due date</button>' : "");
  }

  const isOpen = () => !pop.classList.contains("hidden");

  function open() {
    const start = input.value || todayKey();
    const d = parseDateKey(start);
    month = new Date(d.getFullYear(), d.getMonth(), 1);
    focusKey = start;
    renderPop();
    pop.classList.remove("hidden");
    button.setAttribute("aria-expanded", "true");
    pop.querySelector(`.dp-day[data-key="${focusKey}"]`)?.focus();
  }

  function close(returnFocus = true) {
    if (!isOpen()) return;
    pop.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) button.focus({ preventScroll: true });
  }

  button.addEventListener("click", () => (isOpen() ? close() : open()));

  pop.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-step]");
    if (nav) {
      month.setMonth(month.getMonth() + Number(nav.dataset.step));
      focusKey = dateKey(month);
      renderPop();
      pop.querySelector(`[data-step="${nav.dataset.step}"]`)?.focus();
      return;
    }
    const pick = e.target.closest("[data-key]");
    if (!pick) return;
    set(pick.dataset.key);
    close();
  });

  // Arrow keys walk the days; Page Up/Down change month; Escape closes.
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const day = e.target.closest(".dp-day");
    if (!day) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const pageStep = { PageUp: -1, PageDown: 1 }[e.key];
    if (!step && !pageStep) return;
    e.preventDefault();
    let next;
    if (step) next = addDays(day.dataset.key, step);
    else {
      const d = parseDateKey(day.dataset.key);
      d.setMonth(d.getMonth() + pageStep);
      next = dateKey(d);
    }
    const nd = parseDateKey(next);
    if (nd.getMonth() !== month.getMonth() || nd.getFullYear() !== month.getFullYear()) {
      month = new Date(nd.getFullYear(), nd.getMonth(), 1);
    }
    focusKey = next;
    renderPop();
    pop.querySelector(`.dp-day[data-key="${next}"]`)?.focus();
  });

  document.addEventListener("mousedown", (e) => {
    if (isOpen() && !wrap.contains(e.target)) close(false);
  });
  pop.addEventListener("focusout", (e) => {
    if (isOpen() && e.relatedTarget && !wrap.contains(e.relatedTarget)) close(false);
  });

  // Anything that sets the input directly (clearing after submit, tests) shows up here.
  input.addEventListener("input", sync);
  input.addEventListener("change", sync);

  sync();
  return { sync, open, close };
}
