import { store } from "../store.js";
import { $, $$, esc } from "../dom.js";
import { icon } from "../icons.js";
import { uid } from "../lib/id.js";
import { formatShortDate, parseDateKey, todayKey } from "../lib/dates.js";

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
    createdAt: Date.now(),
  });
  store.save();
}

const byId = (id) => store.state.tasks.find((t) => t.id === id);

// ---------------------------------------------------------------- grouping --

function dayOffset(key) {
  const diff = parseDateKey(key) - parseDateKey(todayKey());
  return Math.round(diff / 86400000);
}

/** Which bucket a task falls into, given the current groupBy. */
function bucketOf(task) {
  if (task.done) return "done";

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
};

const BUCKET_ORDER = {
  due: ["overdue", "today", "tomorrow", "week", "later", "none", "done"],
  priority: ["high", "medium", "low", "done"],
  none: ["all", "done"],
};

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

  return BUCKET_ORDER[view.groupBy]
    .filter((k) => buckets[k]?.length)
    .map((k) => ({ key: k, label: BUCKET_LABELS[k], tasks: sortTasks(buckets[k]) }));
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

function taskRow(task) {
  const overdue = !task.done && task.due && task.due < todayKey();
  return (
    `<li class="task-item${task.done ? " done" : ""}${overdue ? " is-overdue" : ""}">` +
    checkbox(task) +
    textCell(task) +
    `<span class="task-props">${dueCell(task)}${priorityCell(task)}</span>` +
    deleteButton(task) +
    "</li>"
  );
}

function taskCard(task) {
  return (
    `<li class="board-card${task.done ? " done" : ""}">` +
    `<div class="board-card-top">${checkbox(task)}${textCell(task)}</div>` +
    `<div class="board-card-foot">${dueCell(task)}${priorityCell(task)}${deleteButton(task)}</div>` +
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

function renderList(groups) {
  const host = $("taskList");

  if (!groups.length) {
    host.innerHTML = `<ul class="task-list"><li class="task-empty">${emptyMessage()}</li></ul>`;
    return;
  }

  host.innerHTML = groups
    .map((g) => {
      const collapsed = view.collapsed.has(g.key);
      return (
        `<section class="task-group g-${esc(g.key)}${collapsed ? " collapsed" : ""}">` +
        groupHead(g, true) +
        `<ul class="task-list">${g.tasks.map(taskRow).join("")}</ul>` +
        "</section>"
      );
    })
    .join("");
}

function renderBoard(groups) {
  const host = $("taskBoard");

  // A board needs columns, so "no grouping" falls back to priority.
  const keys = BUCKET_ORDER[view.groupBy === "none" ? "priority" : view.groupBy];
  const found = Object.fromEntries(groups.map((g) => [g.key, g]));

  const columns = keys
    .filter((k) => k !== "done" || view.filter !== "active")
    .map((k) => found[k] || { key: k, label: BUCKET_LABELS[k], tasks: [] });

  host.innerHTML = columns
    .map(
      (g) =>
        `<section class="board-col g-${esc(g.key)}">` +
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
      store.state.tasks = store.state.tasks.filter((t) => t.id !== id);
      store.save();
      render();
    } else if (action === "edit-task") {
      view.editingId = id;
      render();
    } else if (action === "toggle-group") {
      view.collapsed.has(key) ? view.collapsed.delete(key) : view.collapsed.add(key);
      render();
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

    if (el.dataset.action === "toggle-task") task.done = el.checked;
    else if (el.dataset.action === "set-priority") task.priority = el.value;
    else if (el.dataset.action === "set-due") task.due = el.value || null;
    else return;

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
    const done = store.state.tasks.filter((t) => t.done).length;
    if (!confirm(`Delete ${done} completed task(s)? This cannot be undone.`)) return;
    store.state.tasks = store.state.tasks.filter((t) => !t.done);
    store.save();
    render();
  });

  wireItemEvents($("taskList"));
  wireItemEvents($("taskBoard"));
}
