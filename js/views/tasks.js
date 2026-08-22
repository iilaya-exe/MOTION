import { store } from "../store.js";
import { $, $$, esc } from "../dom.js";
import { icon } from "../icons.js";
import { uid } from "../lib/id.js";
import * as undo from "../ui/undo.js";
import { advanceDateKey, formatShortDate, parseDateKey, todayKey } from "../lib/dates.js";
import { colorClass } from "../lib/schedule.js";

/* View state. Deliberately not persisted: filters and grouping are how you are
   looking at the list right now, not part of the workspace. */
const view = {
  filter: "all",
  search: "",
  groupBy: "due",
  mode: "list",
  editingId: null,
  collapsed: new Set(),
};

const PRIORITIES = ["low", "medium", "high"];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

/* Mirrors the Status column of a Notion database. `complete` is kept in sync
   with the checkbox both ways, so the two can never disagree. */
export const STATUSES = [
  { id: "todo", label: "To do" },
  { id: "progress", label: "In progress" },
  { id: "review", label: "In review" },
  { id: "stuck", label: "Stuck" },
  { id: "hold", label: "On hold" },
  { id: "complete", label: "Complete" },
];

const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label || "To do";

export const REPEATS = [
  { id: "", label: "Once" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

const repeatLabel = (id) => REPEATS.find((r) => r.id === (id || ""))?.label || "Once";

/** Shared with the dashboard's quick-add box. */
export function addTask(text, due, priority) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;

  store.state.tasks.push({
    id: uid(),
    text: trimmed,
    done: false,
    due: due || null,
    priority: priority || "medium",
    status: "todo",
    repeat: null,
    subjectId: null,
    createdAt: Date.now(),
  });
  store.save();
}

const byId = (id) => store.state.tasks.find((t) => t.id === id);

/**
 * Completing a task, wherever it is ticked from. Exported so the Today timeline
 * shares this exact behaviour instead of reimplementing the repeat rollover and
 * the status coupling.
 *
 * @returns {boolean} true if anything changed
 */
export function toggleTaskDone(id, checked) {
  const task = byId(id);
  if (!task) return false;

  // A repeating task is never "finished" — completing it rolls the due date
  // forward to the next occurrence and leaves it open.
  if (checked && task.repeat && task.due) {
    task.due = advanceDateKey(task.due, task.repeat);
    task.done = false;
    task.status = "todo";
  } else {
    task.done = checked;
    // Keep Status honest: ticking completes it, unticking sends a previously
    // complete task back to To do but leaves any other status alone.
    if (checked) task.status = "complete";
    else if (task.status === "complete") task.status = "todo";
  }

  store.save();
  return true;
}

// ---------------------------------------------------------------- grouping --

function dayOffset(key) {
  const diff = parseDateKey(key) - parseDateKey(todayKey());
  return Math.round(diff / 86400000);
}

/** Which bucket a task falls into, given the current groupBy. */
function bucketOf(task) {
  // Grouping by status uses the task's own status, including "complete" — a
  // separate Completed bucket would duplicate it.
  if (view.groupBy === "status") return task.status;
  if (task.done) return "done";

  if (view.groupBy === "subject") return task.subjectId || "nosubject";

  if (view.groupBy === "priority") return task.priority;
  if (view.groupBy === "none") return "all";

  if (!task.due) return "none";
  const offset = dayOffset(task.due);
  if (offset < 0) return "overdue";
  if (offset === 0) return "today";
  if (offset === 1) return "tomorrow";
  if (offset <= 7) return "week";
  return "later";
}

const BUCKET_LABELS = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Next 7 days",
  later: "Later",
  none: "No date",
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
  all: "All tasks",
  done: "Completed",
  ...Object.fromEntries(STATUSES.map((st) => [st.id, st.label])),
};

const BUCKET_ORDER = {
  due: ["overdue", "today", "tomorrow", "week", "later", "none", "done"],
  priority: ["high", "medium", "low", "done"],
  status: STATUSES.map((st) => st.id),
  none: ["all", "done"],
};

