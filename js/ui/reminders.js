import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { icon } from "../icons.js";
import * as modal from "./modal.js";
import { closeNav, isMobile } from "./nav.js";
import { todayKey } from "../lib/dates.js";
import { classesOnDay, formatTime, minutesUntil, toMinutes } from "../lib/schedule.js";

/* Reminders: a heads-up before each class, and one summary a day of what is due.

   Motion has no server, so nothing can wake it up from outside: reminders are
   checked by the page itself, every 20 seconds and whenever it regains focus.
   They therefore fire while Motion is open — in a tab, or as an installed app
   in the background — and the settings dialog says so plainly.

   Delivery depends on whether anyone is looking. A visible page gets an in-app
   toast (a system notification on top of the app you are already using is just
   noise); a hidden one gets a system notification if permission was granted,
   and otherwise the toast, which is waiting when the user comes back.

   Settings and the "already fired" log are per-device, like the theme, so they
   live in localStorage rather than in the workspace or its backups. */

const E2E = new URLSearchParams(window.location.search).has("e2e");
const SETTINGS_KEY = "motionReminders" + (E2E ? "_e2e" : "");
const FIRED_KEY = "motionRemindersFired" + (E2E ? "_e2e" : "");

const OVERLAY = "reminderOverlay";
const CHECK_EVERY_MS = 20000;
const TOAST_MS = 15000;
const MAX_TOASTS = 3;
const LEADS = [0, 5, 10, 15, 30];

const DEFAULTS = { enabled: false, classLead: 10, digest: true, digestTime: "08:00" };

// ---------------------------------------------------------------- storage --

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full storage: settings just will not persist */
  }
}

export function loadSettings() {
  const raw = readJson(SETTINGS_KEY) || {};
  return {
    enabled: Boolean(raw.enabled),
    classLead: LEADS.includes(raw.classLead) ? raw.classLead : DEFAULTS.classLead,
    digest: typeof raw.digest === "boolean" ? raw.digest : DEFAULTS.digest,
    digestTime: /^\d{2}:\d{2}$/.test(raw.digestTime) ? raw.digestTime : DEFAULTS.digestTime,
  };
}

function saveSettings(settings) {
  writeJson(SETTINGS_KEY, settings);
}

/** Keys of reminders already sent today; resets itself when the date changes. */
function firedToday() {
  const raw = readJson(FIRED_KEY);
  const today = todayKey();
  return raw && raw.date === today && Array.isArray(raw.keys) ? new Set(raw.keys) : new Set();
}

function markFired(fired, key) {
  fired.add(key);
  writeJson(FIRED_KEY, { date: todayKey(), keys: [...fired] });
}

// ------------------------------------------------------------- permission --

const supported = () => typeof window.Notification === "function";

/** "unsupported" | "default" | "granted" | "denied" */
export const permission = () => (supported() ? Notification.permission : "unsupported");

async function requestPermission() {
  if (permission() !== "default") return permission();
  try {
    return await Notification.requestPermission();
  } catch {
    return permission();
  }
}

// --------------------------------------------------------------- delivery --

function dismissToast(el) {
  if (!el?.isConnected) return;
  clearTimeout(el._timer);
  el.remove();
}

function showToast({ title, body, hash }) {
  const stack = $("reminderStack");
  const el = document.createElement("div");
  el.className = "reminder-toast";
  el.setAttribute("role", "status");
  el.innerHTML =
    `<span class="reminder-icon">${icon("bell")}</span>` +
    '<div class="reminder-body">' +
    `<div class="reminder-title">${esc(title)}</div>` +
    (body ? `<div class="reminder-text">${esc(body)}</div>` : "") +
    "</div>" +
    (hash ? '<button class="reminder-view" data-action="view">View</button>' : "") +
    `<button class="reminder-close" data-action="close" aria-label="Dismiss">${icon("close")}</button>`;

  el.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "view") window.location.hash = hash;
    if (action) dismissToast(el);
  });

  stack.prepend(el);
  [...stack.children].slice(MAX_TOASTS).forEach(dismissToast);
  el._timer = setTimeout(() => dismissToast(el), TOAST_MS);
}

async function showSystem({ title, body, hash, tag }) {
  const options = { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { hash } };

  // Through the service worker where there is one: it is the only way that
  // works on Android, and its notificationclick handler can focus the app.
  const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => null);
  if (reg?.showNotification) {
    await reg.showNotification(title, options);
    return;
  }

  const n = new Notification(title, options);
  n.onclick = () => {
    window.focus();
    if (hash) window.location.hash = hash;
    n.close();
  };
}

/** @param {{title, body, hash?, tag?}} reminder */
export async function deliver(reminder, { forceSystem = false } = {}) {
  const canSystem = permission() === "granted";
  const visible = document.visibilityState === "visible";

  if (canSystem && (forceSystem || !visible)) {
    try {
      await showSystem(reminder);
      if (!forceSystem) return;
    } catch {
      /* fall through to the toast */
    }
  }
  showToast(reminder);
}

