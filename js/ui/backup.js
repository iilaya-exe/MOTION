import { store } from "../store.js";
import { $ } from "../dom.js";
import { ask } from "./confirm.js";
import { sanitizeState } from "../lib/defaults.js";

/* Export / import.
   Browser storage is scoped per origin, so the same app served from two
   addresses keeps two entirely separate workspaces with no way to reach across.
   A file is the one thing that can: it moves between origins, browsers, devices
   and backups, and it is the only real answer to "where did my data go". */

const FORMAT = "motion-backup";
const VERSION = 1;

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function exportData() {
  const payload = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
    state: store.state,
  };

  download(
    `motion-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2)
  );
}

/** Human summary of a backup, so the confirmation says what is about to land. */
function describe(state) {
  const items = [
    [state.tasks?.length, "task"],
    [state.classes?.length, "class", "classes"],
    [state.pages?.length, "note"],
    [state.checklists?.length, "checklist"],
    [state.eventsList?.length, "event"],
  ];

  return items
    .filter(([n]) => n)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many || one + "s"}`)
    .join(", ");
}

export async function importFile(file) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    await ask({
      title: "That file could not be read",
      message: "It does not look like JSON. Pick the .json file Motion exported.",
      confirmLabel: "OK",
      danger: false,
    });
    return false;
  }

  // Accept a bare state object too — an older export, or a hand-edited file.
  const incoming = payload?.state && typeof payload.state === "object" ? payload.state : payload;

  if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.tasks)) {
    await ask({
      title: "That is not a Motion backup",
      message: "The file is valid JSON but does not contain a workspace.",
      confirmLabel: "OK",
      danger: false,
    });
    return false;
  }

  const clean = sanitizeState(incoming);
  const summary = describe(clean) || "an empty workspace";
  const current = describe(store.state) || "an empty workspace";

  const ok = await ask({
    title: "Replace this workspace?",
    message:
      `The file holds ${summary}. It will replace what is here now (${current}). ` +
      "This cannot be undone, so export the current workspace first if you want to keep it.",
    confirmLabel: "Replace",
  });
  if (!ok) return false;

  store.state = clean;
  store.save();

  // A reload is the honest way to re-render everything at once: every view
  // caches its own DOM, and re-rendering them piecemeal invites stale corners.
  setTimeout(() => window.location.reload(), 120);
  return true;
}

export function mount() {
  $("exportDataBtn").addEventListener("click", exportData);

  $("importDataInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again after a cancel
    if (file) await importFile(file);
  });
}
