import { relativeTime } from "./dates.js";

/* Notes → PDF.
   Rendered through the browser's own print pipeline rather than a PDF library:
   no dependency to ship or cache, and the output is real selectable vector text
   with automatic pagination, hyphenation and font handling — all of which a
   hand-rolled writer or a canvas raster would lose.

   The visible app is not what gets printed. A separate sheet is built here and
   print.css hides everything else, so page breaks fall on the document's own
   structure instead of on app chrome. */

/** Rough word count from rich text, for the document meta line. */
function wordCount(html) {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/gi, " ");
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/** Filenames cannot carry slashes or colons, and browsers use the title as one. */
const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();

function buildSheet(page) {
  const title = page.title?.trim() || "Untitled";
  const words = wordCount(page.content || "");
  const edited = page.updatedAt ? `Edited ${relativeTime(page.updatedAt)}` : "";

  const printedOn = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const meta = [edited, `${words} word${words === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  return (
    '<article class="ps-doc">' +
    '<header class="ps-head">' +
    '<span class="ps-brand">Motion</span>' +
    `<span class="ps-printed">${escapeHtml(printedOn)}</span>` +
    "</header>" +
    `<h1 class="ps-title">${escapeHtml(title)}</h1>` +
    (meta ? `<p class="ps-meta">${escapeHtml(meta)}</p>` : "") +
    // The note's own rich text, exactly as the editor produced it.
    `<div class="ps-body">${page.content || '<p class="ps-empty">This note is empty.</p>'}</div>` +
    `<footer class="ps-foot">${escapeHtml(title)}</footer>` +
    "</article>"
  );
}

/**
 * Opens the print dialog with just this note laid out as a document.
 * "Save as PDF" in that dialog is the PDF export.
 *
 * @returns {boolean} false if there was nothing to print
 */
export function printNote(page, { print = () => window.print() } = {}) {
  if (!page) return false;

  const sheet = document.getElementById("printSheet");
  if (!sheet) return false;

  sheet.innerHTML = buildSheet(page);

  // Browsers seed the PDF filename from document.title, so this is the only
  // lever available for naming the file.
  const originalTitle = document.title;
  document.title = safeName(page.title?.trim() || "Untitled") + " — Motion";

  const restore = () => {
    document.title = originalTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  // Safari has historically not fired afterprint reliably; do not strand the tab title.
  setTimeout(restore, 60000);

  print();
  return true;
}