const classById = (id) => store.state.classes.find((c) => c.id === id) || null;

const classLabel = (c) => c.subject + (c.section ? ` (${c.section})` : "");

/** Subject buckets are whatever classes exist right now, so they are built per render. */
function bucketOrder() {
  if (view.groupBy !== "subject") return BUCKET_ORDER[view.groupBy];
  return [...store.state.classes.map((c) => c.id), "nosubject", "done"];
}

function bucketLabel(key) {
  const c = classById(key);
  if (c) return classLabel(c);
  if (key === "nosubject") return "No subject";
  return BUCKET_LABELS[key];
}

function visibleTasks() {
  const needle = view.search.trim().toLowerCase();

  return store.state.tasks.filter((t) => {
    if (view.filter === "active" && t.done) return false;
    if (view.filter === "done" && !t.done) return false;
    if (needle && !t.text.toLowerCase().includes(needle)) return false;
    return true;
  });
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
    if (a.due !== b.due) return a.due ? -1 : 1;
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p) return p;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

/** @returns {{key,label,tasks}[]} in display order, empty groups dropped */
function buildGroups() {
  const tasks = visibleTasks();
  const buckets = {};
  tasks.forEach((t) => {
    const k = bucketOf(t);
    (buckets[k] ||= []).push(t);
  });

  return bucketOrder()
    .filter((k) => buckets[k]?.length)
    .map((k) => ({
      key: k,
      label: bucketLabel(k),
      // Subject groups borrow the class colour so the dot matches the timetable.
      tone: classById(k) ? colorClass(classById(k)) : `g-${k}`,
      tasks: sortTasks(buckets[k]),
    }));
}

// ----------------------------------------------------------------- markup --

/** A chip with the real control laid invisibly over it (see tasks.css). */
function dueCell(task) {
  const overdue = !task.done && task.due && task.due < todayKey();

  const chip = task.due
    ? `<span class="badge ${overdue ? "overdue" : "due"}">` +
      icon(overdue ? "clock" : "calendarSm") +
      `${overdue ? "Overdue " : ""}${esc(formatShortDate(task.due))}</span>`
    : `<span class="badge ghost">${icon("calendarSm")}Date</span>`;

  return (
    `<span class="prop-cell">${chip}` +
    `<input type="date" class="prop-input" data-action="set-due" data-id="${esc(task.id)}" ` +
    `value="${esc(task.due || "")}" aria-label="Due date for ${esc(task.text)}"></span>`
  );
}

function priorityCell(task) {
  const options = PRIORITIES.map(
    (p) => `<option value="${p}"${p === task.priority ? " selected" : ""}>${p}</option>`
  ).join("");

  return (
    `<span class="prop-cell">` +
    `<span class="badge priority-${esc(task.priority)}">${esc(task.priority)}</span>` +
    `<select class="prop-input" data-action="set-priority" data-id="${esc(task.id)}" ` +
    `aria-label="Priority for ${esc(task.text)}">${options}</select></span>`
  );
}

function statusCell(task) {
  const options = STATUSES.map(
    (st) => `<option value="${st.id}"${st.id === task.status ? " selected" : ""}>${st.label}</option>`
  ).join("");

  return (
    `<span class="prop-cell">` +
    `<span class="badge status-${esc(task.status)}">${esc(statusLabel(task.status))}</span>` +
    `<select class="prop-input" data-action="set-status" data-id="${esc(task.id)}" ` +
    `aria-label="Status for ${esc(task.text)}">${options}</select></span>`
  );
}

function repeatCell(task) {
  const options = REPEATS.map(
    (r) => `<option value="${r.id}"${r.id === (task.repeat || "") ? " selected" : ""}>${r.label}</option>`
  ).join("");

  const chip = task.repeat
    ? `<span class="badge repeat-on">${icon("repeat")}${esc(repeatLabel(task.repeat))}</span>`
    : `<span class="badge ghost">${icon("repeat")}Once</span>`;

  return (
    `<span class="prop-cell">${chip}` +
    `<select class="prop-input" data-action="set-repeat" data-id="${esc(task.id)}" ` +
    `aria-label="Repeat for ${esc(task.text)}">${options}</select></span>`
  );
}

