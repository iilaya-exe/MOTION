import { check, group, makeDom, settle } from "./harness.js";

/* The assertions, kept apart from however they are launched: tests.html drives
   an iframe, but the same suite can be pointed at any window running the app.
   Everything goes through the DOM — clicking, typing, reading what is rendered
   — so it stays honest about what a user would actually get. */

export async function suite(win) {
  const d = makeDom(win);
  const { q, qa, click, setValue, key, tick } = d;


  
  // ---------------------------------------------------------------- boot ---
  group("Boot");
  check("loader is dismissed", q("#loadingOverlay").classList.contains("hidden"));
  check("dashboard is the default view", d.view()?.id === "view-dashboard", d.view()?.id);
  check("exactly one view visible", qa(".view:not(.hidden)").length === 1);
  check("no modal open", !d.openModal());
  check("isolated test database in use", win.location.search.includes("e2e"));
  check("workspace starts empty of classes", !q("#allClassesTable tbody tr"));

  // -------------------------------------------------------------- routing ---
  group("Routing (#3)");
  check("boot normalised the hash", win.location.hash === "#/dashboard", win.location.hash);

  d.nav("Tasks");
  await settle();
  check("clicking a nav item sets the hash", win.location.hash === "#/tasks", win.location.hash);
  check("and switches the view", d.view()?.id === "view-tasks", d.view()?.id);

  win.location.hash = "#/calendar";
  await settle(80);
  check("setting the hash directly switches the view", d.view()?.id === "view-calendar", d.view()?.id);

  win.history.back();
  await settle(140);
  check("back button returns to the previous view", d.view()?.id === "view-tasks", d.view()?.id);

  win.location.hash = "#/nonsense";
  await settle(80);
  check("an unknown route falls back to the dashboard", d.view()?.id === "view-dashboard", d.view()?.id);

  // ---------------------------------------------------------------- tasks ---
  group("Tasks — recurring (#5)");
  d.nav("Tasks");
  await settle();

  setValue(q("#taskTextInput"), "Weekly reading");
  setValue(q("#taskDueInput"), "2026-08-10");
  click(q("#addTaskBtn"));
  await settle();
  check("task created", q(".task-row .task-text")?.textContent === "Weekly reading",
    q("#taskList").textContent);
  check("repeat column present", q(".task-head").textContent.includes("Repeat"),
    q(".task-head").textContent);
  check("new tasks do not repeat", q(".badge.ghost"), "no Once chip");

  const repeatSel = q("select[data-action=set-repeat]");
  setValue(repeatSel, "weekly", "change");
  await settle();
  check("repeat set to weekly", q(".badge.repeat-on")?.textContent.includes("Weekly"),
    q(".badge.repeat-on")?.textContent);

  const before = q("input[data-action=set-due]").value;
  tick(q(".task-row input[type=checkbox]"));
  await settle();
  const after = q("input[data-action=set-due]")?.value;
  check("completing a repeating task rolls the date forward", after && after !== before,
    `${before} -> ${after}`);
  check("…exactly one week", Math.round((new Date(after) - new Date(before)) / 86400000) === 7,
    `${before} -> ${after}`);
  check("…and it stays open rather than completing", !q(".task-row.done"), "row marked done");

  // clearing the repeat when the date is removed
  setValue(q("input[data-action=set-due]"), "", "change");
  await settle();
  check("removing the date drops the repeat rule", q(".badge.ghost"), q("#taskList").textContent);

  // ----------------------------------------------------------------- undo ---
  group("Undo (#5)");
  click(q('[data-action="delete-task"]'));
  await settle();
  check("task deleted without a confirm dialog", !q(".task-row"), q("#taskList").textContent);
  check("undo toast shown", !q("#undoToast").classList.contains("hidden"));
  check("toast names what was deleted", q("#undoToast").textContent.includes("Weekly reading"),
    q("#undoToast").textContent);

  click(q('#undoToast [data-action="undo"]'));
  await settle();
  check("undo restores the task", q(".task-row .task-text")?.textContent === "Weekly reading",
    q("#taskList").textContent);
  check("toast hides after undo", q("#undoToast").classList.contains("hidden"));

  click(q('[data-action="delete-task"]'));
  await settle();
  click(q('#undoToast [data-action="dismiss"]'));
  await settle();
  check("dismiss closes the toast", q("#undoToast").classList.contains("hidden"));
  check("dismissed delete stays deleted", !q(".task-row"));

  // ---------------------------------------------------------------- notes ---
  group("Notes — search & edited stamp (#4)");
  d.nav("Home");
  await settle();
  click(q("#pageList .page-item"));
  await settle();
  check("notes view opened", d.view()?.id === "view-notes", d.view()?.id);
  check("route carries the page id", win.location.hash.startsWith("#/notes/"), win.location.hash);
  check("welcome content loaded", q("#pageContent").innerHTML.includes("Welcome to Motion"));
  check("edited stamp shown", /Edited/.test(q("#pageMeta").textContent), q("#pageMeta").textContent);

  const noteRoute = win.location.hash;
  win.location.hash = "#/tasks";
  await settle(80);
  win.location.hash = noteRoute;
  await settle(80);
  check("a note route is bookmarkable", d.view()?.id === "view-notes" && q("#pageTitleInput").value === "Welcome",
    q("#pageTitleInput").value);

  click(q("#newPageBtn"));
  await settle();
  setValue(q("#pageTitleInput"), "Chemistry lab");
  await settle();
  check("second page created", qa("#pageList .page-item").length === 2,
    String(qa("#pageList .page-item").length));

  setValue(q("#pageSearch"), "chemistry");
  await settle();
  check("search filters by title", qa("#pageList .page-item").length === 1,
    q("#pageList").textContent);

  setValue(q("#pageSearch"), "toolbar above");
  await settle();
  check("search also matches note body text", qa("#pageList .page-item").length === 1 &&
    q("#pageList").textContent.includes("Welcome"), q("#pageList").textContent);

  setValue(q("#pageSearch"), "zzzz");
  await settle();
  check("no match shows a hint", q("#pageList .empty-hint"), q("#pageList").textContent);
  setValue(q("#pageSearch"), "");
  await settle();

  click(q("#deletePageBtn"));
  await settle();
  check("deleting a page offers undo", !q("#undoToast").classList.contains("hidden"),
    q("#undoToast").textContent);
  click(q('#undoToast [data-action="undo"]'));
  await settle();
  check("undo restores the page", qa("#pageList .page-item").length === 2,
    String(qa("#pageList .page-item").length));

  // ------------------------------------------------------------ modal a11y ---
  group("Modal focus (#5)");
  d.nav("Schedule");
  await settle();
  const addClassBtn = q("#addClassBtn");
  addClassBtn.focus();
  click(addClassBtn);
  await settle();
  check("class editor opened", d.openModal()?.id === "classModalOverlay", d.openModal()?.id);
  check("focus moved into the dialog", d.doc.activeElement?.id === "classSubjectInput",
    d.doc.activeElement?.id);

  // Tab from the last focusable element must wrap to the first, not escape.
  const focusables = [...d.openModal().querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => el.offsetParent !== null);
  focusables[focusables.length - 1].focus();
  key(d.doc.activeElement, "Tab");
  await settle();
  check("Tab wraps inside the dialog", d.openModal().contains(d.doc.activeElement),
    d.doc.activeElement?.tagName);

  key(d.doc.activeElement, "Escape");
  await settle();
  check("escape closes the dialog", !d.openModal());
  check("focus returns to the button that opened it", d.doc.activeElement === addClassBtn,
    d.doc.activeElement?.id);

  // ------------------------------------------------------------ persistence ---
  group("Persistence");
  await settle(200);
  const stored = await new Promise((resolve) => {
    const req = win.indexedDB.open("MotionDB_e2e");
    req.onsuccess = () => {
      const g = req.result.transaction("appState", "readonly").objectStore("appState").get("state");
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
  check("state written to the test database", stored && Array.isArray(stored.pages));
  check("restored page persisted", stored?.pages?.length === 2, String(stored?.pages?.length));
  check("pages carry an updatedAt", stored?.pages?.every((p) => typeof p.updatedAt === "number"));
  check("tasks carry a repeat field", stored?.tasks?.every((t) => "repeat" in t));
}
