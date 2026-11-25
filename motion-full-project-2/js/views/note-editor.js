import { $, $$, isHidden } from "../dom.js";
import { PALETTE, cleanHtml, isUrl, safeHref, sanitizePaste } from "../lib/rich-text.js";
import { isMobile } from "../ui/nav.js";

/* The note editor: a contenteditable region plus everything that makes it
   behave like a modern notes app rather than a bare browser text box.

   - The ribbon stays pinned while a long note scrolls under it, and on phones
     it docks above the on-screen keyboard while typing.
   - Undo/redo is the editor's own. The browser's native stack cannot see the
     DOM tidying below or the checklist ticks, so mixing the two left undo
     replaying the wrong thing. One snapshot history covers every change.
   - Formatting still goes through document.execCommand where the browser does
     it well (bold across nodes, lists, block types), with the gaps filled by
     hand: inline code, checklists, links, Markdown shortcuts and clean paste.
   - Chrome leaves <span style="font-size:…"> behind when one block merges into
     another, so every change ends with a tidy pass that removes it. */

const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const HISTORY_LIMIT = 200;
const GROUP_MS = 900;
const SAVE_DELAY = 300;
const ZWSP = "​";

let editor;
let ribbon;
let sentinel;
let popover;

/** Supplied by notes.js: called with clean HTML whenever content should be stored. */
let onCommit = () => {};

/** Last caret inside the editor, so the ribbon still acts there after focus left. */
let savedRange = null;
let batching = 0;
let commitTimer = null;

/** Per-page history, kept while the app is open so switching notes keeps undo. */
const histories = new Map();
let hist = null;

// ------------------------------------------------------------------ helpers ---

const asElement = (node) => (node && node.nodeType === 3 ? node.parentElement : node);

/** Nearest ancestor matching `selector` that lives inside the editor. */
function closestIn(node, selector) {
  const el = asElement(node);
  const found = el && el.closest ? el.closest(selector) : null;
  return found && found !== editor && editor.contains(found) ? found : null;
}

/** The current selection, if it is inside the editor. */
function editorRange() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range : null;
}

function setRange(range) {
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretAt(node, offset) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  setRange(r);
}

const exec = (cmd, value = null) => {
  try {
    return document.execCommand(cmd, false, value);
  } catch {
    return false;
  }
};

const queryState = (cmd) => {
  try {
    return document.queryCommandState(cmd);
  } catch {
    return false;
  }
};

const isEditable = () => editor && editor.contentEditable === "true";

const BLOCK_SELECTOR = "h2, h3, blockquote, li, p, div, pre";
const blockOf = (node) => closestIn(node, BLOCK_SELECTOR);

/** Kind of list the caret is in: "ul", "ol", "todo" or null. */
function listKind(list) {
  if (!list) return null;
  if (list.tagName === "OL") return "ol";
  return list.classList.contains("todo") ? "todo" : "ul";
}

const currentList = () => {
  const r = editorRange();
  return r ? closestIn(r.startContainer, "ul, ol") : null;
};

/** Text between the start of `block` and the caret. */
function textBefore(block, range) {
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().replace(/ /g, " ").replace(/​/g, "");
}

/** Runs `fn` with the selection pinned to its nodes, for edits that move them. */
function keepSelection(fn) {
  const sel = window.getSelection();
  const saved = sel.rangeCount
    ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset]
    : null;
  fn();
  if (!saved || !saved[0]?.isConnected || !saved[2]?.isConnected) return;
  // Re-setting an unchanged selection would drop Chrome's pending typing style
  // (Cmd+B or a colour picked with nothing selected, then typing).
  if (
    sel.anchorNode === saved[0] && sel.anchorOffset === saved[1] &&
    sel.focusNode === saved[2] && sel.focusOffset === saved[3]
  ) return;
  try {
    sel.setBaseAndExtent(...saved);
  } catch {
    /* the node shrank; leave the browser's choice */
  }
}

function unwrap(el) {
  el.replaceWith(...el.childNodes);
}

// ------------------------------------------------------------------ history ---

/** Child-index path from the editor to `node`, so a caret survives innerHTML. */
function pathTo(node) {
  const path = [];
  while (node && node !== editor) {
    const parent = node.parentNode;
    if (!parent) return null;
    path.unshift([...parent.childNodes].indexOf(node));
    node = parent;
  }
  return node === editor ? path : null;
}

function resolvePath(path) {
  let node = editor;
  for (const i of path || []) {
    if (!node.childNodes[i]) return null;
    node = node.childNodes[i];
  }
  return node;
}

function saveSel() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode) || !editor.contains(sel.focusNode)) return null;
  const a = pathTo(sel.anchorNode);
  const f = pathTo(sel.focusNode);
  return a && f ? { a, ao: sel.anchorOffset, f, fo: sel.focusOffset } : null;
}

function restoreSel(s) {
  editor.focus({ preventScroll: true });
  const a = s && resolvePath(s.a);
  const f = s && resolvePath(s.f);
  try {
    if (a && f) {
      const max = (n) => (n.nodeType === 3 ? n.length : n.childNodes.length);
      window.getSelection().setBaseAndExtent(a, Math.min(s.ao, max(a)), f, Math.min(s.fo, max(f)));
    } else {
      placeCaretAtEnd();
    }
  } catch {
    placeCaretAtEnd();
  }
  revealCaret();
}

const snapshot = () => ({ html: editor.innerHTML, sel: saveSel() });

function newHistory() {
  return { undo: [], redo: [], current: snapshot(), lastKind: null, lastTime: 0, groupStart: 0 };
}

