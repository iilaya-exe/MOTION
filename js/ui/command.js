import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { icon } from "../icons.js";
import * as modal from "./modal.js";
import * as nav from "./nav.js";
import * as router from "./router.js";
import * as undo from "./undo.js";
import { exportData } from "./backup.js";
import { openReminderSettings } from "./reminders.js";
import { addTask, toggleTaskDone } from "../views/tasks.js";
import { createPage } from "../views/notes.js";
import { createChecklist } from "../views/checklists.js";
import { openEditClass, openNewClass } from "../modals/class-editor.js";
import { openEditEvent, openNewEvent } from "../modals/event-editor.js";
import { printNote } from "../lib/note-print.js";
import { formatShortDate, overdueLabel, daysFromToday } from "../lib/dates.js";
import { colorClass, formatTime } from "../lib/schedule.js";

/* Command palette (⌘K / Ctrl+K), after shadcn's Command menu.

   One search box over the whole workspace. It is rebuilt from store.state on
   every keystroke rather than indexed: the data is small, local and already in
   memory, so a filter over it is instant and can never go stale.

   Each item is { id, group, label, hint?, iconName, keywords?, run }. `run`
   happens after the palette has closed, so whatever it opens (a dialog, a view)
   receives focus normally. */

const OVERLAY = "cmdkOverlay";
const PER_GROUP = 6;

const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const SHORTCUT_LABEL = IS_MAC ? "⌘K" : "Ctrl K";

let items = [];
let activeIndex = 0;

export const isCommandOpen = () => modal.isOpen(OVERLAY);

const currentView = () => router.parseHash().view;

/** Re-renders whatever view is showing, after a palette action changed data. */
const refresh = () => nav.switchView(currentView());

function goTo(view) {
  if (!router.go(view)) nav.switchView(view);
}

const plainText = (html) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");

/**
 * How well `query` matches `text`: 3 for a prefix, 2 for the start of a word,
 * 1 anywhere, 0 for no match. Cheap, predictable and good enough for names.
 */
function score(text, query) {
  const hay = String(text || "").toLowerCase();
  const i = hay.indexOf(query);
  if (i === -1) return 0;
  if (i === 0) return 3;
  return /[\s\-_/(]/.test(hay[i - 1]) ? 2 : 1;
}

// ----------------------------------------------------------------- sources --

function actionItems(q) {
  const quoted = q ? ` “${q}”` : "";
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const collapsed = nav.isSidebarCollapsed();
  const page = store.state.pages.find((p) => p.id === store.state.currentPageId);

  const list = [
    {
      id: "new-task",
      label: q ? `Add task${quoted}` : "New task",
      iconName: "plus",
      keywords: "create add todo",
      always: true,
      run: () => {
        if (!q) {
          goTo("tasks");
          $("taskTextInput").focus();
          return;
        }
        addTask(q);
        const task = store.state.tasks[store.state.tasks.length - 1];
        refresh();
        undo.offer(`Added "${task.text}"`, () => {
          store.state.tasks = store.state.tasks.filter((t) => t.id !== task.id);
          store.save();
          refresh();
        });
      },
    },
    {
      id: "new-note",
      label: q ? `New note${quoted}` : "New note",
      iconName: "page",
      keywords: "create page document write",
      always: true,
      run: () => {
        createPage(q);
        $(q ? "pageContent" : "pageTitleInput").focus();
      },
    },
    {
      id: "new-checklist",
      label: q ? `New checklist${quoted}` : "New checklist",
      iconName: "checklist",
      keywords: "create list",
      always: true,
      run: () => {
        goTo("checklists");
        if (q) createChecklist(q);
        else $("newChecklistInput").focus();
      },
    },
    {
      id: "new-event",
      label: q ? `New event${quoted}` : "New event",
      iconName: "calendarSm",
      keywords: "create calendar date",
      always: true,
      run: () => {
        openNewEvent(null);
        if (q) $("eventTitleInput").value = q;
      },
    },
    {
      id: "new-class",
      label: q ? `Add class${quoted}` : "Add class",
      iconName: "book",
      keywords: "create subject schedule timetable",
      always: true,
      run: () => {
        goTo("schedule");
        openNewClass(new Date().getDay());
        if (q) $("classSubjectInput").value = q;
      },
    },
    {
      id: "theme",
      label: dark ? "Switch to light mode" : "Switch to dark mode",
      iconName: dark ? "sun" : "moon",
      keywords: "theme appearance dark light colour color",
      run: () => $("themeToggle").click(),
    },
    {
      id: "sidebar",
      label: collapsed ? "Expand sidebar" : "Collapse sidebar",
      iconName: "sidebar",
      keywords: "hide show navigation rail",
      hint: IS_MAC ? "⌘B" : "Ctrl B",
      hidden: nav.isMobile(),
      run: () => nav.setSidebarCollapsed(!collapsed),
    },
    {
      id: "reminders",
      label: "Reminder settings",
      iconName: "bell",
      keywords: "notifications alerts notify alarm",
      run: openReminderSettings,
    },
    {
      id: "export",
      label: "Export backup",
      iconName: "download",
      keywords: "download save json backup",
      run: exportData,
    },
    {
      id: "print",
      label: "Export note as PDF",
      iconName: "printer",
      keywords: "print pdf",
      hidden: currentView() !== "notes" || !page,
      run: () => printNote(page),
    },
  ];

  return list.filter((it) => !it.hidden);
}

const NAV = [
  ["dashboard", "Home", "home"],
  ["tasks", "Tasks", "checkSquare"],
  ["calendar", "Calendar", "calendarSm"],
  ["schedule", "Schedule", "clock"],
  ["checklists", "Checklists", "checklist"],
];

function navItems() {
  return NAV.map(([view, label, iconName]) => ({
    id: `go-${view}`,
    label: `Go to ${label}`,
    match: label,
    iconName,
    hint: currentView() === view ? "Current" : "",
    run: () => goTo(view),
  }));
}

function taskHint(t) {
  if (!t.due) return "";
  const offset = daysFromToday(t.due);
  if (offset < 0) return overdueLabel(t.due);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return formatShortDate(t.due);
}

function taskItems() {
  // Open tasks, soonest first, so the empty palette shows what is coming up.
  return store.state.tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"))
    .map((t) => ({
      id: `task-${t.id}`,
      label: t.text,
      hint: taskHint(t),
      hintTone: t.due && daysFromToday(t.due) < 0 ? "danger" : "",
      iconName: "circle",
      action: "Complete",
      run: () => {
        toggleTaskDone(t.id, true);
        refresh();
        undo.offer(`Completed "${t.text}"`, () => {
          toggleTaskDone(t.id, false);
          refresh();
        });
      },
    }));
}

function noteItems() {
  return [...store.state.pages]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({
      id: `note-${p.id}`,
      label: p.title || "Untitled",
      keywords: plainText(p.content),
      iconName: "page",
      run: () => {
        store.state.currentPageId = p.id;
        store.save();
        if (!router.go("notes", p.id)) nav.switchView("notes");
      },
    }));
}

