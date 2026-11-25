import { store } from "../store.js";
import { $, esc, isHidden } from "../dom.js";
import { icon } from "../icons.js";
import { uid } from "../lib/id.js";
import { relativeTime } from "../lib/dates.js";
import { printNote } from "../lib/note-print.js";
import { countWords } from "../lib/rich-text.js";
import * as editor from "./note-editor.js";
import * as undo from "../ui/undo.js";
import { ask } from "../ui/confirm.js";
import { closeNav, isMobile, switchView } from "../ui/nav.js";
import * as router from "../ui/router.js";
import { bindMenu } from "../ui/menu.js";

/* Page management: the sidebar list, titles, search, delete. The editing
   surface itself — ribbon, shortcuts, history — lives in note-editor.js. */

const currentPage = () =>
  store.state.pages.find((p) => p.id === store.state.currentPageId) || null;

/** Sidebar search term. */
let search = "";

/** Strips tags so a content search matches what the reader sees, not markup. */
const plainText = (html) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");

function matchingPages() {
  const needle = search.trim().toLowerCase();
  if (!needle) return store.state.pages;

  return store.state.pages.filter(
    (p) =>
      p.title.toLowerCase().includes(needle) ||
      plainText(p.content).toLowerCase().includes(needle)
  );
}

/** Marks a page edited; every write goes through here so the stamp stays true. */
function touch(page) {
  page.updatedAt = Date.now();
  store.save();
}

// ------------------------------------------------------------------ folders ---
/* One level of folders, like Apple Notes: a note is in one folder or in none.
   Deleting a folder never deletes notes — they move back out, with undo. */

const folders = () => store.state.folders;
const folderById = (id) => (id ? folders().find((f) => f.id === id) || null : null);

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const sortedFolders = () => [...folders()].sort(byName);