/** Records the editor's current state as one step (or folds it into the last). */
function record(kind) {
  if (!hist) return;
  const now = Date.now();
  const snap = snapshot();
  if (snap.html === hist.current.html) {
    hist.current.sel = snap.sel;
    return;
  }

  const typing = kind === "insert" || kind === "delete";
  const group =
    typing && kind === hist.lastKind && now - hist.lastTime < GROUP_MS && now - hist.groupStart < 4000;

  if (!group) {
    hist.undo.push(hist.current);
    if (hist.undo.length > HISTORY_LIMIT) hist.undo.shift();
    hist.groupStart = now;
  }
  hist.redo.length = 0;
  hist.current = snap;
  hist.lastKind = typing ? kind : null;
  hist.lastTime = now;
}

function applySnapshot(snap) {
  editor.innerHTML = snap.html;
  hist.current = { html: editor.innerHTML, sel: snap.sel };
  hist.lastKind = null;
  restoreSel(snap.sel);
  scheduleCommit();
  refresh();
}

export function undo() {
  if (!hist || !hist.undo.length) return;
  hist.redo.push(hist.current);
  applySnapshot(hist.undo.pop());
}

export function redo() {
  if (!hist || !hist.redo.length) return;
  hist.undo.push(hist.current);
  applySnapshot(hist.redo.pop());
}

// ------------------------------------------------------------------- saving ---

function scheduleCommit() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(flush, SAVE_DELAY);
}

/** Writes pending edits now. Called before anything reads or replaces the note. */
export function flush() {
  if (!commitTimer) return;
  clearTimeout(commitTimer);
  commitTimer = null;
  onCommit(cleanHtml(editor.innerHTML));
}

/** One finished change: tidy, remember, save, redraw the ribbon. */
function changed(kind) {
  normalize();
  record(kind);
  scheduleCommit();
  refresh();
}

/** Runs several DOM changes as a single undo step. */
function batch(fn, kind = "format") {
  batching++;
  try {
    fn();
  } finally {
    batching--;
  }
  if (!batching) changed(kind);
}

// ---------------------------------------------------------------- tidy pass ---

/** Undoes what the browser adds on its own: style spans, stray tags, bare text. */
function normalize() {
  keepSelection(() => {
    fromStyles();
    editor.querySelectorAll("[data-tc], [data-hl]").forEach((el) => {
      if (el.hasAttribute("data-tc") && !PALETTE.includes(el.dataset.tc)) el.removeAttribute("data-tc");
      if (el.hasAttribute("data-hl") && !PALETTE.includes(el.dataset.hl)) el.removeAttribute("data-hl");
    });
    editor.querySelectorAll("span:not([data-tc]):not([data-hl]), font").forEach(unwrap);
    editor.querySelectorAll("span:empty").forEach((el) => el.remove());
    editor.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));
    editor.querySelectorAll("img, picture, video, iframe, svg, meta, style, script").forEach((el) => el.remove());
    editor.querySelectorAll("[class]").forEach((el) => {
      if (el.tagName === "UL" && el.classList.contains("todo")) {
        if (el.classList.length > 1) el.className = "todo";
      } else {
        el.removeAttribute("class");
      }
    });
    // Childless blocks have no height and cannot take a caret; Chrome leaves
    // them behind when lists and quotes are broken out of. A real empty line
    // is <p><br></p>, which stays.
    editor.querySelectorAll("p:empty, h2:empty, h3:empty, blockquote:empty, div:empty").forEach((el) => {
      const sel = window.getSelection();
      if (sel.rangeCount && el.contains(sel.anchorNode)) el.appendChild(document.createElement("br"));
      else el.remove();
    });
    editor.querySelectorAll("li[data-checked]").forEach((li) => {
      if (!li.parentElement?.matches("ul.todo")) li.removeAttribute("data-checked");
    });

    // Outdenting the last list item leaves bare text at the root; give it a
    // paragraph so it styles and exports like every other line.
    const nodes = [...editor.childNodes];
    const hasBlocks = nodes.some((n) => n.nodeType === 1 && /^(P|H2|H3|BLOCKQUOTE|UL|OL|HR|DIV|PRE)$/.test(n.tagName));
    if (hasBlocks) {
      let run = null;
      nodes.forEach((n) => {
        const inline = n.nodeType === 3 || (n.nodeType === 1 && !/^(P|H2|H3|BLOCKQUOTE|UL|OL|HR|DIV|PRE)$/.test(n.tagName));
        if (!inline) {
          run = null;
          return;
        }
        if (n.nodeType === 3 && !n.data.trim() && !run) return;
        if (!run) {
          run = document.createElement("p");
          editor.insertBefore(run, n);
        }
        run.appendChild(n);
      });
    }
  });
}

function updateEmptyState() {
  const empty =
    !editor.textContent.replace(/​/g, "").trim() && !editor.querySelector("hr, li, h2, h3, blockquote");
  editor.classList.toggle("is-empty", empty);
}

// ----------------------------------------------------------------- commands ---

/** Makes sure there is a caret in the editor for a ribbon command to act on. */
function ensureSelection() {
  // Focus without scrolling first: execCommand focuses an unfocused editor
  // itself, and that focus scrolls a long note back to its top.
  if (document.activeElement !== editor) {
    const range = editorRange();
    editor.focus({ preventScroll: true });
    if (range) setRange(range);
  }
  if (editorRange()) return;
  if (savedRange && editor.contains(savedRange.startContainer)) setRange(savedRange.cloneRange());
  else placeCaretAtEnd();
}

function placeCaretAtEnd() {
  const r = document.createRange();
  r.selectNodeContents(editor);
  r.collapse(false);
  setRange(r);
}

function activeBlockTag() {
  const r = editorRange();
  const block = r && closestIn(r.startContainer, "h2, h3, blockquote");
  return block ? block.tagName.toLowerCase() : "p";
}

/** formatBlock inside a list item wraps the whole list, so leave the list first. */
function leaveList() {
  for (let i = 0; i < 6 && currentList(); i++) exec("outdent");
}

function setBlock(tag) {
  leaveList();
  exec("formatBlock", `<${tag}>`);
}

const toggleBlock = (tag) => setBlock(activeBlockTag() === tag ? "p" : tag);

