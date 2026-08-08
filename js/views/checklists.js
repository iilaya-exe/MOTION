import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { icon } from "../icons.js";
import { uid } from "../lib/id.js";

const getChecklist = (id) => store.state.checklists.find((c) => c.id === id);

export function render() {
  const grid = $("checklistGrid");
  const { checklists } = store.state;

  if (!checklists.length) {
    grid.innerHTML = '<p class="subtitle" style="margin:0;">No checklists yet. Create one above to get started.</p>';
    return;
  }

  grid.innerHTML = checklists
    .map((cl) => {
      const total = cl.items.length;
      const doneCount = cl.items.filter((i) => i.done).length;
      const pct = total ? Math.round((doneCount / total) * 100) : 0;

      const items = cl.items
        .map(
          (item) =>
            `<li class="${item.done ? "done" : ""}">` +
            `<input type="checkbox" data-action="toggle-item" data-cl="${esc(cl.id)}" data-item="${esc(item.id)}"${item.done ? " checked" : ""} aria-label="${esc(item.text)}">` +
            `<span>${esc(item.text)}</span>` +
            `<button class="icon-btn danger-hover" data-action="delete-item" data-cl="${esc(cl.id)}" data-item="${esc(item.id)}" title="Delete item">${icon("close")}</button>` +
            "</li>"
        )
        .join("");

      return (
        '<div class="checklist-card">' +
        '<div class="cl-header">' +
        `<div class="cl-title" data-action="rename-checklist" data-cl="${esc(cl.id)}" title="Click to rename">${esc(cl.name)}</div>` +
        `<button class="icon-btn danger-hover" data-action="delete-checklist" data-cl="${esc(cl.id)}" title="Delete checklist">${icon("trash")}</button>` +
        "</div>" +
        `<div class="progress-bar"><div class="fill" style="width:${pct}%;"></div></div>` +
        `<div class="cl-meta"><span>${doneCount} / ${total} complete</span><span>${pct}%</span></div>` +
        `<ul class="cl-items">${items}</ul>` +
        '<div class="cl-add-row">' +
        `<input class="field" type="text" data-cl-input="${esc(cl.id)}" placeholder="Add an item...">` +
        `<button class="btn secondary" data-action="add-item" data-cl="${esc(cl.id)}">Add</button>` +
        "</div>" +
        "</div>"
      );
    })
    .join("");
}

export function mount() {
  const nameInput = $("newChecklistInput");

  const create = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    store.state.checklists.push({ id: uid(), name, items: [] });
    nameInput.value = "";
    store.save();
    render();
  };

  $("addChecklistBtn").addEventListener("click", create);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") create();
  });

  const grid = $("checklistGrid");

  grid.addEventListener("click", (e) => {
    const addBtn = e.target.closest('[data-action="add-item"]');
    if (addBtn) {
      const cl = getChecklist(addBtn.dataset.cl);
      const input = grid.querySelector(`[data-cl-input="${addBtn.dataset.cl}"]`);
      const text = input.value.trim();
      if (cl && text) {
        cl.items.push({ id: uid(), text, done: false });
        store.save();
        render();
      }
      return;
    }

    const delItem = e.target.closest('[data-action="delete-item"]');
    if (delItem) {
      const cl = getChecklist(delItem.dataset.cl);
      if (cl) {
        cl.items = cl.items.filter((i) => i.id !== delItem.dataset.item);
        store.save();
        render();
      }
      return;
    }

    const delCl = e.target.closest('[data-action="delete-checklist"]');
    if (delCl) {
      const cl = getChecklist(delCl.dataset.cl);
      if (cl && confirm(`Delete the checklist "${cl.name}"? This cannot be undone.`)) {
        store.state.checklists = store.state.checklists.filter((c) => c.id !== cl.id);
        store.save();
        render();
      }
      return;
    }

    const renameEl = e.target.closest('[data-action="rename-checklist"]');
    if (renameEl) {
      const cl = getChecklist(renameEl.dataset.cl);
      if (!cl) return;
      const next = prompt("Rename checklist:", cl.name);
      if (next !== null && next.trim()) {
        cl.name = next.trim();
        store.save();
        render();
      }
    }
  });

  grid.addEventListener("change", (e) => {
    const box = e.target.closest('[data-action="toggle-item"]');
    if (!box) return;
    const cl = getChecklist(box.dataset.cl);
    const item = cl?.items.find((i) => i.id === box.dataset.item);
    if (!item) return;
    item.done = box.checked;
    store.save();
    render();
  });

  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches("[data-cl-input]")) return;
    grid.querySelector(`[data-action="add-item"][data-cl="${e.target.dataset.clInput}"]`)?.click();
  });
}
