import { uid } from "./id.js";
import { CLASS_COLORS } from "./schedule.js";

/* The workspace starts empty apart from one welcome note. Classes in particular
   are never seeded: the schedule is personal data, and shipping a real timetable
   in source would publish it to anyone who can read the repo. */

const WELCOME_CONTENT =
  "<h2>Welcome to Motion</h2>" +
  "<p>This is your first note. Click into this text to start typing, or use the toolbar above for headings, bold, italic, lists and dividers.</p>" +
  "<p>Create more pages from the sidebar, and explore <b>Tasks</b>, <b>Calendar</b> and <b>Checklists</b> to get organized.</p>";

export function defaultState() {
  const welcomeId = uid();
  return {
    tasks: [],
    eventsList: [],
    checklists: [],
    classes: [],
    pages: [{ id: welcomeId, title: "Welcome", content: WELCOME_CONTENT }],
    currentPageId: welcomeId,
  };
}

function sanitizeClasses(parsed) {
  if (!Array.isArray(parsed.classes)) return [];

  return parsed.classes
    .filter((c) => c && typeof c.subject === "string" && Array.isArray(c.days))
    .map((c, i) => ({
      id: c.id || uid(),
      subject: c.subject,
      section: typeof c.section === "string" ? c.section : "",
      room: typeof c.room === "string" ? c.room : "",
      days: c.days.filter((d) => typeof d === "number" && d >= 0 && d <= 6),
      start: /^\d{2}:\d{2}$/.test(c.start) ? c.start : "08:00",
      end: /^\d{2}:\d{2}$/.test(c.end) ? c.end : "09:00",
      color: CLASS_COLORS.includes(c.color) ? c.color : CLASS_COLORS[i % CLASS_COLORS.length],
    }));
}

function sanitizeEvents(parsed) {
  if (Array.isArray(parsed.eventsList)) {
    return parsed.eventsList
      .filter((e) => e && typeof e.title === "string" && Array.isArray(e.dates))
      .map((e) => ({
        id: e.id || uid(),
        title: e.title,
        dates: e.dates.filter((d) => typeof d === "string"),
      }));
  }

  // Migrate the old single-date events map: { "YYYY-MM-DD": [{id, text}] }
  if (parsed.events && typeof parsed.events === "object" && !Array.isArray(parsed.events)) {
    const out = [];
    Object.entries(parsed.events).forEach(([key, arr]) => {
      if (!Array.isArray(arr)) return;
      arr.forEach((ev) => {
        if (ev && typeof ev.text === "string") {
          out.push({ id: ev.id || uid(), title: ev.text, dates: [key] });
        }
      });
    });
    return out;
  }

  return [];
}

/** Coerce anything read back from storage into a shape the app can render. */
export function sanitizeState(parsed) {
  const fallback = defaultState();
  if (!parsed || typeof parsed !== "object") return fallback;

  const pages = Array.isArray(parsed.pages) ? parsed.pages : fallback.pages;

  let currentPageId = parsed.currentPageId;
  if (!pages.length) {
    currentPageId = null;
  } else if (!currentPageId || !pages.some((p) => p.id === currentPageId)) {
    currentPageId = pages[0].id;
  }

  return {
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    eventsList: sanitizeEvents(parsed),
    checklists: Array.isArray(parsed.checklists) ? parsed.checklists : [],
    classes: sanitizeClasses(parsed),
    pages,
    currentPageId,
  };
}