function setList(kind) {
  const range = editorRange();
  if (!range) return;
  const list = currentList();
  const current = listKind(list);
  const command = kind === "ol" ? "insertOrderedList" : "insertUnorderedList";

  if (current === kind) {
    exec(command);
    return;
  }

  if (list) {
    // Switching an existing list switches all of it, as in Docs. Bullet and
    // checklist are the same <ul>, so only the class changes between them.
    if (kind === "ol" || current === "ol") exec(command);
    const now = currentList();
    if (now && now.tagName === "UL") now.classList.toggle("todo", kind === "todo");
    return;
  }

  const start = blockOf(range.startContainer);
  if (start === blockOf(range.endContainer)) {
    listFromBlock(start, kind);
    return;
  }

  // Several paragraphs selected: the browser's command handles the range.
  if (activeBlockTag() !== "p") exec("formatBlock", "<p>");
  exec(command);
  const made = currentList();
  if (made && made.tagName === "UL") made.classList.toggle("todo", kind === "todo");
}

/**
 * Turns one block into a list item by hand. Chrome's list command merges the
 * new item into any list touching it, so a checklist typed under a bullet list
 * used to turn the whole bullet list into a checklist.
 */
function listFromBlock(block, kind) {
  if (!block) {
    normalize(); // bare text at the root gets its paragraph first
    const r = editorRange();
    block = r && blockOf(r.startContainer);
    if (!block) return void exec(kind === "ol" ? "insertOrderedList" : "insertUnorderedList");
  }

  const tag = kind === "ol" ? "OL" : "UL";
  const li = document.createElement("li");
  const sameKind = (el) => el && el.tagName === tag && listKind(el) === kind;

  keepSelection(() => {
    while (block.firstChild) li.appendChild(block.firstChild);
    if (!li.firstChild) li.appendChild(document.createElement("br"));

    const prev = block.previousElementSibling;
    const next = block.nextElementSibling;
    if (sameKind(prev)) {
      prev.appendChild(li);
      block.remove();
      if (sameKind(next)) {
        while (next.firstChild) prev.appendChild(next.firstChild);
        next.remove();
      }
    } else if (sameKind(next)) {
      next.insertBefore(li, next.firstChild);
      block.remove();
    } else {
      const list = document.createElement(tag);
      if (kind === "todo") list.className = "todo";
      list.appendChild(li);
      block.replaceWith(list);
    }
  });

  // A caret on the old block itself (not its text) went with it.
  const after = editorRange();
  if (!after || !li.contains(after.startContainer)) caretAt(li, 0);
}

function indent(outdent) {
  const before = currentList();
  exec(outdent ? "outdent" : "indent");
  // A nested list Chrome creates is a plain <ul>; keep it a checklist.
  const after = currentList();
  if (!outdent && after && after !== before && after.tagName === "UL" && listKind(before) === "todo") {
    after.classList.add("todo");
  }
}

function toggleCheck(li) {
  if (!li) return;
  if (li.getAttribute("data-checked") === "true") li.removeAttribute("data-checked");
  else li.setAttribute("data-checked", "true");
}

/** Inline code has no execCommand, so it is wrapped by hand. */
function toggleCode() {
  const sel = window.getSelection();
  let range = editorRange();
  if (!range) return;

  const inCode = closestIn(range.startContainer, "code") || closestIn(range.endContainer, "code");
  if (inCode) {
    keepSelection(() => unwrap(inCode));
    return;
  }

  if (range.collapsed) {
    // No selection: code the word under the caret, as Docs and Notion do.
    const original = range.cloneRange();
    sel.modify("move", "backward", "word");
    sel.modify("extend", "forward", "word");
    range = sel.getRangeAt(0);
    if (range.collapsed || !range.toString().trim()) {
      setRange(original);
      return;
    }
  }

  // Code is one run of text; a selection across paragraphs stays as it is.
  if (blockOf(range.startContainer) !== blockOf(range.endContainer)) return;

  const raw = range.toString();
  const text = raw.replace(/\s+$/, "");
  if (!text.trim()) return;
  const trailing = raw.slice(text.length);

  range.deleteContents();
  const code = document.createElement("code");
  code.textContent = text;
  range.insertNode(code);
  if (trailing) code.after(document.createTextNode(trailing));

  const r = document.createRange();
  r.selectNodeContents(code);
  setRange(r);
}

function insertDivider() {
  exec("insertHorizontalRule");
  // A divider at the very end leaves nowhere to type, so add a line after it.
  const last = editor.lastElementChild;
  if (last && last.tagName === "HR") {
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    editor.appendChild(p);
    caretAt(p, 0);
  }
}

const COMMANDS = {
  undo,
  redo,
  h2: () => batch(() => toggleBlock("h2")),
  h3: () => batch(() => toggleBlock("h3")),
  p: () => batch(() => setBlock("p")),
  quote: () => batch(() => toggleBlock("blockquote")),
  bold: () => batch(() => exec("bold")),
  italic: () => batch(() => exec("italic")),
  underline: () => batch(() => exec("underline")),
  strike: () => batch(() => exec("strikeThrough")),
  code: () => batch(toggleCode),
  ul: () => batch(() => setList("ul")),
  ol: () => batch(() => setList("ol")),
  todo: () => batch(() => setList("todo")),
  link: () => openLinkEditor(),
  color: () => (isColorOpen() ? closeColor() : openColor()),
  divider: () => batch(insertDivider),
  clear: () => batch(() => {
    exec("removeFormat");
    const r = editorRange();
    const code = r && closestIn(r.startContainer, "code");
    if (code) keepSelection(() => unwrap(code));
  }),
};

/** Runs a ribbon command by name. Exported for the command palette and tests. */
export function run(name) {
  if (!isEditable() || !COMMANDS[name]) return;
  if (name !== "undo" && name !== "redo") ensureSelection();
  COMMANDS[name]();
}

// ------------------------------------------------------------------ ribbon ---

