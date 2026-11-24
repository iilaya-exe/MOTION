/* Rich-text hygiene for the note editor.

   Notes are stored as the editor's own HTML, so everything that reaches storage
   should be markup the editor itself could have produced: a short list of block
   and inline tags, no inline styles, no classes beyond the checklist marker.
   Two ways foreign markup gets in, and both are handled here:
     - paste: web pages, Google Docs and Word put fonts, colours and layout
       wrappers on everything, so pasted HTML is rebuilt from a whitelist;
     - the browser itself: Chrome wraps text in <span style="font-size:…"> when
       one block is merged into another, so live content is tidied too. */

/** The note colour palette. Stored as names (data-tc / data-hl), never as
    raw colours, so each one can have its own light- and dark-theme shade. */
export const PALETTE = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const isPaletteName = (v) => PALETTE.includes(v);

/** Blocks a pasted element may become. Anything not listed is unwrapped. */
const BLOCKS = {
  H1: "h2", H2: "h2", H3: "h3", H4: "h3", H5: "h3", H6: "h3",
  P: "p", DIV: "p", SECTION: "p", ARTICLE: "p", HEADER: "p", FOOTER: "p",
  BLOCKQUOTE: "blockquote", PRE: "p", TR: "p", DT: "p", DD: "p", FIGCAPTION: "p",
  UL: "ul", OL: "ol", LI: "li",
};

const INLINE = {
  B: "b", STRONG: "b",
  I: "i", EM: "i", CITE: "i",
  U: "u", INS: "u",
  S: "s", STRIKE: "s", DEL: "s",
  CODE: "code", KBD: "code", TT: "code", SAMP: "code",
  A: "a",
};

/** Never worth keeping, contents included. */
const DROP = new Set([
  "SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "NOSCRIPT", "TEMPLATE",
  "IMG", "PICTURE", "VIDEO", "AUDIO", "SOURCE", "SVG", "CANVAS", "IFRAME", "OBJECT",
  "EMBED", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "FORM", "LABEL",
]);

/** Tags that start a new line when they end up inside a block that cannot hold them. */
const BLOCK_OUT = new Set(["p", "h2", "h3", "blockquote", "ul", "ol", "li", "hr"]);

