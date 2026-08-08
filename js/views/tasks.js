import { store } from "../store.js";
import { $, $$, esc } from "../dom.js";
import { icon } from "../icons.js";
import { uid } from "../lib/id.js";
import { formatShortDate, todayKey } from "../lib/dates.js";

let filter = "all";

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
  });
  store.save();
}

export function render() {
  let tasks = store.state.tasks.slice();
  if (filter === "active") tasks = tasks.filter((t) => !t.done);
  if (filter === "done") tasks = tasks.filter((t) => t.done);

  // Open tasks first, then soonest due date, then undated.
  tasks.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return 0;
  });

  const list = $("taskList");

  if (!tasks.length) {
    list.innerHTML = '<li class="task-empty">No tasks here yet.</li>';
    return;
  }

  const today = todayKey();

  list.innerHTML = tasks
    .map((t) => {
      let dueBadge = "";
      if (t.due) {
        const overdue = !t.done && t.due < today;
        dueBadge =
          `<span class="badge ${overdue ? "overdue" : "due"}">` +
          icon(overdue ? "clock" : "calendarSm") +
          (overdue ? "Overdue " : "") +
          esc(formatShortDate(t.due)) +
          "</span>";
      }

      return (
        `<li class="task-item${t.done ? " done" : ""}">` +
        `<input type="checkbox" data-action="toggle-task" data-id="${esc(t.id)}"${t.done ? " checked" : ""} aria-label="${esc(t.text)}">` +
        `<span class="task-text">${esc(t.text)}</span>` +
        dueBadge +
        `<span class="badge priority-${esc(t.priority)}">${esc(t.priority)}</span>` +
        `<button class="icon-btn danger-hover" data-action="delete-task" data-id="${esc(t.id)}" title="Delete task">${icon("trash")}</button>` +
        "</li>"
      );
    })
    .join("");
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
      filter = tab.dataset.filter;
      $$(".filter-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      render();
    });
  });

  // Delegated so the list can be rebuilt wholesale without rebinding.
  const list = $("taskList");

  list.addEventListener("change", (e) => {
    const box = e.target.closest('[data-action="toggle-task"]');
    if (!box) return;
    const task = store.state.tasks.find((t) => t.id === box.dataset.id);
    if (!task) return;
    task.done = box.checked;
    store.save();
    render();
  });

  list.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="delete-task"]');
    if (!btn) return;
    store.state.tasks = store.state.tasks.filter((t) => t.id !== btn.dataset.id);
    store.save();
    render();
  });
}