function classItems() {
  return store.state.classes.map((c) => ({
    id: `class-${c.id}`,
    label: c.subject,
    keywords: `${c.section} ${c.room}`,
    hint: formatTime(c.start),
    emoji: c.emoji,
    colorClass: colorClass(c),
    iconName: "book",
    run: () => {
      goTo("schedule");
      openEditClass(c.id);
    },
  }));
}

function checklistItems() {
  return store.state.checklists.map((cl) => {
    const done = cl.items.filter((i) => i.done).length;
    return {
      id: `cl-${cl.id}`,
      label: cl.name,
      keywords: cl.items.map((i) => i.text).join(" "),
      hint: cl.items.length ? `${done}/${cl.items.length}` : "",
      iconName: "checklist",
      run: () => {
        goTo("checklists");
        const search = $("checklistSearch");
        search.value = cl.name;
        search.dispatchEvent(new Event("input", { bubbles: true }));
      },
    };
  });
}

function eventItems() {
  return store.state.eventsList.map((ev) => {
    const first = [...ev.dates].sort()[0];
    return {
      id: `event-${ev.id}`,
      label: ev.title,
      hint: first ? formatShortDate(first) : "",
      iconName: "calendarSm",
      run: () => openEditEvent(ev.id),
    };
  });
}

/** A name match always outranks one found only in the body or keywords. */
const rank = (it, q) => Math.max(score(it.match || it.label, q) * 2, score(it.keywords, q));