/** Links may only point somewhere a click is safe to follow. */
export function safeHref(raw) {
  const href = String(raw || "").trim();
  if (!href) return "";
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  if (/^#/.test(href)) return "";
  // "example.com/page" — what people actually type into a link box.
  if (/^[\w-]+(\.[\w-]+)+([/?#:].*)?$/i.test(href)) return `https://${href}`;
  return "";
}

/** True for text that is a single link and nothing else. */
export function isUrl(text) {
  return /^(https?:\/\/|www\.)\S+$/i.test(String(text || "").trim());
}

/** Formatting a <span style> carries — how Docs and most web pages express it. */
function styleMarks(el) {
  const s = el.style;
  if (!s) return [];
  const marks = [];
  const weight = s.fontWeight;
  if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) marks.push("b");
  if (s.fontStyle === "italic") marks.push("i");
  const deco = `${s.textDecoration} ${s.textDecorationLine}`;
  if (/underline/.test(deco)) marks.push("u");
  if (/line-through/.test(deco)) marks.push("s");
  if (/mono|courier|consolas/i.test(s.fontFamily)) marks.push("code");
  return marks;
}

/** Google Docs wraps a whole paste in <b style="font-weight:normal">. */
function isFakeBold(el) {
  const w = el.style?.fontWeight;
  return el.tagName === "B" && (w === "normal" || w === "400");
}

/**
 * Rebuilds pasted HTML from the whitelist above.
 * @returns {string} HTML safe to hand to insertHTML, or "" if nothing survives
 */
export function sanitizePaste(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const out = document.createElement("div");

  // Word marks list items with <p class="MsoListParagraph">; they read fine as
  // paragraphs, so no special handling beyond the whitelist.
  convertChildren(doc.body, out, { pre: false });
  fixStructure(out);

  return out.innerHTML.trim();
}

function convertChildren(from, to, ctx) {
  for (const node of [...from.childNodes]) convertNode(node, to, ctx);
}

function convertNode(node, to, ctx) {
  if (node.nodeType === 3) {
    let text = node.data;
    if (ctx.pre) {
      // Preformatted text keeps its lines as line breaks.
      text.split("\n").forEach((line, i) => {
        if (i) to.appendChild(document.createElement("br"));
        if (line) to.appendChild(document.createTextNode(line));
      });
      return;
    }
    text = text.replace(/[\t\n\r ]+/g, " ");
    if (text) to.appendChild(document.createTextNode(text));
    return;
  }
  if (node.nodeType !== 1) return; // comments, processing instructions

  const tag = node.tagName.toUpperCase();
  if (DROP.has(tag)) return;

  if (tag === "BR") return void to.appendChild(document.createElement("br"));
  if (tag === "HR") return void to.appendChild(document.createElement("hr"));

  const pre = ctx.pre || tag === "PRE";
  const block = BLOCKS[tag];

  if (block) {
    const el = document.createElement(block);
    if (block === "ul" && node.classList?.contains("todo")) el.className = "todo";
    if (block === "li" && node.getAttribute("data-checked") === "true") el.setAttribute("data-checked", "true");
    convertChildren(node, el, { pre });
    to.appendChild(el);
    return;
  }

  if (tag === "TD" || tag === "TH") {
    convertChildren(node, to, ctx);
    to.appendChild(document.createTextNode(" "));
    return;
  }

  let target = to;
  const wrap = (name, attrs) => {
    const el = document.createElement(name);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    target.appendChild(el);
    target = el;
  };

  const inline = isFakeBold(node) ? null : INLINE[tag];
  if (inline === "a") {
    const href = safeHref(node.getAttribute("href"));
    if (href) wrap("a", { href });
  } else if (inline) {
    wrap(inline);
  }
  styleMarks(node).forEach((m) => {
    if (m !== inline) wrap(m);
  });

  // Colours survive a copy and paste between Motion notes.
  const tc = node.getAttribute("data-tc");
  const hl = node.getAttribute("data-hl");
  if (isPaletteName(tc) || isPaletteName(hl)) {
    const attrs = {};
    if (isPaletteName(tc)) attrs["data-tc"] = tc;
    if (isPaletteName(hl)) attrs["data-hl"] = hl;
    wrap("span", attrs);
  }

  convertChildren(node, target, { pre });
}

/** Makes the converted tree valid editor content: blocks at the root, lists of <li>. */
function fixStructure(root) {
  // Inline-only blocks: a block nested in a paragraph, heading or quote becomes
  // a line break there, so nothing is lost and nothing nests oddly.
  root.querySelectorAll("p, h2, h3, blockquote").forEach(flattenBlock);

  // List items keep nested lists but flatten any other block.
  root.querySelectorAll("li").forEach((li) => {
    [...li.children].forEach((child) => {
      const name = child.tagName.toLowerCase();
      if (name === "ul" || name === "ol") return;
      if (BLOCK_OUT.has(name)) unwrapWithBreak(child);
    });
  });

  // Lists hold only items.
  root.querySelectorAll("ul, ol").forEach((list) => {
    let pending = null;
    [...list.childNodes].forEach((n) => {
      const isItem = n.nodeType === 1 && /^(LI|UL|OL)$/.test(n.tagName);
      if (isItem) {
        pending = null;
        return;
      }
      if (n.nodeType === 3 && !n.data.trim()) return n.remove();
      if (!pending) {
        pending = document.createElement("li");
        list.insertBefore(pending, n);
      }
      pending.appendChild(n);
    });
  });

  // Items outside a list get one.
  [...root.querySelectorAll("li")].forEach((li) => {
    if (li.parentElement && /^(UL|OL)$/.test(li.parentElement.tagName)) return;
    const ul = document.createElement("ul");
    li.before(ul);
    ul.appendChild(li);
    while (ul.nextSibling?.nodeName === "LI") ul.appendChild(ul.nextSibling);
  });

  // Runs of inline content at the root become paragraphs.
  let run = null;
  [...root.childNodes].forEach((n) => {
    const isBlock = n.nodeType === 1 && BLOCK_OUT.has(n.tagName.toLowerCase());
    if (isBlock) {
      run = null;
      return;
    }
    if (n.nodeType === 1 && n.tagName === "BR" && !run) return n.remove();
    if (!run) {
      run = document.createElement("p");
      root.insertBefore(run, n);
    }
    run.appendChild(n);
  });

  // Tidy edges and drop blocks that ended up empty.
  root.querySelectorAll("p, h2, h3, blockquote, li").forEach((el) => {
    trimEdges(el);
    while (el.lastChild?.nodeName === "BR" && el.childNodes.length > 1) el.lastChild.remove();
    if (!el.textContent.trim() && !el.querySelector("ul, ol")) el.remove();
  });
  root.querySelectorAll("ul, ol").forEach((l) => {
    if (!l.querySelector("li")) l.remove();
  });
  root.querySelectorAll("b, i, u, s, code, a, span").forEach((el) => {
    if (!el.textContent) el.remove();
  });
}

function flattenBlock(el) {
  [...el.children].forEach((child) => {
    if (BLOCK_OUT.has(child.tagName.toLowerCase())) {
      flattenBlock(child);
      unwrapWithBreak(child);
    }
  });
}

function unwrapWithBreak(el) {
  const parent = el.parentNode;
  if (el.previousSibling && el.previousSibling.nodeName !== "BR") {
    parent.insertBefore(document.createElement("br"), el);
  }
  if (el.tagName === "HR") return el.remove();
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}

function trimEdges(el) {
  const first = firstText(el);
  if (first) first.data = first.data.replace(/^ +/, "");
  const last = lastText(el);
  if (last) last.data = last.data.replace(/ +$/, "");
}

function firstText(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return w.nextNode();
}

function lastText(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n = null;
  let cur;
  while ((cur = w.nextNode())) n = cur;
  return n;
}

/**
 * Serialises live editor HTML for storage: strips the zero-width spaces the
 * editor uses to step the caret out of inline code, and any styling the browser
 * slipped in.
 */
export function cleanHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html || "").replace(/​/g, "");
  const root = tpl.content;
  root.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));
  // Colour spans are the editor's own; any other span is browser residue.
  root.querySelectorAll("span:not([data-tc]):not([data-hl]), font").forEach((el) => el.replaceWith(...el.childNodes));
  const div = document.createElement("div");
  div.appendChild(root);
  return div.innerHTML;
}

/** Word count of rich text, for the meta line and the PDF header. */
export function countWords(html) {
  const text = String(html || "")
    .replace(/<\/(p|h2|h3|li|blockquote|div)>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;| /g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, "x")
    .replace(/​/g, "");
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
