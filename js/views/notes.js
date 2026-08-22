import { store } from "../store.js";
import { $, $$, esc, isHidden } from "../dom.js";
import { icon } from "../icons.js";
import { uid } from "../lib/id.js";
import { relativeTime } from "../lib/dates.js";
import * as undo from "../ui/undo.js";
import { ask } from "../ui/confirm.js";
import { closeNav, isMobile, switchView } from "../ui/nav.js";
import * as router from "../ui/router.js";

/* Rich text is produced by document.execCommand. It is deprecated but remains
   the only cross-browser way to get bold/lists/headings inside a contenteditable
   region without pulling in an editor framework. */

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

/** The sidebar page list — rendered here because it mirrors notes state. */
export function renderPageList() {
  const list = $("pageList");
  const { currentPageId } = store.state;
  const pages = matchingPages();

  if (!pages.length) {
    list.innerHTML = `<div class="empty-hint">${
      search.trim() ? "No notes match that search." : "No pages yet — click + to add one."
    }</div>`;
    return;
  }

  const notesVisible = !isHidden($("view-notes"));

  list.innerHTML = pages
    .map((p) => {
      const active = p.id === currentPageId && notesVisible;
      return (
        `<div class="page-item${active ? " active" : ""}" data-id="${esc(p.id)}">` +
        `${icon("page")}<span>${esc(p.title) || "Untitled"}</span></div>`
      );
    })
    .join("");
}

export function render() {
  const page = currentPage();
  const titleEl = $("pageTitleInput");
  const contentEl = $("pageContent");
  const deleteBtn = $("deletePageBtn");

  if (!page) {
    titleEl.value = "";
    titleEl.disabled = true;
    contentEl.innerHTML = "";
    contentEl.contentEditable = "false";
    contentEl.setAttribute("data-placeholder", "Create a page from the sidebar to get started.");
    deleteBtn.classList.add("hidden");
    $("pageMeta").textContent = "";
    updateToolbar();
    return;
  }

  titleEl.disabled = false;
  titleEl.value = page.title;
  contentEl.contentEditable = "true";
  contentEl.innerHTML = page.content;
  contentEl.setAttribute("data-placeholder", "Start writing...");
  deleteBtn.classList.remove("hidden");
  $("pageMeta").textContent = page.updatedAt ? `Edited ${relativeTime(page.updatedAt)}` : "";
  updateToolbar();
}

function savePageContent() {
  const page = currentPage();
  if (!page) return;
  page.content = $("pageContent").innerHTML;
  touch(page);
}

function currentBlockTag() {
  try {
    return (document.queryCommandValue("formatBlock") || "").toLowerCase().replace(/[<>]/g, "");
  } catch {
    return "";
  }
}

function updateToolbar() {
  if (isHidden($("view-notes"))) return;

  const contentEl = $("pageContent");
  const sel = window.getSelection();
  const anchor = sel?.anchorNode;
  const anchorEl = anchor?.nodeType === 3 ? anchor.parentNode : anchor;
  const inEditor = Boolean(sel?.rangeCount && anchorEl && contentEl.contains(anchorEl));

  $$(".notes-toolbar button[data-cmd]").forEach((btn) => {
    let on = false;
    if (inEditor) {
      try {
        on = document.queryCommandState(btn.dataset.cmd);
      } catch {
        on = false;
      }
    }
    btn.classList.toggle("active", Boolean(on));
  });

  // Plain text with no block wrapper reports "" or "div" — both mean Body.
  const block = inEditor ? currentBlockTag() : "";
  $$(".notes-toolbar button[data-block]").forEach((btn) => {
    const target = btn.dataset.block;
    const on =
      inEditor &&
      (target === "p" ? block === "" || block === "p" || block === "div" : block === target);
    btn.classList.toggle("active", on);
  });
}

function insertDivider() {
  const contentEl = $("pageContent");
  contentEl.focus();
  document.execCommand("insertHorizontalRule", false, null);

  // A divider inserted at the very end leaves nowhere to type, so give it a
  // trailing paragraph and drop the caret into it.
  if (contentEl.lastElementChild?.tagName === "HR") {
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    contentEl.appendChild(p);

    const range = document.createRange();
    range.setStart(p, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  savePageContent();
  updateToolbar();
}

export function mount() {
  $("pageList").addEventListener("click", (e) => {
    const item = e.target.closest(".page-item");
    if (!item) return;
    store.state.currentPageId = item.dataset.id;
    store.save();
    if (!router.go("notes", item.dataset.id)) switchView("notes");
    if (isMobile()) closeNav();
  });

  $("newPageBtn").addEventListener("click", () => {
    const page = { id: uid(), title: "", content: "", updatedAt: Date.now() };
    store.state.pages.push(page);
    store.state.currentPageId = page.id;
    store.save();
    if (!router.go("notes", page.id)) switchView("notes");
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

  $("pageContent").addEventListener("input", savePageContent);

  // Keep the caret alive: without this, mousedown moves focus to the button and
  // the command would apply to nothing.
  $$(".notes-toolbar button").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
  });

  $$(".notes-toolbar button[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("pageContent").focus();
      document.execCommand(btn.dataset.cmd, false, null);
      savePageContent();
      updateToolbar();
    });
  });

  $$(".notes-toolbar button[data-block]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("pageContent").focus();
      document.execCommand("formatBlock", false, `<${btn.dataset.block}>`);
      savePageContent();
      updateToolbar();
    });
  });

  $$('.notes-toolbar button[data-insert="divider"]').forEach((btn) => {
    btn.addEventListener("click", insertDivider);
  });

  document.addEventListener("selectionchange", updateToolbar);

  $("pageSearch").addEventListener("input", (e) => {
    search = e.target.value;
    renderPageList();
  });

  $("deletePageBtn").addEventListener("click", async () => {
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
