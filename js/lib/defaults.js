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
    pages: [{ id: welcomeId, title: "Welcome", content: WELCOME_CONTENT, updatedAt: Date.now() }],
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
      // A single grapheme; anything longer is almost certainly pasted junk.
      emoji: typeof c.emoji === "string" ? [...c.emoji].slice(0, 2).join("") : "",
      days: c.days.filter((d) => typeof d === "number" && d >= 0 && d <= 6),
      start: /^\d{2}:\d{2}$/.test(c.start) ? c.start : "08:00",
      end: /^\d{2}:\d{2}$/.test(c.end) ? c.end : "09:00",
      color: CLASS_COLORS.includes(c.color) ? c.color : CLASS_COLORS[i % CLASS_COLORS.length],
    }));
}

const PRIORITIES = ["low", "medium", "high"];
const STATUS_IDS = ["todo", "progress", "review", "stuck", "hold", "complete"];
const REPEATS = ["daily", "weekly", "monthly"];

function sanitizeTasks(parsed, classIds) {
  if (!Array.isArray(parsed.tasks)) return [];

  return parsed.tasks
    .filter((t) => t && typeof t.text === "string")
    .map((t) => ({
      id: t.id || uid(),
      text: t.text,
      done: Boolean(t.done),
      due: /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : null,
      priority: PRIORITIES.includes(t.priority) ? t.priority : "medium",
      // Backfilled from `done` for tasks saved before Status existed, so the
      // checkbox and the chip agree from the very first render.
      status: STATUS_IDS.includes(t.status) ? t.status : t.done ? "complete" : "todo",
      // Backfilled for tasks saved before ordering was stored, so the list has a
      // stable tiebreak instead of shuffling on every render.
      createdAt: typeof t.createdAt === "number" ? t.createdAt : 0,
      // null means "does not repeat"; a repeat without a due date is meaningless
      // so it is dropped rather than kept as a rule that can never fire.
      repeat: t.due && REPEATS.includes(t.repeat) ? t.repeat : null,
      // Points at a class. A reference to a class that no longer exists is
      // dropped rather than kept as a link that can never resolve.
      subjectId: classIds.has(t.subjectId) ? t.subjectId : null,
    }));
}

function sanitizeChecklists(parsed) {
  if (!Array.isArray(parsed.checklists)) return [];

  return parsed.checklists
    .filter((c) => c && typeof c.name === "string")
    .map((c) => ({
      id: c.id || uid(),
      name: c.name,
      collapsed: Boolean(c.collapsed),
      items: Array.isArray(c.items)
        ? c.items
            .filter((i) => i && typeof i.text === "string")
            .map((i) => ({ id: i.id || uid(), text: i.text, done: Boolean(i.done) }))
        : [],
    }));
}

function sanitizePages(parsed) {
  if (!Array.isArray(parsed.pages)) return null;

  return parsed.pages
    .filter((p) => p && typeof p.id === "string")
    .map((p) => ({
      id: p.id,
      title: typeof p.title === "string" ? p.title : "",
      content: typeof p.content === "string" ? p.content : "",
      updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
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

  const pages = sanitizePages(parsed) || fallback.pages;

  let currentPageId = parsed.currentPageId;
  if (!pages.length) {
    currentPageId = null;
  } else if (!currentPageId || !pages.some((p) => p.id === currentPageId)) {
    currentPageId = pages[0].id;
  }

  // Classes first: tasks reference them, and a dangling reference has to go.
  const classes = sanitizeClasses(parsed);
  const classIds = new Set(classes.map((c) => c.id));

  return {
    tasks: sanitizeTasks(parsed, classIds),
    eventsList: sanitizeEvents(parsed),
    checklists: sanitizeChecklists(parsed),
    classes,
    pages,
    currentPageId,
  };
}