/** Whether each ribbon button should read as on, from where the caret is. */
function ribbonState() {
  const r = editorRange();
  if (!r) return {};
  const n = r.startContainer;
  const list = closestIn(n, "ul, ol");
  const kind = listKind(list);
  const block = closestIn(n, "h2, h3, blockquote");
  const tag = block ? block.tagName : "";

  return {
    bold: queryState("bold"),
    italic: queryState("italic"),
    underline: queryState("underline"),
    strike: queryState("strikeThrough"),
    code: Boolean(closestIn(n, "code")),
    link: Boolean(closestIn(n, "a")),
    ul: kind === "ul",
    ol: kind === "ol",
    todo: kind === "todo",
    h2: tag === "H2",
    h3: tag === "H3",
    quote: tag === "BLOCKQUOTE",
    p: !block && !list,
    tc: closestIn(n, "[data-tc]")?.dataset.tc || "",
    hl: closestIn(n, "[data-hl]")?.dataset.hl || "",
  };
}

function updateRibbon() {
  if (!editor || isHidden($("view-notes"))) return;
  const state = ribbonState();
  $$(".notes-toolbar button[data-action]").forEach((btn) => {
    const action = btn.dataset.action;
    if (action === "color") {
      // The "A" shows the colours at the caret, like a word processor's button.
      btn.style.setProperty("--cur-tc", state.tc ? `var(--tc-${state.tc})` : "currentColor");
      btn.style.setProperty("--cur-hl", state.hl ? `var(--hl-${state.hl})` : "transparent");
      btn.classList.toggle("active", isColorOpen());
      return;
    }
    if (action === "undo") return void (btn.disabled = !hist?.undo.length);
    if (action === "redo") return void (btn.disabled = !hist?.redo.length);
    const on = Boolean(state[action]);
    btn.classList.toggle("active", on);
    if (btn.hasAttribute("aria-pressed")) btn.setAttribute("aria-pressed", String(on));
  });
  ribbon.classList.toggle("is-disabled", !isEditable());
}

let frame = 0;
/** Coalesces ribbon redraws to one per frame; selectionchange fires a lot. */
function refresh() {
  updateEmptyState();
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    updateRibbon();
    updateLinkBubble();
    updatePinned();
  });
}

/** Shortcut labels in the platform's own notation, for tooltips. */
function formatKeys(keys) {
  const parts = keys.split("+");
  if (IS_MAC) {
    const sym = { mod: "⌘", shift: "⇧", alt: "⌥" };
    const mods = ["alt", "shift", "mod"].filter((m) => parts.includes(m)).map((m) => sym[m]).join("");
    return mods + parts.filter((p) => !sym[p]).join("").toUpperCase();
  }
  const names = { mod: "Ctrl", shift: "Shift", alt: "Alt" };
  return parts.map((p) => names[p] || p.toUpperCase()).join("+");
}

function labelButtons() {
  $$(".notes-toolbar button[data-action]").forEach((btn) => {
    const label = btn.dataset.label || btn.textContent.trim();
    const keys = btn.dataset.keys;
    const hint = btn.dataset.hint;
    btn.setAttribute("aria-label", label);
    let title = label;
    if (keys) {
      const shown = IS_MAC || keys !== "mod+shift+z" ? formatKeys(keys) : "Ctrl+Y";
      title += btn.dataset.keysLabel ? ` (${shown} ${btn.dataset.keysLabel})` : ` (${shown})`;
      btn.setAttribute("aria-keyshortcuts", keys.replace("mod", IS_MAC ? "Meta" : "Control").replace("shift", "Shift").replace("alt", "Alt"));
    }
    if (hint) title += ` — or type ${hint}`;
    btn.title = title;
  });
}

// -------------------------------------------------------------- pinning ---

/** The ribbon is sticky; this adds the "stuck" look and the keyboard dock. */
function updatePinned() {
  if (!ribbon || isHidden($("view-notes"))) return;

  const vv = window.visualViewport;
  const keyboardOpen =
    vv && isMobile() && document.activeElement === editor && window.innerHeight - vv.height > 120;

  if (keyboardOpen) {
    if (!ribbon.classList.contains("is-docked")) {
      sentinel.style.height = `${ribbon.offsetHeight}px`;
      ribbon.classList.add("is-docked");
    }
    // Fixed elements sit in the layout viewport; the keyboard shrinks the
    // visual one. Park the ribbon on the visual viewport's bottom edge.
    const top = vv.offsetTop + vv.height - ribbon.offsetHeight;
    ribbon.style.transform = `translate3d(0, ${Math.round(top)}px, 0)`;
    ribbon.classList.remove("is-stuck");
    return;
  }

  if (ribbon.classList.contains("is-docked")) {
    ribbon.classList.remove("is-docked");
    ribbon.style.transform = "";
    sentinel.style.height = "";
  }
  // Once the ribbon has moved off its natural spot, it is pinned.
  const stuck = ribbon.getBoundingClientRect().top - sentinel.getBoundingClientRect().top > 1;
  ribbon.classList.toggle("is-stuck", stuck);
}

/** Keeps the caret clear of the pinned ribbon (and the keyboard) while typing. */
function revealCaret() {
  const r = editorRange();
  if (!r || !r.collapsed) return;
  let rect = r.getClientRects()[0] || r.getBoundingClientRect();
  if (!rect || (!rect.height && !rect.top)) {
    const el = asElement(r.startContainer);
    rect = el?.getBoundingClientRect();
  }
  if (!rect) return;

  const scroller = isMobile() ? document.scrollingElement : $("view-notes").parentElement;
  const docked = ribbon.classList.contains("is-docked");
  const ribbonRect = ribbon.getBoundingClientRect();
  const vv = window.visualViewport;

  const topLimit = docked ? (isMobile() ? 60 : 0) : ribbonRect.bottom + 8;
  const bottomLimit = docked ? ribbonRect.top - 8 : (vv ? vv.offsetTop + vv.height : window.innerHeight) - 16;

  if (rect.top < topLimit) scroller.scrollTop -= topLimit - rect.top;
  else if (rect.bottom > bottomLimit) scroller.scrollTop += rect.bottom - bottomLimit;
}