function subjectCell(task) {
  const classes = store.state.classes;
  const current = classById(task.subjectId);

  const options =
    '<option value="">No subject</option>' +
    classes
      .map(
        (c) =>
          `<option value="${esc(c.id)}"${c.id === task.subjectId ? " selected" : ""}>${esc(classLabel(c))}</option>`
      )
      .join("");

  const chip = current
    ? `<span class="badge subject-chip ${colorClass(current)}"><span class="subject-dot"></span>${esc(current.subject)}</span>`
    : `<span class="badge ghost">${icon("book")}Subject</span>`;

  // With no classes yet there is nothing to pick, so the chip is inert.
  if (!classes.length) {
    return `<span class="prop-cell"><span class="badge ghost" title="Add a class in Schedule first">${icon("book")}Subject</span></span>`;
  }

  return (
    `<span class="prop-cell">${chip}` +
    `<select class="prop-input" data-action="set-subject" data-id="${esc(task.id)}" ` +
    `aria-label="Subject for ${esc(task.text)}">${options}</select></span>`
  );
}

function textCell(task) {
  if (view.editingId === task.id) {
    return `<input class="task-edit" data-action="commit-edit" data-id="${esc(task.id)}" value="${esc(task.text)}">`;
  }
  return `<span class="task-text" data-action="edit-task" data-id="${esc(task.id)}">${esc(task.text)}</span>`;
}

function checkbox(task) {
  return (
    `<input type="checkbox" data-action="toggle-task" data-id="${esc(task.id)}"` +
    `${task.done ? " checked" : ""} aria-label="${esc(task.text)}">`
  );
}

function deleteButton(task) {
  return (
    `<button class="icon-btn danger-hover" data-action="delete-task" data-id="${esc(task.id)}" ` +
    `title="Delete task" aria-label="Delete ${esc(task.text)}">${icon("trash")}</button>`
  );
}

/** State drives the row's visual treatment; see the st-* rules in tasks.css. */
const rowState = (task) =>
  task.done ? "done" : task.status === "todo" ? "pending" : `active st-${task.status}`;

function taskRow(task) {
  const overdue = !task.done && task.due && task.due < todayKey();
  return (
    `<li class="task-row ${rowState(task)} p-${esc(task.priority)}${overdue ? " is-overdue" : ""}">` +
    `<div class="cell-name">${checkbox(task)}${textCell(task)}</div>` +
    `<div class="cell">${subjectCell(task)}</div>` +
    `<div class="cell">${priorityCell(task)}</div>` +
    `<div class="cell">${dueCell(task)}</div>` +
    `<div class="cell">${repeatCell(task)}</div>` +
    `<div class="cell">${statusCell(task)}</div>` +
    `<div class="cell">${deleteButton(task)}</div>` +
    "</li>"
  );
}

function taskCard(task) {
  return (
    `<li class="board-card ${rowState(task)} p-${esc(task.priority)}">` +
    `<div class="board-card-top">${checkbox(task)}${textCell(task)}</div>` +
    `<div class="board-card-foot">${subjectCell(task)}${dueCell(task)}${priorityCell(task)}${repeatCell(task)}` +
    `${statusCell(task)}${deleteButton(task)}</div>` +
    "</li>"
  );
}

function groupHead(group, collapsible) {
  const head =
    (collapsible ? `${icon("chevronDown", "chev")}` : "") +
    `<span class="group-dot"></span>` +
    `<span class="group-name">${esc(group.label)}</span>` +
    `<span class="group-count">${group.tasks.length}</span>`;

  return collapsible
    ? `<button class="group-head" data-action="toggle-group" data-key="${esc(group.key)}">${head}</button>`
    : `<div class="group-head">${head}</div>`;
}

