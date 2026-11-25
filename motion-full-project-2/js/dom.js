/** Small helpers shared by every view. */

export const $ = (id) => document.getElementById(id);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Escapes text before it goes into an innerHTML string.
 *
 * Views build markup as strings, so anything the user typed — a task called
 * `<img onerror=...>`, a class named `"&"` — must be escaped on the way in or it
 * becomes live markup. The one deliberate exception is note content, which is
 * rich text the editor itself produced.
 */
export function esc(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

export function show(el, visible) {
  el.classList.toggle("hidden", !visible);
}

export const isHidden = (el) => el.classList.contains("hidden");