// ------------------------------------------------------------------- links ---

let linkTarget = null; // { range, anchor }

function positionPopover(rect) {
  const pad = 8;
  popover.style.left = "0px";
  popover.style.top = "0px";
  const w = popover.offsetWidth;
  const h = popover.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + 6;
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
  if (top + h > window.innerHeight - pad) top = Math.max(pad, rect.top - h - 6);
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function rangeRect(range) {
  const rects = range.getClientRects();
  if (rects.length) return rects[0];
  const el = asElement(range.startContainer);
  return el.getBoundingClientRect();
}

export const isLinkEditorOpen = () => popover && !isHidden(popover) && popover.dataset.mode === "edit";

function openLinkEditor() {
  if (!isEditable()) return;
  ensureSelection();
  const range = editorRange();
  if (!range) return;
  const anchor = closestIn(range.startContainer, "a");
  linkTarget = { range: range.cloneRange(), anchor };

  const input = $("linkInput");
  input.value = anchor ? anchor.getAttribute("href") : "";
  $("linkRemoveBtn").classList.toggle("hidden", !anchor);
  popover.dataset.mode = "edit";
  popover.classList.remove("hidden");
  positionPopover(rangeRect(anchor ? rangeOf(anchor) : range));
  input.focus();
  input.select();
}

function rangeOf(node) {
  const r = document.createRange();
  r.selectNodeContents(node);
  return r;
}

export function closeLinkEditor(restore = true) {
  if (!popover) return;
  popover.classList.add("hidden");
  popover.dataset.mode = "";
  if (restore && linkTarget) {
    editor.focus({ preventScroll: true });
    if (editor.contains(linkTarget.range.startContainer)) setRange(linkTarget.range);
  }
  linkTarget = null;
}

function applyLink(rawUrl) {
  const target = linkTarget;
  closeLinkEditor(true);
  if (!target) return;
  const href = safeHref(rawUrl);

  batch(() => {
    if (target.anchor && target.anchor.isConnected) {
      if (!href) {
        setRange(rangeOf(target.anchor));
        exec("unlink");
        return;
      }
      target.anchor.setAttribute("href", href);
      return;
    }
    if (!href) return;
    insertLinkAt(target.range, href);
  });
}

/** Links the selection, or inserts the URL itself as a link at a bare caret. */
function insertLinkAt(range, href, text) {
  setRange(range);
  if (!range.collapsed) {
    exec("createLink", href);
    const sel = window.getSelection();
    if (sel.rangeCount) sel.collapseToEnd();
    return;
  }
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text || href.replace(/^mailto:/, "");
  range.insertNode(a);
  const after = document.createTextNode(ZWSP);
  a.after(after);
  caretAt(after, 1);
}

function removeLink() {
  const target = linkTarget;
  closeLinkEditor(true);
  if (!target?.anchor?.isConnected) return;
  batch(() => {
    setRange(rangeOf(target.anchor));
    exec("unlink");
    window.getSelection().collapseToEnd();
  });
}

/** With the caret in a link, a small card shows where it goes. */
function updateLinkBubble() {
  if (!popover || isLinkEditorOpen()) return;
  const r = editorRange();
  const anchor = r && r.collapsed && document.activeElement === editor ? closestIn(r.startContainer, "a") : null;
  if (!anchor) {
    if (popover.dataset.mode === "view") {
      popover.classList.add("hidden");
      popover.dataset.mode = "";
    }
    return;
  }
  const href = anchor.getAttribute("href") || "";
  const open = $("linkOpen");
  open.href = href;
  open.textContent = href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || href;
  popover.dataset.mode = "view";
  popover.classList.remove("hidden");
  positionPopover(rangeOf(anchor).getBoundingClientRect());
}

// ------------------------------------------------------------------ colour ---
/* Colours are stored as palette names in data-tc (text) and data-hl
   (highlight), so dark mode gets its own shade of each. Chrome's colour
   commands only speak inline styles, so for the length of one command every
   named colour is turned into a marker colour, the command runs with CSS
   output, and the markers are read back into names. Chrome then does the hard
   part — splitting and merging around the selection — on its own terms. */

const MARK = { tc: [1, 2], hl: [3, 4] };
const markerFor = (kind, name) => `rgb(${MARK[kind][0]}, ${MARK[kind][1]}, ${name ? PALETTE.indexOf(name) + 1 : 0})`;

function readMarker(value) {
  let m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value || "");
  // Typing after a colour pick produces <font color="#010206"> instead.
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value || "");
  if (hex) m = [null, ...hex.slice(1).map((h) => parseInt(h, 16))];
  if (!m) return null;
  const kind = Object.keys(MARK).find((k) => MARK[k][0] === +m[1] && MARK[k][1] === +m[2]);
  if (!kind) return null;
  const i = +m[3];
  return { kind, name: i ? PALETTE[i - 1] || null : null };
}

function toStyles() {
  editor.querySelectorAll("[data-tc]").forEach((el) => {
    el.style.color = markerFor("tc", el.dataset.tc);
    el.removeAttribute("data-tc");
  });
  editor.querySelectorAll("[data-hl]").forEach((el) => {
    el.style.backgroundColor = markerFor("hl", el.dataset.hl);
    el.removeAttribute("data-hl");
  });
}

