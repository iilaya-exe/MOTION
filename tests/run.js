import { check, getResults, ready } from "./harness.js";
import { suite } from "./suite.js";

const frame = document.getElementById("stage");

/* The suite talks to the app only through the DOM — clicking, typing, reading
   what is rendered — so it stays honest about what a user would actually get. */

async function run() {
  const win = frame.contentWindow;
  await ready(win);
  await suite(win);
  render();
}

// ------------------------------------------------------------------ report ---
function render() {
  const list = document.getElementById("results");
  const rows = getResults();
  const checks = rows.filter((r) => !r.group);
  const failed = checks.filter((r) => !r.ok);

  list.innerHTML = rows
    .map((r) => {
      if (r.group) return `<li class="group">${r.group}</li>`;
      const detail = r.ok ? "" : `<span class="why">${escapeHtml(r.detail)}</span>`;
      return (
        `<li class="${r.ok ? "ok" : "no"}"><span class="tag">${r.ok ? "PASS" : "FAIL"}</span>` +
        `<span>${escapeHtml(r.name)} ${detail}</span></li>`
      );
    })
    .join("");

  const summary = document.getElementById("summary");
  summary.className = failed.length ? "fail" : "pass";
  summary.textContent = failed.length
    ? `${failed.length} of ${checks.length} checks failed`
    : `All ${checks.length} checks passed`;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

frame.addEventListener("load", () => {
  run().catch((err) => {
    check("suite ran to completion", false, err.message);
    render();
    console.error(err);
  });
}, { once: true });