// ----------------------------------------------------------------- render --

function renderSummary() {
  const all = store.state.tasks;
  const done = all.filter((t) => t.done).length;
  const open = all.length - done;

  if (!all.length) {
    $("taskSummary").innerHTML = "";
    return;
  }

  $("taskSummary").innerHTML =
    `<span><b>${open}</b> open · <b>${done}</b> completed</span>` +
    (done ? '<button class="link-btn" data-action="clear-done">Clear completed</button>' : "");
}

const TABLE_HEAD =
  '<div class="task-head">' +
  '<span class="col-name">Name</span><span>Subject</span><span>Priority</span>' +
  '<span>Date</span><span>Repeat</span><span>Status</span><span></span></div>';

const NEW_ROW =
  `<button class="task-new-row" data-action="focus-composer">${icon("plus")}New</button>`;

function renderList(groups) {
  const body = groups.length
    ? groups
        .map((g) => {
          const collapsed = view.collapsed.has(g.key);
          return (
            `<section class="task-group ${esc(g.tone)}${collapsed ? " collapsed" : ""}">` +
            groupHead(g, true) +
            `<ul class="task-list">${g.tasks.map(taskRow).join("")}</ul>` +
            "</section>"
          );
        })
        .join("")
    : `<div class="task-empty">${emptyMessage()}</div>`;

  $("taskList").innerHTML = `<div class="task-table">${TABLE_HEAD}${body}${NEW_ROW}</div>`;
}

function renderBoard(groups) {
  const host = $("taskBoard");

  // A board needs columns, so "no grouping" falls back to priority.
  const keys =
    view.groupBy === "none" ? BUCKET_ORDER.priority
    : view.groupBy === "subject" ? bucketOrder()
    : BUCKET_ORDER[view.groupBy];
  const found = Object.fromEntries(groups.map((g) => [g.key, g]));

  const columns = keys
    .filter((k) => k !== "done" || view.filter !== "active")
    .map(
      (k) =>
        found[k] || {
          key: k,
          label: bucketLabel(k),
          tone: classById(k) ? colorClass(classById(k)) : `g-${k}`,
          tasks: [],
        }
    );

  host.innerHTML = columns
    .map(
      (g) =>
        `<section class="board-col ${esc(g.tone)}">` +
        `<div class="board-col-head">` +
        `<span class="group-dot"></span><span class="group-name">${esc(g.label)}</span>` +
        `<span class="group-count">${g.tasks.length}</span></div>` +
        (g.tasks.length
          ? `<ul class="board-cards">${g.tasks.map(taskCard).join("")}</ul>`
          : '<div class="board-empty">Nothing here</div>') +
        "</section>"
    )
    .join("");
}

function emptyMessage() {
  if (view.search.trim()) return `No tasks match &ldquo;${esc(view.search.trim())}&rdquo;.`;
  if (view.filter === "done") return "No completed tasks yet.";
  if (view.filter === "active") return "Nothing open — you&rsquo;re all caught up.";
  return "No tasks yet. Add one above to get started.";
}

