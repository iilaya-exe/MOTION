import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { icon } from "../icons.js";
import { uid } from "../lib/id.js";

/* Transient view state. `collapsed` lives on the checklist itself because a
   folded-away list should stay folded between sessions; search and which row is
   mid-edit do not. */
const view = { search: "", editingChecklist: null, editingItem: null };

const getChecklist = (id) => store.state.checklists.find((c) => c.id === id);
const getItem = (cl, itemId) => cl?.items.find((i) => i.id === itemId);

function visibleChecklists() {
  const needle = view.search.trim().toLowerCase();
  if (!needle) return store.state.checklists;

  // Match on the checklist name or on any item inside it.
  return store.state.checklists.filter(
    (cl) =>
      cl.name.toLowerCase().includes(needle) ||
      cl.items.some((i) => i.text.toLowerCase().includes(needle))
  );
}

// ----------------------------------------------------------------- markup --

function itemRow(cl, item) {
  const text =
    view.editingItem === item.id
      ? `<input class="cl-item-edit" data-action="commit-item" data-cl="${esc(cl.id)}" data-item="${esc(item.id)}" value="${esc(item.text)}">`
      : `<span class="cl-item-text" data-action="edit-item" data-cl="${esc(cl.id)}" data-item="${esc(item.id)}">${esc(item.text)}</span>`;

  return (
    `<li class="${item.done ? "done" : ""}">` +
    `<input type="checkbox" data-action="toggle-item" data-cl="${esc(cl.id)}" data-item="${esc(item.id)}"` +
    `${item.done ? " checked" : ""} aria-label="${esc(item.text)}">` +
    text +
    `<button class="icon-btn danger-hover" data-action="delete-item" data-cl="${esc(cl.id)}" data-item="${esc(item.id)}" ` +
    `title="Delete item" aria-label="Delete ${esc(item.text)}">${icon("close")}</button>` +
    "</li>"
  );
}

function card(cl) {
  const total = cl.items.length;
  const doneCount = cl.items.filter((i) => i.done).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const complete = total > 0 && doneCount === total;

  const title =
    view.editingChecklist === cl.id
      ? `<input class="cl-title-edit" data-action="commit-name" data-cl="${esc(cl.id)}" value="${esc(cl.name)}">`
      : `<div class="cl-title" data-action="rename-checklist" data-cl="${esc(cl.id)}" title="Click to rename">${esc(cl.name)}</div>`;

  const items = total
    ? cl.items.map((i) => itemRow(cl, i)).join("")
    : '<li class="cl-items-empty">No items yet — add the first one below.</li>';

  return (
    `<div class="checklist-card${cl.collapsed ? " collapsed" : ""}${complete ? " is-complete" : ""}" data-cl="${esc(cl.id)}">` +
    '<div class="cl-header">' +
    `<button class="cl-collapse" data-action="toggle-collapse" data-cl="${esc(cl.id)}" ` +
    `aria-expanded="${!cl.collapsed}" aria-label="${cl.collapsed ? "Expand" : "Collapse"} ${esc(cl.name)}">${icon("chevronDown")}</button>` +
    title +
    '<div class="cl-actions">' +
    (doneCount
      ? `<button class="icon-btn" data-action="clear-done" data-cl="${esc(cl.id)}" title="Clear completed items">${icon("broom")}</button>`
      : "") +
    `<button class="icon-btn danger-hover" data-action="delete-checklist" data-cl="${esc(cl.id)}" ` +
    `title="Delete checklist" aria-label="Delete ${esc(cl.name)}">${icon("trash")}</button>` +
    "</div></div>" +
    `<div class="progress-bar"><div class="fill" style="width:${pct}%;"></div></div>` +
    `<div class="cl-meta"><span>${doneCount} of ${total} complete</span><span class="cl-pct">${pct}%</span></div>` +
    '<div class="cl-body">' +
    `<ul class="cl-items">${items}</ul>` +
    '<div class="cl-add-row">' +
    `<input class="field" type="text" data-cl-input="${esc(cl.id)}" placeholder="Add an item...">` +
    `<button class="btn secondary" data-action="add-item" data-cl="${esc(cl.id)}">Add</button>` +
    "</div></div></div>"
  );
}

// ----------------------------------------------------------------- render --

function renderSummary() {
  const lists = store.state.checklists;
  if (!lists.length) {
    $("checklistSummary").innerHTML = "";
    return;
  }

  const items = lists.reduce((n, cl) => n + cl.items.length, 0);
  const done = lists.reduce((n, cl) => n + cl.items.filter((i) => i.done).length, 0);

  $("checklistSummary").innerHTML =
    `<span><b>${lists.length}</b> checklist${lists.length === 1 ? "" : "s"} · ` +
    `<b>${done}</b> of <b>${items}</b> items done</span>`;
}

