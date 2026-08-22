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

  // ------------------------------------------------------- schedule spine ---
  group("Schedule spine — subject link");
  d.nav("Schedule");
  await settle();
  click(q("#addClassBtn"));
  await settle();
  setValue(q("#classSubjectInput"), "Psychology");
  setValue(q("#classRoomInput"), "Room 14");
  setValue(q("#classStartInput"), "09:00");
  setValue(q("#classEndInput"), "10:30");
  // Every weekday on, so the class always meets "today" whenever this runs.
  qa("#classDayToggle button").forEach((b) => { if (!b.classList.contains("on")) click(b); });
  click(q("#classSaveBtn"));
  await settle();
  check("class created", q("#allClassesTable tbody tr[data-id]"), q("#allClassesTable").textContent);
  check("schedule table has a Tasks column",
    q("#allClassesTable thead").textContent.includes("Tasks"), q("#allClassesTable thead").textContent);

  d.nav("Tasks");
  await settle();
  check("Subject column in the header",
    q(".task-head").textContent.includes("Subject"), q(".task-head").textContent);
  check("a task with no subject shows the ghost chip", q(".task-row .badge.ghost"));

  const subjSel = q("select[data-action=set-subject]");
  check("subject picker lists the class",
    [...subjSel.options].some((o) => o.textContent.includes("Psychology")),
    [...subjSel.options].map((o) => o.textContent).join(","));

  setValue(subjSel, [...subjSel.options].find((o) => o.textContent.includes("Psychology")).value, "change");
  await settle();
  check("subject chip renders with the class colour",
    q(".task-row .badge.subject-chip")?.textContent.includes("Psychology"),
    q(".task-row")?.textContent);

  // The repeat test cleared this task's date, and Today only shows what is due
  // today — so give it one before expecting it on the timeline.
  const todayKey = new Date().toLocaleDateString("en-CA");
  setValue(q("input[data-action=set-due]"), todayKey, "change");
  await settle();
  check("due date set to today", q("input[data-action=set-due]")?.value === todayKey,
    q("input[data-action=set-due]")?.value);

  // Clearing the date earlier also cleared the repeat rule, so re-arm it —
  // which doubles as a check that a repeat can be set once a date exists again.
  setValue(q("select[data-action=set-repeat]"), "weekly", "change");
  await settle();
  check("repeat can be re-armed once a date exists", q(".badge.repeat-on"),
    q(".task-row")?.textContent);

  setValue(q("#taskGroupBy"), "subject", "change");
  await settle();
  check("can group by subject",
    qa(".group-name").some((g) => g.textContent.includes("Psychology")),
    qa(".group-name").map((g) => g.textContent).join(","));
  setValue(q("#taskGroupBy"), "due", "change");
  await settle();

  d.nav("Schedule");
  await settle();
  check("the class now shows its open task count", q(".class-row .task-count"),
    q("#dayClassList").textContent);

  // ------------------------------------------------------- UI refresh + timer ---
  group("Class timer & visuals");

  // Pick an emoji for the class created above, then check it surfaces.
  d.nav("Schedule");
  await settle();
  click(q(".class-row"));
  await settle();
  check("emoji picker rendered", qa("#classEmojiRow .emoji-opt").length > 5,
    String(qa("#classEmojiRow .emoji-opt").length));
  click(qa("#classEmojiRow .emoji-opt").find((b) => b.dataset.emoji === "📘"));
  await settle();
  // The picker re-renders on select, so re-query rather than reusing the node.
  check("emoji selection marked",
    qa("#classEmojiRow .emoji-opt").find((b) => b.dataset.emoji === "📘")?.classList.contains("on"),
    qa("#classEmojiRow .emoji-opt.on").map((b) => b.dataset.emoji).join(","));
  click(q("#classSaveBtn"));
  await settle();
  check("emoji shows on the class row", q(".class-row .class-emoji")?.textContent === "📘",
    q(".class-row")?.textContent);
  check("class shows a status pill", q(".class-row .cls-status"), q(".class-row")?.textContent);

  // A class inside the one-hour window makes the countdown deterministic.
  const now = new Date();
  const hour = now.getHours();
  if (hour >= 23 || hour < 1) {
    check("timer window test skipped near midnight (would cross days)", true);
  } else {
    const pad = (n) => String(n).padStart(2, "0");
    const at = (mins) => {
      const t = new Date(now.getTime() + mins * 60000);
      return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
    };

    click(q("#addClassBtn"));
    await settle();
    setValue(q("#classSubjectInput"), "Timed Class");
    setValue(q("#classStartInput"), at(25));
    setValue(q("#classEndInput"), at(85));
    qa("#classDayToggle button").forEach((b) => { if (!b.classList.contains("on")) click(b); });
    click(q("#classSaveBtn"));
    await settle(1200); // let the 1s ticker run at least once

    const timer = q("#classTimer");
    check("global timer appears within the hour", !timer.classList.contains("hidden"),
      timer.className);
    check("timer counts in mm:ss", /^\d{1,2}:\d{2}$/.test(q("#ctCount")?.textContent || ""),
      q("#ctCount")?.textContent);
    check("timer escalated to the 30-minute phase", timer.className.includes("phase-warn"),
      timer.className);
    check("timer names the class", q(".ct-name")?.textContent.includes("Timed Class"),
      q(".ct-name")?.textContent);
    check("schedule shows its own countdown panel",
      !q("#schedTimer").classList.contains("hidden"), q("#schedTimer").className);

    d.nav("Tasks");
    await settle();
    check("timer persists across navigation", !q("#classTimer").classList.contains("hidden"),
      "timer disappeared when leaving Schedule");

    d.nav("Home");
    await settle();
    check("home shows the countdown too", !q("#homeTimer").classList.contains("hidden"),
      q("#homeTimer").className);

    click(q('#classTimer [data-action="hide-timer"]'));
    await settle();
    check("timer can be dismissed", q("#classTimer").classList.contains("hidden"));
  }

  // ---- Home widgets ----
  group("Home widgets");
  d.nav("Home");
  await settle();
  check("widget grid rendered", qa(".widgets .widget").length >= 4,
    String(qa(".widgets .widget").length));
  check("up-next widget filled", q("#nextClass .next-class") || q("#nextClass .widget-empty"),
    q("#nextClass").innerHTML.slice(0, 80));
  check("progress ring rendered", q("#dayRing"), "no ring");
  check("ring shows a percentage", /%$/.test(q("#dayRingPct")?.textContent || ""),
    q("#dayRingPct")?.textContent);
  check("ring legend filled", q("#dayRingLegend").textContent.includes("completed"),
    q("#dayRingLegend").textContent);
  check("quick actions rendered", qa("#quickActions .quick-action").length === 4,
    String(qa("#quickActions .quick-action").length));
  check("quick actions link to hash routes",
    q("#quickActions .quick-action")?.getAttribute("href")?.startsWith("#/"),
    q("#quickActions .quick-action")?.getAttribute("href"));
  check("mini stats rendered", qa(".mini-stat").length === 6, String(qa(".mini-stat").length));
  check("motto shown", q("#homeMotto").textContent.length > 0, q("#homeMotto").textContent);

  // ---- Task + checklist state visuals ----
  group("State visuals");
  d.nav("Tasks");
  await settle();
  check("rows carry a priority class", q(".task-row[class*='p-']"), q(".task-row")?.className);
  check("untouched rows read as pending", q(".task-row.pending"), q(".task-row")?.className);

  const stSel = q("select[data-action=set-status]");
  setValue(stSel, "progress", "change");
  await settle();
  check("in-progress rows are visually distinct", q(".task-row.active"),
    q(".task-row")?.className);
  setValue(q("select[data-action=set-status]"), "todo", "change");
  await settle();

  // --------------------------------------------------------- today timeline ---
  group("Today timeline");
  d.nav("Home");
  await settle();
  check("timeline rendered", q("#todayTimeline .tl-list"), q("#todayTimeline").innerHTML.slice(0, 140));
  check("the class appears on the spine",
    q(".tl-item .tl-title")?.textContent.includes("Psychology"), q(".tl-item")?.textContent);
  check("its time is shown", /\d/.test(q(".tl-time")?.textContent || ""), q(".tl-time")?.textContent);
  check("the linked task hangs off the class",
    q(".tl-item .tl-tasks .tl-task-text")?.textContent === "Weekly reading",
    q(".tl-item .tl-tasks")?.textContent);
  check("classes-today stat matches the timeline",
    Number(q("#statClasses").textContent) === qa(".tl-item").length &&
      Number(q("#statClasses").textContent) >= 1,
    `${q("#statClasses").textContent} vs ${qa(".tl-item").length} timeline items`);
  check("today summary line written", q("#todayMeta").textContent.length > 0, q("#todayMeta").textContent);
  check("a Now marker is placed", q(".tl-now"), "no now marker");

  // ticking from the timeline goes through the same rollover logic
  // Read the date from the Tasks view, which only re-renders when switched to —
  // so hop over, read, come back, tick, and hop over again.
  d.nav("Tasks"); await settle();
  const dueBefore = q("input[data-action=set-due]")?.value;

  d.nav("Home"); await settle();
  tick(q(".tl-item .tl-task input[type=checkbox]"));
  await settle();

  d.nav("Tasks"); await settle();
  const dueAfter = q("input[data-action=set-due]")?.value;
  check("ticking a repeating task from the timeline rolls it forward",
    dueAfter && dueAfter !== dueBefore, `${dueBefore} -> ${dueAfter}`);
  check("…by exactly one week",
    Math.round((new Date(dueAfter) - new Date(dueBefore)) / 86400000) === 7,
    `${dueBefore} -> ${dueAfter}`);
  check("…and it is still open", !q(".task-row.done"), "row marked done");
  d.nav("Home"); await settle();

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