function fromStyles() {
  editor.querySelectorAll("font[color]").forEach((font) => {
    const tc = readMarker(font.getAttribute("color"));
    if (tc?.kind !== "tc") return;
    const span = document.createElement("span");
    if (tc.name) span.dataset.tc = tc.name;
    if (font.getAttribute("style")) span.setAttribute("style", font.getAttribute("style"));
    font.before(span);
    span.append(...font.childNodes);
    font.remove();
  });
  editor.querySelectorAll("[style]").forEach((el) => {
    const tc = readMarker(el.style.color);
    if (tc?.kind === "tc") {
      if (tc.name) el.dataset.tc = tc.name;
      el.style.color = "";
    }
    const hl = readMarker(el.style.backgroundColor);
    if (hl?.kind === "hl") {
      if (hl.name) el.dataset.hl = hl.name;
      el.style.backgroundColor = "";
    }
  });
}

/** Colours the selection (or what is typed next). `name` null = default / none. */
function applyColor(kind, name) {
  ensureSelection();
  batch(() => {
    toStyles();
    exec("styleWithCSS", true);
    if (kind === "tc") exec("foreColor", markerFor("tc", name));
    else if (!exec("hiliteColor", markerFor("hl", name))) exec("backColor", markerFor("hl", name));
    exec("styleWithCSS", false);
  });
  if (kind === "hl" && name) remember("motionLastHighlight", name);
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the default is fine */
  }
}