export function render() {
  const groups = buildGroups();

  renderSummary();
  $("taskList").classList.toggle("hidden", view.mode !== "list");
  $("taskBoard").classList.toggle("hidden", view.mode !== "board");

  if (view.mode === "list") renderList(groups);
  else renderBoard(groups);

  // Re-rendering replaced the node the caret was in, so restore it.
  if (view.editingId) {
    const input = document.querySelector(`.task-edit[data-id="${view.editingId}"]`);
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

// ------------------------------------------------------------------ edits --

function commitEdit(input) {
  const task = byId(input.dataset.id);
  view.editingId = null;
  if (!task) return render();

  const next = input.value.trim();
  if (next && next !== task.text) {
    task.text = next;
    store.save();
  }
  render();
}

/** Delegated handlers, bound once to each container. */
function wireItemEvents(host) {
  host.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;

    const { action, id, key } = el.dataset;

    if (action === "delete-task") {
      const task = byId(id);
      const index = store.state.tasks.indexOf(task);
      if (index === -1) return;

      store.state.tasks.splice(index, 1);
      store.save();
      render();

      undo.offer(`Deleted "${task.text}"`, () => {
        store.state.tasks.splice(index, 0, task);
        store.save();
        render();
      });
    } else if (action === "edit-task") {
      view.editingId = id;
      render();
    } else if (action === "toggle-group") {
      view.collapsed.has(key) ? view.collapsed.delete(key) : view.collapsed.add(key);
      render();
    } else if (action === "focus-composer") {
      $("taskTextInput").focus();
    } else if (action === "set-due") {
      // The invisible input covers the chip; ask the browser for its picker.
      try {
        el.showPicker();
      } catch {
        el.focus();
      }
    }
  });

  host.addEventListener("change", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;

    const task = byId(el.dataset.id);
    if (!task) return;

    if (el.dataset.action === "toggle-task") {
      toggleTaskDone(el.dataset.id, el.checked);
      render();
      return;
    } else if (el.dataset.action === "set-status") {
      task.status = el.value;
      task.done = el.value === "complete";
    } else if (el.dataset.action === "set-priority") {
      task.priority = el.value;
    } else if (el.dataset.action === "set-due") {
      task.due = el.value || null;
      // A repeat rule with nothing to advance would never fire again.
      if (!task.due) task.repeat = null;
    } else if (el.dataset.action === "set-subject") {
      task.subjectId = el.value || null;
    } else if (el.dataset.action === "set-repeat") {
      if (el.value && !task.due) {
        alert("Give the task a date first — a repeat needs somewhere to start.");
        render();
        return;
      }
      task.repeat = el.value || null;
    } else return;

    store.save();
    render();
  });

  host.addEventListener(
    "blur",
    (e) => {
      if (e.target.matches(".task-edit")) commitEdit(e.target);
    },
    true
  );

  host.addEventListener("keydown", (e) => {
    if (!e.target.matches(".task-edit")) return;

    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(e.target);
    } else if (e.key === "Escape") {
      e.preventDefault();
      view.editingId = null;
      render();
    }
  });
}

export function mount() {
  const textEl = $("taskTextInput");
  const dueEl = $("taskDueInput");
  const priEl = $("taskPriorityInput");

  const submit = () => {
    if (!textEl.value.trim()) return;
    addTask(textEl.value, dueEl.value, priEl.value);
    textEl.value = "";
    dueEl.value = "";
    render();
    textEl.focus();
  };

  $("addTaskBtn").addEventListener("click", submit);
  textEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  $$(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      view.filter = tab.dataset.filter;
      $$(".filter-tab").forEach((t) => t.classList.toggle("active", t === tab));
      render();
    });
  });

  $("taskSearch").addEventListener("input", (e) => {
    view.search = e.target.value;
    render();
  });

  $("taskGroupBy").addEventListener("change", (e) => {
    view.groupBy = e.target.value;
    view.collapsed.clear();
    render();
  });

  $("taskViewToggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view-mode]");
    if (!btn) return;
    view.mode = btn.dataset.viewMode;
    $$("#taskViewToggle .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });

  $("taskSummary").addEventListener("click", (e) => {
    if (!e.target.closest('[data-action="clear-done"]')) return;
    const removed = store.state.tasks.filter((t) => t.done);
    if (!removed.length) return;

    const snapshot = [...store.state.tasks];
    store.state.tasks = store.state.tasks.filter((t) => !t.done);
    store.save();
    render();

    undo.offer(`Cleared ${removed.length} completed task${removed.length === 1 ? "" : "s"}`, () => {
      store.state.tasks = snapshot;
      store.save();
      render();
    });
  });

  wireItemEvents($("taskList"));
  wireItemEvents($("taskBoard"));
}