/** "New folder", then "New folder 2", … so a fresh folder never shares a name. */
function freeFolderName(base = "New folder") {
  const taken = new Set(folders().map((f) => f.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

/** Adds a folder and returns it. Shared with the command palette. */
export function createFolder(name) {
  const folder = { id: uid(), name: (name || "").trim().slice(0, 120) || freeFolderName(), collapsed: false };
  folders().push(folder);
  store.save();
  return folder;
}

function movePage(pageId, folderId) {
  const page = store.state.pages.find((p) => p.id === pageId);
  if (!page) return;
  const target = folderById(folderId);
  if ((page.folderId || null) === (target ? target.id : null)) return;
  page.folderId = target ? target.id : null;
  if (target) target.collapsed = false; // show where it went
  store.save();
  renderPageList();
  if (page === currentPage()) renderFolderPicker(page);
}

function toggleFolder(id) {
  const folder = folderById(id);
  if (!folder) return;
  folder.collapsed = !folder.collapsed;
  store.save();
  renderPageList();
}

async function deleteFolder(id) {
  const folder = folderById(id);
  if (!folder) return;
  const inside = store.state.pages.filter((p) => p.folderId === id);
  const n = inside.length;

  const ok = await ask({
    title: `Delete folder "${folder.name}"?`,
    message: n
      ? `Its ${n} note${n === 1 ? "" : "s"} will not be deleted — ${n === 1 ? "it moves" : "they move"} out of the folder.`
      : "The folder is empty.",
    confirmLabel: "Delete folder",
  });
  if (!ok) return;

  const index = folders().indexOf(folder);
  folders().splice(index, 1);
  inside.forEach((p) => (p.folderId = null));
  store.save();
  renderPageList();
  renderFolderPicker(currentPage());

  undo.offer(`Deleted folder "${folder.name}"`, () => {
    folders().splice(index, 0, folder);
    inside.forEach((p) => (p.folderId = folder.id));
    store.save();
    renderPageList();
    renderFolderPicker(currentPage());
  });
}

/** Id of the folder being renamed inline; the list is not redrawn under it. */
let renaming = null;

function startRename(id) {
  const folder = folderById(id);
  const row = $("pageList").querySelector(`.folder[data-folder="${CSS.escape(id)}"] .folder-name`);
  if (!folder || !row) return;
  renaming = id;

  const input = document.createElement("input");
  input.className = "folder-input";
  input.value = folder.name;
  input.maxLength = 120;
  input.setAttribute("aria-label", "Folder name");
  row.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    renaming = null;
    const name = input.value.trim();
    if (save && name && name !== folder.name) {
      folder.name = name.slice(0, 120);
      store.save();
    }
    renderPageList();
    renderFolderPicker(currentPage());
  };

  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // Escape here must not close anything else
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
}

// ---------------------------------------------------------------- sidebar ---

function pageItem(p, active, nested) {
  const title = esc(p.title) || "Untitled";
  return (
    `<div class="page-item${active ? " active" : ""}${nested ? " nested" : ""}" data-id="${esc(p.id)}" ` +
    `draggable="true" title="${title}">${icon("page")}<span>${title}</span></div>`
  );
}

function folderBlock(folder, pages, { open, total, isActive }) {
  const name = esc(folder.name);
  const actions =
    `<span class="folder-actions">` +
    `<button type="button" data-folder-action="new" title="New note in ${name}" aria-label="New note in ${name}">${icon("plus")}</button>` +
    `<button type="button" data-folder-action="rename" title="Rename folder" aria-label="Rename ${name}">${icon("pencil")}</button>` +
    `<button type="button" data-folder-action="delete" title="Delete folder" aria-label="Delete ${name}">${icon("trash")}</button>` +
    `</span>`;

  const body = open
    ? `<div class="folder-pages">${
        pages.length
          ? pages.map((p) => pageItem(p, isActive(p), true)).join("")
          : '<button type="button" class="folder-empty" data-folder-action="new">' +
            `${icon("plus")}<span>New note here <small>or drag one in</small></span></button>`
      }</div>`
    : "";

  return (
    `<div class="folder${open ? " open" : ""}" data-folder="${esc(folder.id)}">` +
    `<div class="folder-row" role="button" tabindex="0" aria-expanded="${open}" title="${name}">` +
    icon("chevronRight", "icon folder-chevron") +
    icon(open ? "folderOpen" : "folder", "icon folder-icon") +
    `<span class="folder-name">${name}</span>` +
    `<span class="folder-count">${total || ""}</span>` +
    actions +
    `</div>${body}</div>`
  );
}

/** The sidebar notes tree — rendered here because it mirrors notes state. */
export function renderPageList() {
  if (renaming) return;

  const list = $("pageList");
  const { currentPageId, pages: allPages } = store.state;
  const pages = matchingPages();
  const searching = Boolean(search.trim());
  const notesVisible = !isHidden($("view-notes"));
  const isActive = (p) => p.id === currentPageId && notesVisible;
  const known = new Set(folders().map((f) => f.id));

  let html = "";
  sortedFolders().forEach((folder) => {
    const inside = pages.filter((p) => p.folderId === folder.id);
    if (searching && !inside.length) return;
    const total = allPages.filter((p) => p.folderId === folder.id).length;
    // A search opens every folder it found something in.
    html += folderBlock(folder, inside, { open: searching || !folder.collapsed, total, isActive });
  });

  html += pages
    .filter((p) => !p.folderId || !known.has(p.folderId))
    .map((p) => pageItem(p, isActive(p), false))
    .join("");

  if (!html) {
    html = `<div class="empty-hint">${
      searching ? "No notes match that search." : "No pages yet — click + to add one."
    }</div>`;
  }

  // Only shown mid-drag, for taking a note back out of its folder.
  html += '<div class="unfile-zone" aria-hidden="true">Drop here to take it out of the folder</div>';
  list.innerHTML = html;
}

// ----------------------------------------------------------- folder picker ---

/** The "Folder" dropdown under the title — the way to file a note on a phone. */
function renderFolderPicker(page) {
  const select = $("pageFolderSelect");
  $("folderPicker").classList.toggle("hidden", !page);
  $("folderNewForm").classList.add("hidden");
  if (!page) return;

  const current = folderById(page.folderId);
  select.innerHTML =
    `<option value="">No folder</option>` +
    sortedFolders()
      .map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`)
      .join("") +
    `<option value="__new">New folder…</option>`;
  select.value = current ? current.id : "";
  $("folderPicker").classList.toggle("is-filed", Boolean(current));
}

function openNewFolderInput() {
  $("folderPicker").classList.add("hidden");
  $("folderNewForm").classList.remove("hidden");
  const input = $("folderNewInput");
  input.value = "";
  input.focus();
}

/** "Edited 5 min ago · 312 words" under the title. */
function renderMeta(page) {
  if (!page) {
    $("pageMeta").textContent = "";
    return;
  }
  const words = countWords(page.content);
  const parts = [];
  if (page.updatedAt) parts.push(`Edited ${relativeTime(page.updatedAt)}`);
  parts.push(`${words.toLocaleString()} word${words === 1 ? "" : "s"}`);
  $("pageMeta").textContent = parts.join(" · ");
}

export function render() {
  // Whatever was typed into the previous page is written before it is swapped out.
  editor.flush();

  const page = currentPage();
  const titleEl = $("pageTitleInput");

  titleEl.disabled = !page;
  titleEl.value = page ? page.title : "";
  $("deletePageBtn").classList.toggle("hidden", !page);
  $("printPageBtn").classList.toggle("hidden", !page);
  document.querySelector(".page-actions").classList.toggle("hidden", !page);

  // Opening a note inside a closed folder opens the folder, so the sidebar
  // always shows where the note lives.
  const folder = page && folderById(page.folderId);
  if (folder?.collapsed) {
    folder.collapsed = false;
    store.save();
  }

  // Re-showing the note already in the editor keeps it as it is — caret,
  // selection and all — instead of rebuilding it from storage.
  if (!page || page !== editorPage) editor.load(page);
  else editor.refreshRibbon();
  editorPage = page;
  renderMeta(page);
  renderFolderPicker(page);
}

/** The page the editor's content belongs to, for its debounced saves. */
let editorPage = null;

function commitContent(html) {
  const page = editorPage;
  if (!page || !store.state.pages.includes(page)) return;
  if (page.content === html) return;
  page.content = html;
  touch(page);
  renderMeta(page);
}

/** Adds a page, opens it, and returns it. Shared with the command palette. */
export function createPage(title = "", folderId = null, content = "") {
  const page = { id: uid(), title, content, updatedAt: Date.now(), folderId: folderById(folderId)?.id || null };
  store.state.pages.push(page);
  store.state.currentPageId = page.id;
  store.save();
  // Show it now rather than when the hashchange lands, so anything typed in
  // the meantime goes into the new note, not the one being left.
  switchView("notes");
  router.go("notes", page.id);
  return page;
}

export function mount() {
  editor.mount({ commit: commitContent });

  const list = $("pageList");

  list.addEventListener("click", (e) => {
    const action = e.target.closest("[data-folder-action]");
    if (action) {
      const id = action.closest(".folder").dataset.folder;
      const kind = action.dataset.folderAction;
      if (kind === "rename") startRename(id);
      else if (kind === "delete") deleteFolder(id);
      else if (kind === "new") {
        createPage("", id);
        if (isMobile()) closeNav();
        else $("pageTitleInput").focus();
      }
      return;
    }

    const row = e.target.closest(".folder-row");
    if (row) {
      if (e.target.closest("input")) return;
      const id = row.parentElement.dataset.folder;
      // The first click of a double-click already toggled the folder and
      // redrew the list, so no dblclick event would ever arrive: read the
      // click count instead, undo that toggle, and rename.
      if (e.detail === 2 && e.target.closest(".folder-name")) {
        toggleFolder(id);
        startRename(id);
        return;
      }
      toggleFolder(id);
      return;
    }

    const item = e.target.closest(".page-item");
    if (!item) return;
    store.state.currentPageId = item.dataset.id;
    store.save();
    if (!router.go("notes", item.dataset.id)) switchView("notes");
    if (isMobile()) closeNav();
  });

  list.addEventListener("keydown", (e) => {
    const row = e.target.closest(".folder-row");
    if (!row || e.target !== row) return;
    const id = row.parentElement.dataset.folder;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleFolder(id);
      list.querySelector(`.folder[data-folder="${CSS.escape(id)}"] .folder-row`)?.focus();
    } else if (e.key === "F2") {
      e.preventDefault();
      startRename(id);
    }
  });

  // Drag a note onto a folder to file it, or onto the bottom strip to unfile it.
  let dragId = null;
  const clearDrop = () => list.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  const dropZone = (el) => el.closest(".folder") || el.closest(".unfile-zone") || null;

  list.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".page-item");
    if (!item) return;
    dragId = item.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    // A private type, so dropping into the editor does not paste anything.
    e.dataTransfer.setData("application/x-motion-note", dragId);
    const page = store.state.pages.find((p) => p.id === dragId);
    list.classList.add("is-dragging");
    list.classList.toggle("drag-from-folder", Boolean(page?.folderId));
  });

  list.addEventListener("dragover", (e) => {
    if (!dragId) return;
    const zone = dropZone(e.target);
    if (!zone) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!zone.classList.contains("drop-target")) {
      clearDrop();
      zone.classList.add("drop-target");
    }
  });

  list.addEventListener("dragleave", (e) => {
    if (!list.contains(e.relatedTarget)) clearDrop();
  });

  list.addEventListener("drop", (e) => {
    if (!dragId) return;
    const zone = dropZone(e.target);
    if (!zone) return;
    e.preventDefault();
    const id = dragId;
    dragId = null;
    movePage(id, zone.classList.contains("folder") ? zone.dataset.folder : null);
  });

  list.addEventListener("dragend", () => {
    dragId = null;
    clearDrop();
    list.classList.remove("is-dragging", "drag-from-folder");
  });

  $("newFolderBtn").addEventListener("click", () => {
    const folder = createFolder();
    renderPageList();
    renderFolderPicker(currentPage());
    startRename(folder.id);
  });

  $("pageFolderSelect").addEventListener("change", (e) => {
    const page = currentPage();
    if (!page) return;
    if (e.target.value === "__new") {
      openNewFolderInput();
      return;
    }
    movePage(page.id, e.target.value || null);
  });

  const closeNewFolder = () => renderFolderPicker(currentPage());
  $("folderNewForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const page = currentPage();
    const name = $("folderNewInput").value.trim();
    if (page && name) {
      const folder = createFolder(name);
      movePage(page.id, folder.id);
    }
    closeNewFolder();
  });
  $("folderNewInput").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeNewFolder();
    }
  });
  $("folderNewInput").addEventListener("blur", () => {
    // Submitting already redrew the picker; a plain blur just cancels.
    if (!$("folderNewForm").classList.contains("hidden")) closeNewFolder();
  });

  $("newPageBtn").addEventListener("click", () => {
    createPage();
    if (isMobile()) closeNav();
    // Focusing immediately on mobile fights the closing drawer animation.
    else $("pageTitleInput").focus();
  });

  $("pageTitleInput").addEventListener("input", function () {
    const page = currentPage();
    if (!page) return;
    page.title = this.value;
    touch(page);
    renderPageList();
  });

  // Enter in the title drops into the note, as in Notion and Apple Notes.
  $("pageTitleInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      editor.focusStart();
    }
  });

  bindMenu($("pageMenuBtn"), $("pageMenu"));

  $("duplicatePageBtn").addEventListener("click", () => {
    editor.flush();
    const page = currentPage();
    if (!page) return;
    createPage(page.title ? `${page.title} (copy)` : "", page.folderId, page.content);
  });

  // Opens the folder dropdown under the title, where filing already lives.
  $("movePageBtn").addEventListener("click", () => {
    const select = $("pageFolderSelect");
    select.focus();
    try {
      select.showPicker();
    } catch {
      /* older browsers: focus is enough, the arrow keys change it */
    }
  });

  $("printPageBtn").addEventListener("click", () => {
    editor.flush();
    printNote(currentPage());
  });

  $("pageSearch").addEventListener("input", (e) => {
    editor.flush();
    search = e.target.value;
    renderPageList();
  });

  $("deletePageBtn").addEventListener("click", async () => {
    editor.flush();
    const page = currentPage();
    if (!page) return;

    const ok = await ask({
      title: `Delete "${page.title || "Untitled"}"?`,
      message: "This note and everything written in it will be removed.",
    });
    if (!ok) return;

    const index = store.state.pages.indexOf(page);
    store.state.pages.splice(index, 1);
    store.state.currentPageId = store.state.pages.length ? store.state.pages[0].id : null;
    store.save();
    renderPageList();
    render();

    undo.offer(`Deleted "${page.title || "Untitled"}"`, () => {
      store.state.pages.splice(index, 0, page);
      store.state.currentPageId = page.id;
      store.save();
      renderPageList();
      render();
    });
  });
}