export function render() {
  renderSummary();

  const grid = $("checklistGrid");
  const lists = visibleChecklists();

  const allCollapsed = store.state.checklists.length > 0 && store.state.checklists.every((c) => c.collapsed);
  $("checklistCollapseAll").textContent = allCollapsed ? "Expand all" : "Collapse all";
  $("checklistCollapseAll").classList.toggle("hidden", store.state.checklists.length === 0);

  if (!lists.length) {
    grid.innerHTML = `<p class="checklist-empty">${
      view.search.trim()
        ? `No checklists match &ldquo;${esc(view.search.trim())}&rdquo;.`
        : "No checklists yet. Create one above to get started."
    }</p>`;
    return;
  }

  grid.innerHTML = lists.map(card).join("");

  // Re-rendering replaced the node the caret was in, so restore it.
  const editing = view.editingChecklist
    ? grid.querySelector(`.cl-title-edit[data-cl="${view.editingChecklist}"]`)
    : view.editingItem
      ? grid.querySelector(`.cl-item-edit[data-item="${view.editingItem}"]`)
      : null;

  if (editing) {
    editing.focus();
    editing.setSelectionRange(editing.value.length, editing.value.length);
  }
}

// ------------------------------------------------------------------ edits --

function commitName(input) {
  const cl = getChecklist(input.dataset.cl);
  view.editingChecklist = null;
  if (cl) {
    const next = input.value.trim();
    if (next && next !== cl.name) {
      cl.name = next;
      store.save();
    }
  }
  render();
}

function commitItem(input) {
  const cl = getChecklist(input.dataset.cl);
  const item = getItem(cl, input.dataset.item);
  view.editingItem = null;
  if (item) {
    const next = input.value.trim();
    if (next && next !== item.text) {
      item.text = next;
      store.save();
    }
  }
  render();
}

function addItem(clId) {
  const cl = getChecklist(clId);
  const input = $("checklistGrid").querySelector(`[data-cl-input="${clId}"]`);
  const text = input?.value.trim();
  if (!cl || !text) return;

  cl.items.push({ id: uid(), text, done: false });
  cl.collapsed = false;
  store.save();
  render();
  $("checklistGrid").querySelector(`[data-cl-input="${clId}"]`)?.focus();
}

export function mount() {
  const nameInput = $("newChecklistInput");

  const create = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    store.state.checklists.push({ id: uid(), name, items: [], collapsed: false });
    nameInput.value = "";
    view.search = "";
    $("checklistSearch").value = "";
    store.save();
    render();
  };

  $("addChecklistBtn").addEventListener("click", create);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") create();
  });

  $("checklistSearch").addEventListener("input", (e) => {
    view.search = e.target.value;
    render();
  });

  $("checklistCollapseAll").addEventListener("click", () => {
    const expand = store.state.checklists.every((c) => c.collapsed);
    store.state.checklists.forEach((c) => {
      c.collapsed = !expand;
    });
    store.save();
    render();
  });

  const grid = $("checklistGrid");

  grid.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;

    const { action, cl: clId, item: itemId } = el.dataset;
    const cl = getChecklist(clId);
    if (!cl) return;

    if (action === "add-item") {
      addItem(clId);
    } else if (action === "delete-item") {
      cl.items = cl.items.filter((i) => i.id !== itemId);
      store.save();
      render();
    } else if (action === "edit-item") {
      view.editingItem = itemId;
      view.editingChecklist = null;
      render();
    } else if (action === "rename-checklist") {
      view.editingChecklist = clId;
      view.editingItem = null;
      render();
    } else if (action === "toggle-collapse") {
      cl.collapsed = !cl.collapsed;
      store.save();
      render();
    } else if (action === "clear-done") {
      const n = cl.items.filter((i) => i.done).length;
      if (!confirm(`Remove ${n} completed item(s) from "${cl.name}"?`)) return;
      cl.items = cl.items.filter((i) => !i.done);
      store.save();
      render();
    } else if (action === "delete-checklist") {
      if (!confirm(`Delete the checklist "${cl.name}"? This cannot be undone.`)) return;
      store.state.checklists = store.state.checklists.filter((c) => c.id !== clId);
      store.save();
      render();
    }
  });

  grid.addEventListener("change", (e) => {
    const box = e.target.closest('[data-action="toggle-item"]');
    if (!box) return;
    const item = getItem(getChecklist(box.dataset.cl), box.dataset.item);
    if (!item) return;
    item.done = box.checked;
    store.save();
    render();
  });

  grid.addEventListener(
    "blur",
    (e) => {
      if (e.target.matches(".cl-title-edit")) commitName(e.target);
      else if (e.target.matches(".cl-item-edit")) commitItem(e.target);
    },
    true
  );

  grid.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-cl-input]")) {
      addItem(e.target.dataset.clInput);
      return;
    }

    const isEdit = e.target.matches(".cl-title-edit, .cl-item-edit");
    if (!isEdit) return;

    if (e.key === "Enter") {
      e.preventDefault();
      e.target.matches(".cl-title-edit") ? commitName(e.target) : commitItem(e.target);
    } else if (e.key === "Escape") {
      e.preventDefault();
      view.editingChecklist = null;
      view.editingItem = null;
      render();
    }
  });
}