/** Ranks a source against the query and keeps the best few, scores attached. */
function pick(source, q, limit = PER_GROUP) {
  if (!q) return source.slice(0, limit);

  return source
    .map((it) => ({ ...it, rank: rank(it, q) }))
    .filter((it) => it.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
}

/** Everything to show for a query, grouped, in display order. */
export function buildItems(rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  const display = rawQuery.trim();

  // With a query, the create actions always stay offered (that is how you make
  // something new from here); the rest of the actions filter like anything else.
  const actions = actionItems(display);
  const shownActions = q
    ? [...pick(actions.filter((a) => !a.always), q), ...actions.filter((a) => a.always)]
    : actions;

  let groups = [
    ["Tasks", pick(taskItems(), q, q ? PER_GROUP : 4)],
    ["Notes", pick(noteItems(), q, q ? PER_GROUP : 3)],
    ["Classes", q ? pick(classItems(), q) : []],
    ["Checklists", q ? pick(checklistItems(), q) : []],
    ["Events", q ? pick(eventItems(), q) : []],
    ["Go to", pick(navItems(), q)],
    ["Actions", shownActions],
  ];

  if (q) {
    // Groups are ordered by their best match, so "calend" puts Go to Calendar
    // above a note that merely mentions the calendar. Ties keep the order above;
    // the create actions carry no rank and so sink to the bottom.
    const best = (list) => Math.max(0, ...list.map((it) => it.rank || 0));
    groups = groups
      .map((g, i) => ({ g, i, best: best(g[1]) }))
      .sort((a, b) => b.best - a.best || a.i - b.i)
      .map(({ g }) => g);
  } else {
    // An empty query leads with actions: that is what an empty palette is for.
    groups.unshift(groups.pop());
  }

  return groups.flatMap(([group, list]) => list.map((it) => ({ ...it, group })));
}

// ------------------------------------------------------------------ render --

function itemIcon(it) {
  if (it.emoji) return `<span class="cmdk-emoji ${it.colorClass || ""}">${esc(it.emoji)}</span>`;
  if (it.colorClass) return `<span class="cmdk-swatch ${it.colorClass}"></span>`;
  return icon(it.iconName);
}

function render() {
  const query = $("cmdkInput").value;
  items = buildItems(query);
  activeIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));

  const list = $("cmdkList");
  if (!items.length) {
    list.innerHTML = '<div class="cmdk-empty">No results found.</div>';
    $("cmdkInput").removeAttribute("aria-activedescendant");
    return;
  }

  let html = "";
  let group = null;
  items.forEach((it, i) => {
    if (it.group !== group) {
      if (group !== null) html += "</div>";
      group = it.group;
      html += `<div class="cmdk-group" role="group" aria-label="${esc(group)}"><div class="cmdk-heading">${esc(group)}</div>`;
    }
    const hint = it.hint
      ? `<span class="cmdk-hint${it.hintTone ? ` is-${it.hintTone}` : ""}">${esc(it.hint)}</span>`
      : "";
    const action = it.action ? `<span class="cmdk-action">${esc(it.action)} ↵</span>` : "";
    html +=
      `<div class="cmdk-item" role="option" id="cmdk-opt-${i}" data-index="${i}" aria-selected="${i === activeIndex}">` +
      `${itemIcon(it)}<span class="cmdk-label">${esc(it.label)}</span>${hint}${action}</div>`;
  });
  list.innerHTML = html + "</div>";

  $("cmdkInput").setAttribute("aria-activedescendant", `cmdk-opt-${activeIndex}`);
}

function setActive(i) {
  if (!items.length) return;
  activeIndex = (i + items.length) % items.length;

  const list = $("cmdkList");
  list.querySelectorAll('.cmdk-item[aria-selected="true"]').forEach((el) => el.setAttribute("aria-selected", "false"));
  const el = list.querySelector(`[data-index="${activeIndex}"]`);
  el?.setAttribute("aria-selected", "true");
  el?.scrollIntoView({ block: "nearest" });
  $("cmdkInput").setAttribute("aria-activedescendant", `cmdk-opt-${activeIndex}`);
}

function runItem(i) {
  const it = items[i];
  if (!it) return;
  closeCommand();
  if (nav.isMobile()) nav.closeNav();
  it.run();
}

// -------------------------------------------------------------- open/close --

export function openCommand() {
  if (isCommandOpen()) return;
  const input = $("cmdkInput");
  input.value = "";
  activeIndex = 0;
  render();
  modal.open(OVERLAY, "cmdkInput");
  input.setAttribute("aria-expanded", "true");
}

export function closeCommand() {
  if (!isCommandOpen()) return;
  modal.close(OVERLAY);
  $("cmdkInput").setAttribute("aria-expanded", "false");
}

export function mount() {
  document.querySelectorAll("[data-shortcut=cmdk]").forEach((el) => {
    el.textContent = SHORTCUT_LABEL;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    // Works from anywhere, including inside a text field or the note editor —
    // the shortcut is only useful if it never has to be "got out of" first.
    e.preventDefault();
    if (isCommandOpen()) closeCommand();
    else openCommand();
  });

  document.querySelectorAll("[data-open=cmdk]").forEach((btn) => {
    btn.addEventListener("click", openCommand);
  });

  const input = $("cmdkInput");
  input.addEventListener("input", () => {
    activeIndex = 0;
    render();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(activeIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex - 1);
    } else if (e.key === "Home" && !input.value) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && !input.value) {
      e.preventDefault();
      setActive(items.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(activeIndex);
    }
  });

  const list = $("cmdkList");
  list.addEventListener("mousemove", (e) => {
    const el = e.target.closest(".cmdk-item");
    if (el && Number(el.dataset.index) !== activeIndex) setActive(Number(el.dataset.index));
  });
  // mousedown, not click: keeps focus in the input so the list never blurs it.
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const el = e.target.closest(".cmdk-item");
    if (el) runItem(Number(el.dataset.index));
  });

  // Clicking the dimmed backdrop (not the panel) closes, like shadcn's Dialog.
  $(OVERLAY).addEventListener("mousedown", (e) => {
    if (e.target === e.currentTarget) closeCommand();
  });
}
