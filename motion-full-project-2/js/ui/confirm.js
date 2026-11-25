import { $, esc } from "../dom.js";
import * as modal from "./modal.js";

/* Promise-based confirmation.
   The browser's own confirm() blocks the main thread, cannot be styled, and on
   mobile reads as a browser warning rather than part of the app — so this is a
   real dialog that resolves true/false and inherits the focus trap in modal.js.

   Undo is still offered afterwards: confirming is easy to do on reflex, so the
   two protections are complementary rather than redundant. */

let resolver = null;

function settle(answer) {
  const resolve = resolver;
  resolver = null;
  modal.close("confirmOverlay");
  resolve?.(answer);
}

export const isConfirmOpen = () => modal.isOpen("confirmOverlay");
export const cancel = () => settle(false);

/**
 * @param {{title: string, message?: string, confirmLabel?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>}
 */
export function ask({ title, message = "", confirmLabel = "Delete", danger = true }) {
  // A second prompt while one is pending would strand the first promise.
  if (resolver) settle(false);

  $("confirmTitle").textContent = title;
  $("confirmMessage").innerHTML = message ? esc(message) : "";
  $("confirmMessage").classList.toggle("hidden", !message);

  const okBtn = $("confirmOkBtn");
  okBtn.textContent = confirmLabel;
  okBtn.className = danger ? "btn danger" : "btn";

  return new Promise((resolve) => {
    resolver = resolve;
    // Focus lands on Cancel, so a stray Enter or Space does not destroy anything.
    modal.open("confirmOverlay", "confirmCancelBtn");
  });
}

export function mount() {
  $("confirmOkBtn").addEventListener("click", () => settle(true));
  $("confirmCancelBtn").addEventListener("click", cancel);

  $("confirmOverlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) cancel();
  });
}