// ------------------------------------------------------------------ rules --

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** The once-a-day summary, or null when there is nothing worth saying. */
export function dailySummary(now = new Date()) {
  const today = todayKey();
  const open = store.state.tasks.filter((t) => !t.done && t.due);
  const dueToday = open.filter((t) => t.due === today);
  const overdue = open.filter((t) => t.due < today);
  const classes = classesOnDay(store.state.classes, now.getDay());
  const events = store.state.eventsList.filter((e) => e.dates.includes(today));

  const parts = [];
  if (dueToday.length) parts.push(`${plural(dueToday.length, "task")} due today`);
  if (overdue.length) parts.push(`${overdue.length} overdue`);
  if (classes.length) parts.push(plural(classes.length, "class", "classes"));
  if (events.length) parts.push(events.length === 1 ? `Event: ${events[0].title}` : plural(events.length, "event"));
  if (!parts.length) return null;

  const first = dueToday[0] || overdue[0];
  return {
    title: "Your day in Motion",
    body: parts.join(" · ") + (first ? `\nFirst up: ${first.text}` : ""),
    hash: "#/dashboard",
    tag: `motion-digest-${today}`,
  };
}

/** Runs every rule once. Safe to call as often as you like. */
export function check(now = new Date()) {
  const settings = loadSettings();
  if (!settings.enabled) return;

  const fired = firedToday();
  const mins = now.getHours() * 60 + now.getMinutes();

  if (settings.classLead > 0) {
    classesOnDay(store.state.classes, now.getDay()).forEach((c) => {
      const left = minutesUntil(c, mins);
      const key = `class:${c.id}:${c.start}`;
      if (left <= 0 || left > settings.classLead || fired.has(key)) return;

      markFired(fired, key);
      deliver({
        title: `${c.emoji ? c.emoji + " " : ""}${c.subject} starts in ${plural(left, "minute")}`,
        body: `${formatTime(c.start)}${c.room ? ` · ${c.room}` : ""}`,
        hash: "#/schedule",
        tag: `motion-class-${c.id}`,
      });
    });
  }

  if (settings.digest && mins >= toMinutes(settings.digestTime) && !fired.has("digest")) {
    // Marked even when empty, so a quiet day is not re-checked every 20 seconds.
    markFired(fired, "digest");
    const summary = dailySummary(now);
    if (summary) deliver(summary);
  }
}

// --------------------------------------------------------------- settings --

const PERMISSION_TEXT = {
  unsupported: "This browser can’t show system notifications, so reminders appear inside Motion.",
  default: "Motion will ask your browser for permission to show notifications.",
  granted: "System notifications are allowed — you’ll get them while Motion is in the background.",
  denied: "Notifications are blocked for this site, so reminders appear inside Motion only. You can allow them in your browser’s site settings.",
};

function setSwitch(el, on) {
  el.setAttribute("aria-checked", on ? "true" : "false");
}

function paintSettings() {
  const s = loadSettings();
  setSwitch($("remEnabled"), s.enabled);
  setSwitch($("remDigest"), s.digest);
  $("remClassLead").value = String(s.classLead);
  $("remDigestTime").value = s.digestTime;
  $("remPermission").textContent = s.enabled ? PERMISSION_TEXT[permission()] : "Off — nothing will be sent.";
  $("remOptions").classList.toggle("is-disabled", !s.enabled);
  $("remOptions").querySelectorAll("select, input, button").forEach((el) => {
    el.disabled = !s.enabled;
  });
  $("remDigestTimeRow").classList.toggle("hidden", !s.digest);

  const footBtn = $("remindersBtn");
  footBtn.classList.toggle("is-on", s.enabled);
  footBtn.setAttribute("title", s.enabled ? "Reminders are on" : "Reminders are off");
}

function update(patch) {
  saveSettings({ ...loadSettings(), ...patch });
  paintSettings();
  check();
}

export const isReminderSettingsOpen = () => modal.isOpen(OVERLAY);

export function openReminderSettings() {
  // From the phone drawer, the drawer would otherwise stay open behind the sheet.
  if (isMobile()) closeNav();
  paintSettings();
  modal.open(OVERLAY, "remEnabled");
}

export function closeReminderSettings() {
  modal.close(OVERLAY);
}

export function mount() {
  $("remindersBtn").addEventListener("click", openReminderSettings);
  $("remDoneBtn").addEventListener("click", closeReminderSettings);

  $("remEnabled").addEventListener("click", async () => {
    const turningOn = !loadSettings().enabled;
    // Asked here, on a click, because browsers ignore a permission prompt that
    // is not the direct result of something the user did.
    if (turningOn) await requestPermission();
    update({ enabled: turningOn });
  });

  $("remDigest").addEventListener("click", () => update({ digest: !loadSettings().digest }));
  $("remClassLead").addEventListener("change", (e) => update({ classLead: Number(e.target.value) }));
  $("remDigestTime").addEventListener("change", (e) => {
    if (/^\d{2}:\d{2}$/.test(e.target.value)) update({ digestTime: e.target.value });
  });

  $("remTestBtn").addEventListener("click", () =>
    deliver(
      { title: "Test reminder", body: "This is how Motion reminders will look.", hash: "", tag: "motion-test" },
      { forceSystem: true }
    )
  );

  // A notification clicked while the app was open in another tab: the service
  // worker focuses this window and passes the route along.
  navigator.serviceWorker?.addEventListener?.("message", (e) => {
    if (e.data?.type === "open-route" && typeof e.data.hash === "string") window.location.hash = e.data.hash;
  });

  paintSettings();
  window.addEventListener("focus", () => check());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  setInterval(check, CHECK_EVERY_MS);
  check();
}
