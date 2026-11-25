/* Minimal test harness. No dependencies, no build — open tests.html.

   Everything drives the real app inside an iframe, so what is asserted is what
   a browser actually renders, not a mock of it. */

const results = [];
let currentGroup = "";

export function group(name) {
  currentGroup = name;
  results.push({ group: name });
}

export function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail: condition ? "" : String(detail ?? "") });
}

export const getResults = () => results;

/** Resolves once the app inside the frame has booted and hidden its loader. */
export function ready(win, timeout = 8000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    (function poll() {
      const overlay = win.document?.getElementById("loadingOverlay");
      if (overlay?.classList.contains("hidden")) return resolve();
      if (Date.now() - started > timeout) return reject(new Error("app did not boot in time"));
      setTimeout(poll, 40);
    })();
  });
}

/** One animation frame plus a tick — enough for a synchronous re-render. */
export const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

export function makeDom(win) {
  const doc = win.document;

  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];

  const click = (el) => el?.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

  /** Sets a value the way a user would, then fires the event the app listens for. */
  const setValue = (el, value, event = "input") => {
    const proto =
      el.tagName === "SELECT" ? win.HTMLSelectElement.prototype
      : el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype
      : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new win.Event(event, { bubbles: true }));
  };

  const key = (el, k, opts = {}) =>
    el.dispatchEvent(new win.KeyboardEvent("keydown", { key: k, bubbles: true, ...opts }));

  const tick = (el, checked = true) => {
    el.checked = checked;
    el.dispatchEvent(new win.Event("change", { bubbles: true }));
  };

  /** Clicks through the app's confirmation dialog; `false` cancels instead. */
  const confirmDialog = async (accept = true) => {
    await new Promise((r) => setTimeout(r, 40));
    const overlay = doc.getElementById("confirmOverlay");
    if (!overlay || overlay.classList.contains("hidden")) return false;
    click(doc.getElementById(accept ? "confirmOkBtn" : "confirmCancelBtn"));
    await new Promise((r) => setTimeout(r, 40));
    return true;
  };

  return {
    doc, q, qa, click, setValue, key, tick, confirmDialog,
    openModal: () => q(".modal-overlay:not(.hidden)"),
    view: () => q(".view:not(.hidden)"),
    nav: (label) => click(qa(".nav-item").find((b) => b.textContent.trim() === label)),
  };
}