function recall(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

/** Cmd/Ctrl+Shift+H: highlight in the last colour used, or take the highlight off. */
function quickHighlight() {
  ensureSelection();
  const r = editorRange();
  const current = r && closestIn(r.startContainer, "[data-hl]");
  applyColor("hl", current ? null : recall("motionLastHighlight", "yellow"));
}

const colorButton = () => document.querySelector('.notes-toolbar [data-action="color"]');
export const isColorOpen = () => Boolean($("colorPopover")) && !isHidden($("colorPopover"));

function buildPalette() {
  const cap = (n) => n[0].toUpperCase() + n.slice(1);
  const noneIcon =
    '<svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M5 19 19 5"/></svg>';
  const swatch = (kind, name, label) =>
    `<button type="button" class="cp-swatch cp-${kind}" data-kind="${kind}" data-name="${name || ""}" ` +
    `${name ? `data-${kind}="${name}"` : ""} title="${label}" aria-label="${label}" aria-pressed="false">` +
    (kind === "tc" ? "A" : name ? "" : noneIcon) +
    "</button>";
  $("cpText").innerHTML =
    swatch("tc", null, "Default colour") + PALETTE.map((n) => swatch("tc", n, cap(n))).join("");
  $("cpHighlight").innerHTML =
    swatch("hl", null, "No highlight") + PALETTE.map((n) => swatch("hl", n, `${cap(n)} highlight`)).join("");
}

function openColor() {
  ensureSelection();
  const pop = $("colorPopover");
  const btn = colorButton();
  closeLinkEditor(false);
  pop.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
  markActiveSwatches();

  const rect = btn.getBoundingClientRect();
  const pad = 8;
  pop.style.left = "0px";
  pop.style.top = "0px";
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let top = rect.bottom + 6;
  // Docked above the phone keyboard, the palette opens upwards.
  if (ribbon.classList.contains("is-docked") || top + h > window.innerHeight - pad) top = rect.top - h - 6;
  pop.style.left = `${Math.round(Math.max(pad, Math.min(rect.left, window.innerWidth - w - pad)))}px`;
  pop.style.top = `${Math.round(Math.max(pad, top))}px`;
  refresh();
}

export function closeColor() {
  if (!isColorOpen()) return;
  $("colorPopover").classList.add("hidden");
  colorButton()?.setAttribute("aria-expanded", "false");
  refresh();
}

function markActiveSwatches() {
  const r = editorRange();
  const tc = (r && closestIn(r.startContainer, "[data-tc]")?.dataset.tc) || "";
  const hl = (r && closestIn(r.startContainer, "[data-hl]")?.dataset.hl) || "";
  $$("#colorPopover .cp-swatch").forEach((b) => {
    const on = b.dataset.kind === "tc" ? b.dataset.name === tc : b.dataset.name === hl;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

// ------------------------------------------------------- Markdown shortcuts ---

const BLOCK_RULES = [
  { re: /^#$/, apply: () => setBlock("h2") },
  { re: /^#{2,3}$/, apply: () => setBlock("h3") },
  { re: /^[-*+]$/, apply: () => setList("ul") },
  { re: /^1[.)]$/, apply: () => setList("ol") },
  { re: /^\[ ?\]$/, apply: () => setList("todo") },
  {
    re: /^\[x\]$/i,
    apply: () => {
      setList("todo");
      const r = editorRange();
      toggleCheck(r && closestIn(r.startContainer, "li"));
    },
  },
  { re: /^>$/, apply: () => setBlock("blockquote") },
];

const INLINE_RULES = [
  { char: "`", re: /`([^`\s](?:[^`]*[^`\s])?)`$/, tag: "code" },
  { char: "*", re: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, tag: "b" },
  { char: "~", re: /~~([^~\s](?:[^~]*[^~\s])?)~~$/, tag: "s" },
];

/** Turns "# ", "- ", "1. ", "[] ", "> ", "---" and `code` into formatting as typed. */
function autoformat(data) {
  const range = editorRange();
  if (!range || !range.collapsed) return false;

  if (data === " ") {
    const block = blockOf(range.startContainer);
    // Any text block can be retyped as another; list items cannot.
    const plain = !block || block.tagName !== "LI";
    if (!plain) return false;
    const container = block || editor;
    const prefix = textBefore(container, range).replace(/ $/, "");
    const rule = BLOCK_RULES.find((r) => r.re.test(prefix));
    if (!rule) return false;

    record("insert"); // so one undo brings the typed "# " back
    batch(() => {
      const pre = document.createRange();
      pre.setStart(container, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      pre.deleteContents();
      const host = block || editor;
      if (!host.textContent && !host.querySelector("br")) host.appendChild(document.createElement("br"));
      caretAt(host, 0);
      rule.apply();
    });
    return true;
  }

  if (data === "-") {
    const block = blockOf(range.startContainer);
    if (!block || block.tagName !== "P" || block.textContent.replace(/​/g, "") !== "---") return false;
    record("insert");
    batch(() => {
      block.textContent = "";
      block.appendChild(document.createElement("br"));
      caretAt(block, 0);
      exec("insertHorizontalRule");
    });
    return true;
  }

  const rule = INLINE_RULES.find((r) => r.char === data);
  const node = range.startContainer;
  if (!rule || node.nodeType !== 3 || closestIn(node, "code")) return false;
  const match = rule.re.exec(node.data.slice(0, range.startOffset));
  if (!match) return false;

  record("insert");
  batch(() => {
    const end = range.startOffset;
    const r = document.createRange();
    r.setStart(node, end - match[0].length);
    r.setEnd(node, end);
    r.deleteContents();
    const el = document.createElement(rule.tag);
    el.textContent = match[1];
    r.insertNode(el);
    // A zero-width space after the new element lets typing carry on outside it.
    const after = document.createTextNode(ZWSP);
    el.after(after);
    caretAt(after, 1);
  });
  return true;
}

// ---------------------------------------------------------------- keyboard ---

const atBlockStart = (block, range) => range.collapsed && textBefore(block, range) === "";

function onKeyDown(e) {
  if (!isEditable()) return;
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  const key = e.key.toLowerCase();
  const altGraph = e.getModifierState && e.getModifierState("AltGraph");

  const take = (fn) => {
    e.preventDefault();
    fn();
  };

  if (mod && !e.altKey) {
    if (key === "z") return take(e.shiftKey ? redo : undo);
    if (key === "y" && !e.shiftKey && !IS_MAC) return take(redo);
    if (!e.shiftKey) {
      const plain = { b: "bold", i: "italic", u: "underline", e: "code", "\\": "clear" }[key];
      if (plain) return take(() => run(plain));
      if (key === "enter") {
        const r = editorRange();
        const li = r && closestIn(r.startContainer, "ul.todo > li");
        if (li) return take(() => batch(() => toggleCheck(li)));
      }
    } else {
      const shifted = { KeyX: "strike", KeyS: "strike", Digit7: "ol", Digit8: "ul", Digit9: "todo" }[e.code];
      if (shifted) return take(() => run(shifted));
      if (e.code === "KeyH") return take(quickHighlight);
    }
  }

  if (mod && e.altKey && !e.shiftKey && !altGraph) {
    const heading = { Digit1: "h2", Digit2: "h3", Digit0: "p" }[e.code];
    if (heading) return take(() => run(heading));
  }

  if (mod || e.altKey || e.isComposing) return;
  const range = editorRange();
  if (!range) return;

  if (e.key === "Tab") {
    if (!closestIn(range.startContainer, "li")) return; // Tab still leaves the editor elsewhere
    return take(() => batch(() => indent(e.shiftKey)));
  }

  const block = closestIn(range.startContainer, "h2, h3, blockquote, li");

  if (e.key === "Enter" && !e.shiftKey && block && block.tagName !== "LI") {
    // Enter on an empty heading or quote ends it, instead of making another.
    if (!block.textContent.replace(/​/g, "").trim()) return take(() => batch(() => setBlock("p")));
    return;
  }

  if (e.key === "Backspace" && block && atBlockStart(block, range)) {
    // Backspace at the start of a heading, quote or list item removes the
    // formatting first, the way Docs and Notion do; a second press merges.
    if (block.tagName === "LI") return take(() => batch(() => exec("outdent")));
    return take(() => batch(() => setBlock("p")));
  }

  if (e.key === "ArrowRight" && range.collapsed) {
    // Step out of the end of inline code so typing is plain again.
    const code = closestIn(range.startContainer, "code");
    if (!code) return;
    const end = document.createRange();
    end.selectNodeContents(code);
    end.setStart(range.startContainer, range.startOffset);
    if (end.toString() !== "") return;
    const next = code.nextSibling;
    if (next && next.nodeType === 3 && next.data.length) return; // the browser can step into it
    e.preventDefault();
    const after = document.createTextNode(ZWSP);
    code.after(after);
    caretAt(after, 1);
  }
}

// ------------------------------------------------------------------- events ---

function inputKind(type = "") {
  if (type.startsWith("insert") && type !== "insertParagraph" && !type.includes("Paste") && !type.includes("Drop")) return "insert";
  if (type.startsWith("delete") && !type.includes("Drag")) return "delete";
  return "format";
}

function onInput(e) {
  if (batching || !hist) return;

  if (e.inputType === "insertText" && !e.isComposing && autoformat(e.data)) return;

  // A new checklist item starts unticked, even when split from a ticked one.
  if (e.inputType === "insertParagraph") {
    const r = editorRange();
    const li = r && closestIn(r.startContainer, "ul.todo > li");
    if (li) li.removeAttribute("data-checked");
  }

  if (e.isComposing) {
    // Mid-IME text must not be touched, or the composition breaks.
    record("insert");
    scheduleCommit();
    return;
  }
  changed(inputKind(e.inputType));
  revealCaret();
}

function onBeforeInput(e) {
  if (e.inputType === "historyUndo") {
    e.preventDefault();
    undo();
  } else if (e.inputType === "historyRedo") {
    e.preventDefault();
    redo();
  }
}

function onPaste(e) {
  if (!isEditable() || !e.clipboardData) return;
  const html = e.clipboardData.getData("text/html");
  const text = e.clipboardData.getData("text/plain");
  const range = editorRange();

  // A pasted URL links the selection, or arrives as a link itself.
  if (range && isUrl(text) && !closestIn(range.startContainer, "a, code")) {
    e.preventDefault();
    const href = safeHref(text.trim().replace(/^www\./i, "https://www."));
    batch(() => insertLinkAt(range, href, text.trim()), "paste");
    return;
  }

  // Plain text: the browser's own paste is already clean.
  if (!html) return;

  e.preventDefault();
  const clean = sanitizePaste(html);
  batch(() => {
    if (clean) exec("insertHTML", clean);
    else if (text) exec("insertText", text);
  }, "paste");
  revealCaret();
}

/** Clicks on a checklist box tick it; ⌘/Ctrl-click follows a link. */
function onMouseDown(e) {
  if (!isEditable()) return;
  const li = e.target.closest && e.target.closest("ul.todo > li");
  if (li && editor.contains(li) && e.target === li) {
    const rect = li.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(li).lineHeight) || 28;
    if (e.clientX - rect.left < 26 && e.clientY - rect.top < lineHeight) {
      e.preventDefault();
      batch(() => keepSelection(() => toggleCheck(li)));
      return;
    }
  }
}

function onClick(e) {
  const a = e.target.closest && e.target.closest("a[href]");
  if (!a || !editor.contains(a)) return;
  if (e.metaKey || e.ctrlKey || !isEditable()) {
    e.preventDefault();
    const href = safeHref(a.getAttribute("href"));
    if (href) window.open(href, "_blank", "noopener,noreferrer");
  }
}

function onSelectionChange() {
  const r = editorRange();
  if (r) {
    savedRange = r.cloneRange();
    if (hist) hist.current.sel = saveSel();
  }
  refresh();
}

// -------------------------------------------------------------------- setup ---

/**
 * Puts a page in the editor. Keeps the page's undo history when it is the same
 * content the editor last held for it (just switching notes back and forth).
 */
export function load(page) {
  flush();
  closeLinkEditor(false);
  closeColor();

  if (!page) {
    editor.innerHTML = "";
    editor.contentEditable = "false";
    editor.setAttribute("data-placeholder", "Create a page from the sidebar to get started.");
    hist = null;
    savedRange = null;
    refresh();
    return;
  }

  editor.contentEditable = "true";
  editor.setAttribute("data-placeholder", "Start writing, or type # for a heading, - for a list, [] for a checklist…");
  editor.innerHTML = page.content;
  normalize();

  const known = histories.get(page.id);
  if (known && known.current.html === editor.innerHTML) {
    hist = known;
  } else {
    hist = newHistory();
    histories.set(page.id, hist);
  }
  savedRange = null;
  refresh();
}

export function forget(pageId) {
  histories.delete(pageId);
}

/** Moves the caret to the start of the note (from the title's Enter key). */
export function focusStart() {
  if (!isEditable()) return;
  editor.focus({ preventScroll: true });
  caretAt(editor.firstChild || editor, 0);
  revealCaret();
}

export function mount({ commit }) {
  onCommit = commit;
  editor = $("pageContent");
  ribbon = $("notesRibbon");
  sentinel = $("notesRibbonSentinel");
  popover = $("linkPopover");

  // Enter makes <p>, like every other paragraph, not Chrome's default <div>.
  exec("defaultParagraphSeparator", "p");
  exec("styleWithCSS", false);

  labelButtons();

  // Keep the caret where it is: a mousedown on a button would otherwise move
  // focus there and the command would apply to nothing.
  ribbon.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
  ribbon.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (btn && !btn.disabled) run(btn.dataset.action);
  });

  editor.addEventListener("keydown", onKeyDown);
  editor.addEventListener("beforeinput", onBeforeInput);
  editor.addEventListener("input", onInput);
  editor.addEventListener("paste", onPaste);
  editor.addEventListener("mousedown", onMouseDown);
  editor.addEventListener("click", onClick);
  editor.addEventListener("focus", refresh);
  editor.addEventListener("blur", () => {
    flush();
    refresh();
  });
  document.addEventListener("selectionchange", onSelectionChange);

  // Pinned-state styling follows scrolling — of .content on desktop, of the
  // page itself on phones — so listen for any scroll.
  document.addEventListener("scroll", refresh, { capture: true, passive: true });
  window.addEventListener("resize", refresh);
  window.visualViewport?.addEventListener("resize", () => {
    refresh();
    requestAnimationFrame(revealCaret);
  });
  window.visualViewport?.addEventListener("scroll", refresh);

  // Colour palette.
  buildPalette();
  const pop = $("colorPopover");
  pop.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
  pop.addEventListener("click", (e) => {
    const sw = e.target.closest(".cp-swatch");
    if (!sw) return;
    applyColor(sw.dataset.kind, sw.dataset.name || null);
    closeColor();
  });
  document.addEventListener("mousedown", (e) => {
    if (isColorOpen() && !pop.contains(e.target) && !colorButton().contains(e.target)) closeColor();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && isColorOpen()) {
        e.stopPropagation();
        closeColor();
      }
    },
    true
  );

  // Link card / editor.
  $("linkForm").addEventListener("submit", (e) => {
    e.preventDefault();
    applyLink($("linkInput").value);
  });
  $("linkInput").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeLinkEditor(true);
    }
  });
  $("linkRemoveBtn").addEventListener("click", removeLink);
  $("linkEditBtn").addEventListener("mousedown", (e) => e.preventDefault());
  $("linkEditBtn").addEventListener("click", openLinkEditor);
  $("linkUnlinkBtn").addEventListener("mousedown", (e) => e.preventDefault());
  $("linkUnlinkBtn").addEventListener("click", () => {
    const r = editorRange();
    const anchor = r && closestIn(r.startContainer, "a");
    if (!anchor) return;
    linkTarget = { range: r.cloneRange(), anchor };
    removeLink();
  });
  // The card's buttons must not take focus from the editor, or the card would
  // close (caret left the link) before their click lands.
  popover.addEventListener("mousedown", (e) => {
    if (popover.dataset.mode === "view") e.preventDefault();
  });
  document.addEventListener("mousedown", (e) => {
    if (isLinkEditorOpen() && !popover.contains(e.target)) closeLinkEditor(false);
  });

  // Never lose the last few keystrokes to a closed tab or a backgrounded app.
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Called when the notes view is shown, so the ribbon reflects the page. */
export function refreshRibbon() {
  if (editor) refresh();
}
