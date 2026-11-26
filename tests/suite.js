import { check, group, makeDom, settle } from "./harness.js";

/* The assertions, kept apart from however they are launched: tests.html drives
   an iframe, but the same suite can be pointed at any window running the app.
   Everything goes through the DOM — clicking, typing, reading what is rendered
   — so it stays honest about what a user would actually get. */

/** The stylesheets as text, for assertions about layout rules themselves. */
async function loadCss(win) {
  const links = [...win.document.querySelectorAll('link[rel="stylesheet"]')];
  const parts = await Promise.all(
    links.map((l) => fetch(l.getAttribute("href")).then((r) => r.text()).catch(() => ""))
  );
  const fetched = parts.join("\n");
  // join() of empty strings is still truthy, so test for real content.
  return fetched.trim() ? fetched : globalThis.cssText || "";
}

export async function suite(win) {
  const cssText = await loadCss(win);
  const d = makeDom(win);
  const { q, qa, click, setValue, key, tick, confirmDialog } = d;


  
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

  // ------------------------------------------------------------- confirmation ---
  group("Delete confirmation");
  d.nav("Tasks");
  await settle();
  setValue(q("#taskTextInput"), "Cancel me");
  click(q("#addTaskBtn"));
  await settle();
  const beforeCancel = qa(".task-row").length;

  click(qa('[data-action="delete-task"]').at(-1));
  await settle(60);
  check("confirmation dialog opens", !q("#confirmOverlay").classList.contains("hidden"),
    q("#confirmOverlay").className);
  check("dialog names what is being deleted",
    q("#confirmMessage").textContent.includes("Cancel me"), q("#confirmMessage").textContent);
  check("focus starts on Cancel, not Delete", d.doc.activeElement?.id === "confirmCancelBtn",
    d.doc.activeElement?.id);

  click(q("#confirmCancelBtn"));
  await settle();
  check("cancelling keeps the task", qa(".task-row").length === beforeCancel,
    `${qa(".task-row").length} vs ${beforeCancel}`);
  check("dialog closed on cancel", q("#confirmOverlay").classList.contains("hidden"));

  click(qa('[data-action="delete-task"]').at(-1));
  await settle(60);
  key(d.doc.activeElement || d.doc.body, "Escape");
  await settle();
  check("escape also cancels", q("#confirmOverlay").classList.contains("hidden") &&
    qa(".task-row").length === beforeCancel, String(qa(".task-row").length));

  click(qa('[data-action="delete-task"]').at(-1));
  await confirmDialog(true);
  await settle();
  check("confirming deletes", qa(".task-row").length === beforeCancel - 1,
    `${qa(".task-row").length} vs ${beforeCancel - 1}`);
  check("undo is still offered after confirming",
    !q("#undoToast").classList.contains("hidden"), q("#undoToast").textContent);
  click(q('#undoToast [data-action="undo"]'));
  await settle();
  check("undo still restores it", qa(".task-row").length === beforeCancel,
    String(qa(".task-row").length));
  click(qa('[data-action="delete-task"]').at(-1));
  await confirmDialog(true);
  await settle();

  // ---------------------------------------------------------- image export ---
  group("Schedule image export");
  d.nav("Schedule");
  await settle();
  click(q("#fullSchedBtn"));
  await settle();
  check("export buttons present", q("#exportPngBtn") && q("#exportJpgBtn"));
  check("export enabled when classes exist", !q("#exportPngBtn").disabled);

  // Intercept the download so the suite can inspect what would be saved.
  const saved = [];
  const realCreate = win.URL.createObjectURL;
  win.URL.createObjectURL = (blob) => { saved.push(blob); return "blob:test"; };
  win.URL.revokeObjectURL = () => {};
  const realClick = win.HTMLAnchorElement.prototype.click;
  let downloadName = "";
  win.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };

  click(q("#exportPngBtn"));
  await settle(400);

  check("export produced a file", saved.length === 1, `${saved.length} blobs`);
  check("it is a PNG", saved[0]?.type === "image/png", saved[0]?.type);
  check("the image has bytes", (saved[0]?.size ?? 0) > 1000, `${saved[0]?.size} bytes`);
  check("filename is dated and typed", /^motion-schedule-\d{4}-\d{2}-\d{2}\.png$/.test(downloadName),
    downloadName);

  win.URL.createObjectURL = realCreate;
  win.HTMLAnchorElement.prototype.click = realClick;
  key(d.doc.body, "Escape");
  await settle();

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

    d.nav("Today");
    await settle();
    check("Today names the class that is coming up", /Timed Class/.test(q("#nextClass").textContent),
      q("#nextClass").textContent);

    click(q('#classTimer [data-action="hide-timer"]'));
    await settle();
    check("timer can be dismissed", q("#classTimer").classList.contains("hidden"));
  }

  // ---- Home widgets ----
  group("Home widgets");
  d.nav("Today");
  await settle();
  check("the date is the title, not a greeting", !/Good (morning|afternoon|evening)/.test(q("#greeting").textContent) &&
    /\d/.test(q("#greeting").textContent), q("#greeting").textContent);
  check("four numbers lead the page", qa(".stats .stat").length === 4, String(qa(".stats .stat").length));
  check("today's progress shows under Done today", q("#statDoneBar") &&
    /^\d+%$|^$/.test(q("#statDoneBar").style.width || ""), q("#statDoneBar")?.style.width);
  check("the summary line counts today's classes", /class/.test(q("#todayLabel").textContent), q("#todayLabel").textContent);
  check("due work is listed beside the day", !!q("#dueNext li"), q("#dueNext").innerHTML.slice(0, 80));
  check("quick add sits with the due list", !!q(".today-side #quickTaskInput"));

  // ---- icons must actually draw ----
  group("Icons render");
  d.nav("Today");
  await settle();

  // The real defect was an <svg> with nothing inside it: valid markup, zero
  // pixels, no error. So assert on drawn content rather than on element count.
  const emptySvgs = qa("#view-dashboard svg").filter((s) => s.children.length === 0);
  check("no empty <svg> anywhere on Home", emptySvgs.length === 0,
    `${emptySvgs.length} empty: ` + emptySvgs.map((s) => s.parentElement?.textContent?.trim().slice(0, 14)).join(", "));

  const tabs = qa("#tabBar .tab");
  check("every phone tab has an icon that draws",
    tabs.length === 5 && tabs.every((t) => t.querySelector("svg")?.children.length > 0),
    tabs.map((t) => `${t.textContent.trim()}:${t.querySelector("svg")?.children.length ?? 0}`).join(" | "));

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
  d.nav("Today");
  await settle();
  check("the day is drawn as a timetable", q("#todayTimeline .tl-day"), q("#todayTimeline").innerHTML.slice(0, 140));
  // Found by name: the timer test's "Timed Class" can sort ahead of it early in the day.
  const psych = qa(".tl-item").find((el) => el.querySelector(".tl-title")?.textContent.includes("Psychology"));
  check("the class appears on the spine", psych, q("#todayTimeline")?.textContent);
  check("its time is shown", /\d/.test(psych?.querySelector(".tl-time")?.textContent || ""),
    psych?.querySelector(".tl-time")?.textContent);
  check("the linked task hangs off the class",
    psych?.querySelector(".tl-tasks .tl-task-text")?.textContent === "Weekly reading",
    psych?.querySelector(".tl-tasks")?.textContent);
  check("classes-today stat matches the timeline",
    Number(q("#statClasses").textContent) === qa(".tl-item").length &&
      Number(q("#statClasses").textContent) >= 1,
    `${q("#statClasses").textContent} vs ${qa(".tl-item").length} timeline items`);
  check("today summary line written", q("#todayMeta").textContent.length > 0, q("#todayMeta").textContent);
  check("a Now marker is placed", q(".tl-now .mark"), "no now marker");

  // ticking from the timeline goes through the same rollover logic
  // Read the date from the Tasks view, which only re-renders when switched to —
  // so hop over, read, come back, tick, and hop over again.
  d.nav("Tasks"); await settle();
  // Target this task specifically — other rows may now sort ahead of it.
  const rowFor = (text) =>
    qa(".task-row").find((r) => r.querySelector(".task-text")?.textContent === text);
  const dueOf = (text) => rowFor(text)?.querySelector("input[data-action=set-due]")?.value;
  const dueBefore = dueOf("Weekly reading");

  d.nav("Today"); await settle();
  tick(q(".tl-item .tl-task input[type=checkbox]"));
  await settle();

  d.nav("Tasks"); await settle();
  const dueAfter = dueOf("Weekly reading");
  check("ticking a repeating task from the timeline rolls it forward",
    dueAfter && dueAfter !== dueBefore, `${dueBefore} -> ${dueAfter}`);
  check("…by exactly one week",
    Math.round((new Date(dueAfter) - new Date(dueBefore)) / 86400000) === 7,
    `${dueBefore} -> ${dueAfter}`);
  check("…and it is still open", !rowFor("Weekly reading")?.classList.contains("done"), "row marked done");
  d.nav("Today"); await settle();

  // ----------------------------------------------------------------- undo ---
  group("Undo (#5)");
  click(q('[data-action="delete-task"]'));
  check("a confirmation appears before deleting", await confirmDialog(true), "no dialog shown");
  await settle();
  check("task deleted after confirming", !q(".task-row"), q("#taskList").textContent);
  check("undo toast shown", !q("#undoToast").classList.contains("hidden"));
  check("toast names what was deleted", q("#undoToast").textContent.includes("Weekly reading"),
    q("#undoToast").textContent);

  click(q('#undoToast [data-action="undo"]'));
  await settle();
  check("undo restores the task", q(".task-row .task-text")?.textContent === "Weekly reading",
    q("#taskList").textContent);
  check("toast hides after undo", q("#undoToast").classList.contains("hidden"));

  click(q('[data-action="delete-task"]'));
  await confirmDialog(true);
  await settle();
  click(q('#undoToast [data-action="dismiss"]'));
  await settle();
  check("dismiss closes the toast", q("#undoToast").classList.contains("hidden"));
  check("dismissed delete stays deleted", !q(".task-row"));

  // ---------------------------------------------------------------- notes ---
  group("Notes — search & edited stamp (#4)");
  d.nav("Today");
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
  await confirmDialog(true);
  await settle();
  check("deleting a page offers undo", !q("#undoToast").classList.contains("hidden"),
    q("#undoToast").textContent);
  click(q('#undoToast [data-action="undo"]'));
  await settle();
  check("undo restores the page", qa("#pageList .page-item").length === 2,
    String(qa("#pageList .page-item").length));

  // -------------------------------------------------------- note editor ---
  group("Notes — pinned ribbon & editor");
  const ed = q("#pageContent");
  const ribbon = q("#notesRibbon");
  const btn = (action) => q(`.notes-toolbar [data-action="${action}"]`);
  const edHtml = () => ed.innerHTML.replace(/​/g, "");
  const select = (node, start, end = start) => {
    const r = d.doc.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    win.getSelection().removeAllRanges();
    win.getSelection().addRange(r);
  };
  /** Puts `html` in the note and the caret at the end of the last text. */
  const setNote = async (html) => {
    ed.focus();
    ed.innerHTML = html;
    const w = d.doc.createTreeWalker(ed, win.NodeFilter.SHOW_TEXT);
    let last = null;
    for (let n = w.nextNode(); n; n = w.nextNode()) last = n;
    if (last) select(last, last.length);
    ed.dispatchEvent(new win.InputEvent("input", { inputType: "insertFromPaste", bubbles: true }));
    await settle();
  };
  /** What typing one character reports, after the browser has inserted it. */
  const typed = async (data) => {
    const sel = win.getSelection();
    const node = sel.anchorNode;
    const at = sel.anchorOffset;
    node.insertData(at, data);
    select(node, at + data.length);
    ed.dispatchEvent(new win.InputEvent("input", { inputType: "insertText", data, bubbles: true }));
    await settle();
  };

  check("the ribbon is sticky, so it stays in reach on a long note",
    win.getComputedStyle(ribbon).position === "sticky", win.getComputedStyle(ribbon).position);
  check("every ribbon button is labelled",
    qa(".notes-toolbar button").every((b) => b.getAttribute("aria-label") && b.title),
    qa(".notes-toolbar button").filter((b) => !b.title).map((b) => b.dataset.action).join(","));
  check("shortcuts are shown in tooltips", /\(.*B\)/.test(btn("bold").title), btn("bold").title);

  await setNote("<p>hello world</p>");
  select(ed.querySelector("p").firstChild, 0, 5);
  click(btn("bold"));
  await settle();
  check("Bold applies to the selection", /<b>hello<\/b> world/.test(edHtml()), edHtml());
  check("and the button reads as on", btn("bold").classList.contains("active"));
  click(btn("undo"));
  await settle();
  check("Undo reverts it", edHtml() === "<p>hello world</p>", edHtml());
  click(btn("redo"));
  await settle();
  check("Redo reapplies it", /<b>hello<\/b>/.test(edHtml()), edHtml());

  await setNote("<ul><li>one</li><li>two</li></ul>");
  click(btn("h2"));
  await settle();
  check("Heading on a list item converts only that item",
    /<ul><li>one<\/li><\/ul><h2>two<\/h2>/.test(edHtml()), edHtml());

  await setNote("<ul><li>bullet</li></ul><p>task</p>");
  click(btn("todo"));
  await settle();
  check("a checklist next to a bullet list stays separate",
    /<ul><li>bullet<\/li><\/ul><ul class="todo"><li>task<\/li><\/ul>/.test(edHtml()), edHtml());
  key(ed, "Enter", { ctrlKey: true, metaKey: true });
  await settle();
  check("Ctrl/⌘+Enter ticks a checklist item", /data-checked="true"/.test(edHtml()), edHtml());

  await setNote("<p>#</p>");
  await typed(" ");
  check("typing '# ' starts a heading", /^<h2>(<br>)?<\/h2>$/.test(edHtml()), edHtml());
  await setNote("<p>-</p>");
  await typed(" ");
  check("typing '- ' starts a bullet list", /^<ul><li>(<br>)?<\/li><\/ul>$/.test(edHtml()), edHtml());
  await setNote("<p>[]</p>");
  await typed(" ");
  check("typing '[] ' starts a checklist", /^<ul class="todo"><li>(<br>)?<\/li><\/ul>$/.test(edHtml()), edHtml());
  await setNote("<p>run `ls</p>");
  await typed("`");
  check("`backticks` make inline code", /<code>ls<\/code>/.test(edHtml()), edHtml());

  await setNote("<p>x</p>");
  const dt = new win.DataTransfer();
  dt.setData("text/html",
    '<h1 style="color:red">Big</h1><p><span style="font-weight:700">strong</span> <a href="javascript:x">bad</a></p><img src="x">');
  dt.setData("text/plain", "Big strong bad");
  ed.dispatchEvent(new win.ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  await settle();
  check("pasted formatting is kept", /<h2>Big<\/h2>/.test(edHtml()) && /<b>strong<\/b>/.test(edHtml()), edHtml());
  check("pasted styles, images and script links are dropped",
    !/style=|<img|javascript:/.test(edHtml()), edHtml());

  await setNote(Array.from({ length: 120 }, (_, i) => `<p>Line ${i}</p>`).join(""));
  q(".content").scrollTop = 3000;
  q(".content").dispatchEvent(new win.Event("scroll"));
  await settle(60);
  const pinTop = ribbon.getBoundingClientRect().top - q(".content").getBoundingClientRect().top;
  check("scrolled deep into a long note, the ribbon is still at the top",
    Math.abs(pinTop) < 1.5, String(pinTop));
  check("and shows as pinned", ribbon.classList.contains("is-stuck"));
  q(".content").scrollTop = 0;

  // ------------------------------------------------------------ colours ---
  group("Notes — text colour & highlight");
  await setNote("<p>hello world</p>");
  select(ed.querySelector("p").firstChild, 0, 5);
  click(btn("color"));
  await settle();
  check("the colour button opens the palette", !q("#colorPopover").classList.contains("hidden"));
  click(q('#cpText [data-tc="red"]'));
  await settle();
  check("a text colour is stored as a palette name, not a style",
    /<span data-tc="red">hello<\/span>/.test(edHtml()) && !/style=/.test(edHtml()), edHtml());
  check("the palette closes after a pick", q("#colorPopover").classList.contains("hidden"));
  select(ed.querySelector("span").firstChild, 0, 5);
  click(btn("color"));
  await settle();
  click(q('#cpHighlight [data-hl="yellow"]'));
  await settle();
  check("a highlight combines with the text colour",
    /data-tc="red"/.test(edHtml()) && /data-hl="yellow"/.test(edHtml()), edHtml());
  check("colours have a dark-theme shade", /\[data-theme="dark"\][^}]*--tc-red/s.test(cssText));

  // ------------------------------------------------------------ folders ---
  group("Notes — folders");
  click(q("#newFolderBtn"));
  await settle();
  const folderInput = q("#pageList .folder-input");
  check("a new folder opens for naming", !!folderInput && d.doc.activeElement === folderInput);
  folderInput.value = "Lab work";
  key(folderInput, "Enter");
  await settle();
  check("the folder appears in the sidebar", q("#pageList .folder-name")?.textContent === "Lab work",
    q("#pageList").textContent);

  const folderId = q("#pageList .folder").dataset.folder;
  setValue(q("#pageFolderSelect"), folderId, "change");
  await settle();
  check("the picker files the open note in the folder",
    !!q(`#pageList .folder[data-folder="${folderId}"] .page-item.nested`), q("#pageList").innerHTML.slice(0, 300));

  click(q("#pageList .folder-row"));
  await settle();
  check("a folder collapses", !q("#pageList .folder").classList.contains("open"));
  click(q("#pageList .folder-row"));
  await settle();

  click(q('#pageList [data-folder-action="delete"]'));
  await confirmDialog(true);
  await settle();
  check("deleting a folder keeps its notes", !q("#pageList .folder") &&
    qa("#pageList > .page-item").length === 2, q("#pageList").textContent);

  // Leave the page as the later tests expect it: empty, and saved.
  await setNote("");
  ed.blur();
  await settle();

  // ---------------------------------------------------------- sidebar collapse ---
  group("Collapsible sidebar");
  const root = d.doc.documentElement;
  const toggle = q("#sidebarToggle");

  check("toggle exists", !!toggle);
  check("starts expanded", root.getAttribute("data-sidebar") !== "collapsed",
    root.getAttribute("data-sidebar"));
  check("nav labels are wrappable elements, not text nodes",
    qa(".nav-item .nav-label").length === 5, String(qa(".nav-item .nav-label").length));
  check("nav items carry a tooltip for the collapsed rail",
    qa(".nav-item[data-view]").every((n) => n.getAttribute("title")),
    qa(".nav-item[data-view]").map((n) => n.getAttribute("title")).join(","));

  click(toggle);
  await settle();
  check("collapses on click", root.getAttribute("data-sidebar") === "collapsed",
    root.getAttribute("data-sidebar"));
  check("aria-expanded follows", toggle.getAttribute("aria-expanded") === "false",
    toggle.getAttribute("aria-expanded"));
  check("label changes to Expand", /Expand/.test(toggle.getAttribute("aria-label")),
    toggle.getAttribute("aria-label"));
  check("choice is persisted", win.localStorage.getItem("motionSidebar") === "collapsed",
    win.localStorage.getItem("motionSidebar"));
  check("nav items still present and clickable when collapsed",
    qa(".nav-item[data-view]").length === 5);

  // navigation must still work from the rail
  d.nav("Tasks");
  await settle();
  check("can still navigate while collapsed", d.view()?.id === "view-tasks", d.view()?.id);

  click(toggle);
  await settle();
  check("expands again", root.getAttribute("data-sidebar") !== "collapsed",
    root.getAttribute("data-sidebar"));
  check("expanded state persisted too", win.localStorage.getItem("motionSidebar") === "expanded",
    win.localStorage.getItem("motionSidebar"));

  // Keyboard shortcut. Focus is parked in a text field by an earlier group, and
  // ⌘B is deliberately inert while typing — so move focus out first.
  d.doc.activeElement?.blur?.();
  check("focus is not in a field before testing the shortcut",
    !["INPUT", "TEXTAREA", "SELECT"].includes(d.doc.activeElement?.tagName),
    d.doc.activeElement?.tagName);

  key(d.doc.body, "b", { metaKey: true });
  await settle();
  check("⌘B collapses", root.getAttribute("data-sidebar") === "collapsed",
    root.getAttribute("data-sidebar"));
  key(d.doc.body, "b", { metaKey: true });
  await settle();
  check("⌘B expands", root.getAttribute("data-sidebar") !== "collapsed");

  // ...but must not fire while the user is typing
  d.nav("Tasks");
  await settle();
  q("#taskTextInput").focus();
  key(q("#taskTextInput"), "b", { metaKey: true });
  await settle();
  check("⌘B ignored while typing in a field", root.getAttribute("data-sidebar") !== "collapsed",
    "collapsed from inside an input");

  // the CSS must not collide with the mobile drawer
  check("collapse rules are desktop-only",
    /@media \(min-width: 769px\)[\s\S]*?data-sidebar="collapsed"/.test(cssText),
    "collapse not scoped above the drawer breakpoint");
  check("state is applied before first paint",
    /motionSidebar[\s\S]{0,200}data-sidebar/.test(win.document.head.innerHTML) ||
    /motionSidebar/.test(win.document.documentElement.innerHTML),
    "no pre-paint script");

  // The toggle used to float over the corner of the rail, landing on top of the
  // logo. It now sits on its own row under the logo, so nothing overlaps and it
  // is always hittable. The collapsed rule groups the toggle with the other rail
  // buttons, so match up to the first brace rather than a lone selector.
  const collapsedToggleCss =
    cssText.match(/data-sidebar="collapsed"\]\s*\.sidebar-toggle[,\s][^{]*\{[^}]*\}/) || [""];
  check("collapsed toggle rule exists", collapsedToggleCss[0] !== "", "no collapsed toggle rule");
  check("collapsed toggle is not overlaid on the brand",
    !/position:\s*absolute/.test(collapsedToggleCss[0]), collapsedToggleCss[0]);
  const collapsedBrandCss =
    cssText.match(/data-sidebar="collapsed"\]\s*\.brand\s*\{[^}]*\}/) || [""];
  check("collapsed brand stacks the mark above the toggle",
    /flex-direction:\s*column/.test(collapsedBrandCss[0]), collapsedBrandCss[0]);
  check("collapsed toggle stays visible without hover",
    !/data-sidebar="collapsed"\][^{]*\.sidebar:hover\s+\.sidebar-toggle/.test(cssText),
    "toggle only appears on hover");

  // The rail clips with overflow-x: hidden, so the widest thing in it — the logo
  // or the square rail buttons — must actually fit.
  const px = (rule, prop) => Number((rule.match(new RegExp(prop + ":\\s*(\\d+)px")) || [0, 0])[1]);
  const railCss = (cssText.match(/data-sidebar="collapsed"\]\s*\.sidebar\s*\{[^}]*\}/) || [""])[0];
  const markCss = (cssText.match(/\.brand-mark\s*\{[^}]*\}/) || [""])[0];
  const inner = px(railCss, "width") - px(railCss, "padding-left") - px(railCss, "padding-right");
  const needed = Math.max(px(markCss, "width"), px(collapsedToggleCss[0], "width"));
  check("rail is wide enough for the logo and its buttons",
    needed > 0 && inner >= needed, `${inner}px of room, needs ${needed}px`);

  // -------------------------------------------------------------- note → PDF ---
  group("Note PDF export");
  click(q("#pageList .page-item"));
  await settle();
  check("export button shown for a real note", !q("#printPageBtn").classList.contains("hidden"));

  // Intercept print so the dialog never opens during a test run.
  let printed = 0;
  const realPrint = win.print;
  const titleBefore = d.doc.title;
  win.print = () => { printed++; };

  click(q("#printPageBtn"));
  await settle();

  check("print was invoked", printed === 1, String(printed));
  check("PDF filename comes from the note title",
    d.doc.title.startsWith("Welcome") && d.doc.title.includes("Motion"), d.doc.title);

  const sheet = q("#printSheet");
  check("a separate print sheet is built, not the app view", sheet.querySelector(".ps-doc"),
    sheet.innerHTML.slice(0, 60));
  check("masthead present", sheet.querySelector(".ps-brand")?.textContent === "Motion");
  check("title block present", sheet.querySelector(".ps-title")?.textContent === "Welcome",
    sheet.querySelector(".ps-title")?.textContent);
  check("meta line has a word count", /\d+ words?/.test(sheet.querySelector(".ps-meta")?.textContent || ""),
    sheet.querySelector(".ps-meta")?.textContent);
  check("the note's rich text is carried over",
    sheet.querySelector(".ps-body h2") && sheet.querySelector(".ps-body p"),
    sheet.querySelector(".ps-body")?.innerHTML.slice(0, 60));
  check("footer repeats the title", sheet.querySelector(".ps-foot")?.textContent === "Welcome");

  win.dispatchEvent(new win.Event("afterprint"));
  await settle();
  check("tab title is restored after printing", d.doc.title === titleBefore,
    `${d.doc.title} vs ${titleBefore}`);
  win.print = realPrint;

  // The stylesheet is what makes it a document rather than a screenshot.
  check("print CSS hides the app", /@media print \{[\s\S]*?\.app,[\s\S]*?display: none/.test(cssText),
    "app not hidden in print");
  check("page margins declared", /@page \{[^}]*margin:/.test(cssText), "no @page margin");
  check("headings do not strand at a page foot",
    /\.ps-title \{[^}]*break-after: avoid-page/.test(cssText), "no break-after on title");
  check("paragraphs have orphan/widow control",
    /\.ps-body p \{[^}]*orphans: 3/.test(cssText), "no orphan control");
  check("print colours are literal so dark mode cannot leak",
    /\.ps-doc \{[^}]*color: #14161a/.test(cssText), "print colour uses a theme token");
  check("sheet is invisible on screen",
    /\.print-sheet \{\s*display: none/.test(cssText), "sheet visible on screen");

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

  // ------------------------------------------------------------ export/import ---
  group("Backup: export & import");
  check("export and import controls exist", q("#exportDataBtn") && q("#importDataInput"));

  // Earlier groups delete their tasks, so seed one to make the round-trip real.
  d.nav("Tasks");
  await settle();
  setValue(q("#taskTextInput"), "Backup me");
  click(q("#addTaskBtn"));
  await settle();

  // Capture the bkBlob file instead of downloading it.
  let bkBlob = null;
  const bkCreate = win.URL.createObjectURL;
  win.URL.createObjectURL = (blob) => { bkBlob = blob; return "blob:test"; };
  win.URL.revokeObjectURL = () => {};
  const bkAnchorClick = win.HTMLAnchorElement.prototype.click;
  let bkName = "";
  win.HTMLAnchorElement.prototype.click = function () { bkName = this.download; };

  click(q("#exportDataBtn"));
  await settle(200);

  check("export produced a file", !!bkBlob, "no blob");
  check("filename is dated", /^motion-backup-\d{4}-\d{2}-\d{2}\.json$/.test(bkName), bkName);

  const bkText = await bkBlob.text();
  const bkParsed = JSON.parse(bkText);
  check("file is tagged as a Motion backup", bkParsed.format === "motion-backup", bkParsed.format);
  check("it records the origin it came from", typeof bkParsed.origin === "string", bkParsed.origin);
  check("it carries the whole workspace",
    Array.isArray(bkParsed.state.tasks) && Array.isArray(bkParsed.state.pages) &&
    Array.isArray(bkParsed.state.classes) && Array.isArray(bkParsed.state.checklists),
    Object.keys(bkParsed.state).join(","));

  const bkTasks = bkParsed.state.tasks.length;
  const bkNotes = bkParsed.state.pages.length;
  check("the export is not empty", bkTasks > 0 && bkNotes > 0, `${bkTasks} tasks, ${bkNotes} notes`);
  check("the seeded task is inside the file",
    bkParsed.state.tasks.some((t) => t.text === "Backup me"),
    bkParsed.state.tasks.map((t) => t.text).join(" | "));
  check("class list travels too", Array.isArray(bkParsed.state.classes), typeof bkParsed.state.classes);

  win.URL.createObjectURL = bkCreate;
  win.HTMLAnchorElement.prototype.click = bkAnchorClick;

  // Importing a bkForeign backup must ask before replacing anything.
  const bkForeign = JSON.stringify({
    format: "motion-backup", version: 1,
    state: { tasks: [{ id: "imp1", text: "Imported task", done: false, due: null, priority: "high" }],
             eventsList: [], checklists: [], classes: [],
             pages: [{ id: "impp", title: "Imported note", content: "<p>hi</p>" }], currentPageId: "impp" },
  });
  const bkFile = new win.File([bkForeign], "backup.json", { type: "application/json" });
  Object.defineProperty(q("#importDataInput"), "files", { value: [bkFile], configurable: true });
  q("#importDataInput").dispatchEvent(new win.Event("change", { bubbles: true }));
  await settle(200);

  check("import asks before replacing", !q("#confirmOverlay").classList.contains("hidden"),
    q("#confirmOverlay").className);
  check("it says what is in the file",
    q("#confirmMessage").textContent.includes("1 task") && q("#confirmMessage").textContent.includes("1 note"),
    q("#confirmMessage").textContent);
  check("it warns the current workspace is replaced",
    q("#confirmMessage").textContent.includes("replace"), q("#confirmMessage").textContent);

  click(q("#confirmCancelBtn"));
  await settle();
  check("cancelling leaves the workspace alone",
    !qa(".task-row .task-text").some((t) => t.textContent === "Imported task"),
    "imported anyway");

  // ------------------------------------------------------------- overdue days ---
  group("Overdue day count");
  d.nav("Tasks");
  await settle();

  const pad2 = (n) => String(n).padStart(2, "0");
  const daysAgo = (n) => {
    const t = new Date();
    t.setDate(t.getDate() - n);
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  };

  setValue(q("#taskTextInput"), "Late essay");
  setValue(q("#taskDueInput"), daysAgo(3));
  click(q("#addTaskBtn"));
  await settle();

  const overdueChip = qa(".task-row .badge.overdue").at(-1);
  check("overdue chip says how many days", overdueChip?.textContent.trim() === "3 days overdue",
    overdueChip?.textContent);
  check("exact date kept in the tooltip", (overdueChip?.getAttribute("title") || "").length > 8,
    overdueChip?.getAttribute("title"));

  // singular, not "1 days"
  setValue(q("#taskTextInput"), "Yesterday thing");
  setValue(q("#taskDueInput"), daysAgo(1));
  click(q("#addTaskBtn"));
  await settle();
  check("one day reads as singular",
    qa(".task-row .badge.overdue").some((b) => b.textContent.trim() === "1 day overdue"),
    qa(".task-row .badge.overdue").map((b) => b.textContent.trim()).join(" | "));

  check("overdue rows are tinted, not double-striped",
    !(q(".task-row.is-overdue")?.style.boxShadow || "").includes("inset"),
    q(".task-row.is-overdue")?.style.boxShadow);

  d.nav("Today");
  await settle();
  check("timeline shows the day count too",
    qa("#todayTimeline .badge.overdue").some((b) => /days? overdue/.test(b.textContent)),
    qa("#todayTimeline .badge.overdue").map((b) => b.textContent).join(" | "));
  d.nav("Tasks");
  await settle();

  // ---- layout: the table must never collapse its name column ----
  group("Task table layout");
  check("name track has a floor, not minmax(0,1fr)",
    /--cols:\s*minmax\(1[0-9]{2}px/.test(cssText), "name column can still collapse to zero");
  check("column-drop tiers defined", (cssText.match(/col-(repeat|subject|priority)\s*\{\s*display:\s*none/g) || []).length === 3,
    String((cssText.match(/col-\w+\s*\{\s*display:\s*none/g) || []).length));
  check("table stacks independently of the nav drawer",
    /@media \(max-width: 900px\)/.test(cssText), "no 900px stacking block");
  check("header and rows share one column template",
    /\.task-head,\s*\n\.task-row \{[^}]*grid-template-columns: var\(--cols\)/.test(cssText),
    "header/row templates diverged");

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

  // ------------------------------------------------------ sidebar overflow ---
  group("Sidebar with many notes");
  check("sidebar sections never shrink", /\.sidebar > \* \{ flex-shrink: 0; \}/.test(cssText),
    "sidebar children can shrink");
  const sideTall = q("#sidebar").scrollHeight > q("#sidebar").clientHeight;
  check("nav items keep their full height", qa(".nav-item").every((el) => el.offsetHeight >= 30),
    `${qa(".nav-item").map((el) => el.offsetHeight).join(",")} (overflowing: ${sideTall})`);

  // ------------------------------------------------------- command palette ---
  group("Command palette");
  const palette = () => q("#cmdkOverlay");
  const paletteOpen = () => !palette().classList.contains("hidden");
  const items = () => qa("#cmdkList .cmdk-item");
  const labels = () => items().map((el) => el.querySelector(".cmdk-label").textContent);
  const typeQuery = async (text) => {
    setValue(q("#cmdkInput"), text);
    await settle();
  };

  d.nav("Today");
  await settle();
  key(win.document.body, "k", { ctrlKey: true });
  await settle();
  check("Ctrl+K opens the palette", paletteOpen(), palette().className);
  check("its input takes focus", win.document.activeElement === q("#cmdkInput"),
    win.document.activeElement?.id);
  check("an empty palette offers actions", labels().includes("New task"), labels().join(" | "));
  check("first row is highlighted", items()[0]?.getAttribute("aria-selected") === "true");

  key(q("#cmdkInput"), "ArrowDown");
  check("arrow keys move the highlight", items()[1]?.getAttribute("aria-selected") === "true",
    items().map((el) => el.getAttribute("aria-selected")).join(","));

  key(win.document, "Escape");
  await settle();
  check("Escape closes it", !paletteOpen());

  click(q(".cmdk-trigger"));
  await settle();
  check("the sidebar search button opens it", paletteOpen());
  await typeQuery("calend");
  check("navigation is searchable", labels()[0] === "Go to Calendar", labels().join(" | "));
  key(q("#cmdkInput"), "Enter");
  await settle(80);
  check("Enter runs the highlighted item", d.view()?.id === "view-calendar", d.view()?.id);
  check("and closes the palette", !paletteOpen());

  key(win.document.body, "k", { ctrlKey: true });
  await settle();
  await typeQuery("Palette made task");
  check("a query offers to create it",
    labels().includes("Add task “Palette made task”"), labels().join(" | "));
  click(items().find((el) => el.textContent.includes("Add task “Palette made task”")));
  await settle(80);
  d.nav("Tasks");
  await settle();
  check("clicking a create action adds the task",
    qa(".task-row .task-text").some((el) => el.textContent === "Palette made task"),
    qa(".task-row .task-text").map((el) => el.textContent).join(" | "));

  // Opens from inside a text field too: the shortcut never needs escaping from.
  q("#taskTextInput").focus();
  key(q("#taskTextInput"), "k", { metaKey: true });
  await settle();
  check("⌘K works while typing in a field", paletteOpen());
  await typeQuery("palette made");
  const taskRow = items().find((el) => el.closest(".cmdk-group")?.getAttribute("aria-label") === "Tasks");
  check("open tasks are searchable", taskRow?.textContent.includes("Palette made task"),
    labels().join(" | "));
  click(taskRow);
  await settle(80);
  const madeRow = qa(".task-row").find((r) => r.querySelector(".task-text")?.textContent === "Palette made task");
  check("choosing a task completes it", madeRow?.classList.contains("done"), madeRow?.className);
  check("with an undo offered", q("#undoToast").textContent.includes("Completed"),
    q("#undoToast").textContent);

  key(win.document.body, "k", { ctrlKey: true });
  await settle();
  await typeQuery("chemistry");
  check("a name match outranks a body match", labels()[0] === "Chemistry lab", labels().join(" | "));
  key(q("#cmdkInput"), "Enter");
  await settle(80);
  check("notes are searchable and open", d.view()?.id === "view-notes" &&
    q("#pageTitleInput").value === "Chemistry lab", `${d.view()?.id} ${q("#pageTitleInput").value}`);

  // ------------------------------------------------------------- reminders ---
  group("Reminders");
  win.localStorage.removeItem("motionReminders_e2e");
  win.localStorage.removeItem("motionRemindersFired_e2e");
  // Never let the suite raise a real permission prompt.
  if (win.Notification) win.Notification.requestPermission = async () => "denied";
  const toasts = () => qa("#reminderStack .reminder-toast .reminder-title").map((el) => el.textContent);

  click(q("#remindersBtn"));
  await settle();
  check("sidebar button opens the settings", !q("#reminderOverlay").classList.contains("hidden"));
  check("reminders start switched off", q("#remEnabled").getAttribute("aria-checked") === "false");
  check("options are disabled while off", q("#remClassLead").disabled);

  click(q("#remEnabled"));
  await settle(80);
  check("the switch turns them on", q("#remEnabled").getAttribute("aria-checked") === "true");
  check("options become editable", !q("#remClassLead").disabled);
  check("the sidebar shows they are on", q("#remindersBtn").classList.contains("is-on"));
  check("permission state is explained", q("#remPermission").textContent.length > 20,
    q("#remPermission").textContent);
  check("the limits are stated", /while Motion is open/.test(q(".setting-note").textContent));

  click(q("#remDoneBtn"));
  await settle();

  const remNow = new Date();
  if (remNow.getHours() === 23 && remNow.getMinutes() >= 45) {
    check("class reminder test skipped near midnight (would cross days)", true);
  } else {
    const pad2 = (n) => String(n).padStart(2, "0");
    const at = (mins) => {
      const t = new Date(remNow.getTime() + mins * 60000);
      return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
    };
    d.nav("Schedule");
    await settle();
    click(q("#addClassBtn"));
    await settle();
    setValue(q("#classSubjectInput"), "Reminder Class");
    setValue(q("#classStartInput"), at(5));
    setValue(q("#classEndInput"), at(12));
    qa("#classDayToggle button").forEach((b) => { if (!b.classList.contains("on")) click(b); });
    click(q("#classSaveBtn"));
    await settle();

    win.dispatchEvent(new win.Event("focus"));
    await settle();
    check("a class inside the lead time triggers a reminder",
      toasts().some((t) => t.includes("Reminder Class starts in")), toasts().join(" | "));

    win.dispatchEvent(new win.Event("focus"));
    await settle();
    check("each class reminds only once",
      toasts().filter((t) => t.includes("Reminder Class")).length === 1, toasts().join(" | "));
  }

  click(q("#remindersBtn"));
  await settle();
  setValue(q("#remDigestTime"), "00:00", "change");
  await settle();
  check("the daily summary arrives once its time has passed",
    toasts().filter((t) => t === "Your day in Motion").length === 1, toasts().join(" | "));

  click(q("#remTestBtn"));
  await settle();
  check("a test reminder can be sent", toasts().includes("Test reminder"), toasts().join(" | "));

  click(q("#remEnabled"));
  await settle();
  check("they can be switched off again", !q("#remindersBtn").classList.contains("is-on"));
  click(q("#remDoneBtn"));
  qa("#reminderStack .reminder-close").forEach(click);
  await settle();
  check("toasts can be dismissed", !q("#reminderStack .reminder-toast"));
  win.localStorage.removeItem("motionReminders_e2e");
  win.localStorage.removeItem("motionRemindersFired_e2e");

  // ------------------------------------------------------- redesign pass ---
  group("Tasks — calm rows and due date picker");
  d.nav("Tasks");
  await settle();
  check("no subtitle under the Tasks title", !q("#view-tasks .subtitle"));
  const calmRow = q(".task-row");
  // Completed rows play a brief "done" flash on render, so they're left out.
  const openRows = qa(".task-row:not(.done)");
  check("rows carry no tinted background",
    openRows.length > 0 && openRows.every((r) => ["rgba(0, 0, 0, 0)", "transparent"].includes(win.getComputedStyle(r).backgroundColor)),
    openRows.map((r) => win.getComputedStyle(r).backgroundColor).join(","));
  const ghost = q(".task-row .badge.ghost");
  check("empty fields stay hidden until hover", !ghost || win.getComputedStyle(ghost).opacity === "0",
    ghost && win.getComputedStyle(ghost).opacity);

  const dueBtn = q("#taskComposer .datepick-btn");
  check("the raw date box is replaced by a button", !!dueBtn && /Due date/.test(dueBtn.textContent), dueBtn?.textContent);
  click(dueBtn);
  await settle();
  check("it opens quick picks and a month", !q(".datepick-pop").classList.contains("hidden") &&
    qa(".dp-quick button").length === 3 && qa(".dp-day").length >= 28);
  click(qa(".dp-quick button")[1]);
  await settle();
  const tomorrow = new win.Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  check("Tomorrow sets the due date", q("#taskDueInput").value === tKey, q("#taskDueInput").value);
  check("and the button says so", /Tomorrow/.test(dueBtn.textContent), dueBtn.textContent);
  check("picking closes it", q(".datepick-pop").classList.contains("hidden"));
  setValue(q("#taskTextInput"), "Picked with the date picker");
  click(q("#addTaskBtn"));
  await settle();
  const pickedRow = qa(".task-row").find((r) => r.textContent.includes("Picked with the date picker"));
  check("the task is added with that date", pickedRow?.querySelector('input[data-action="set-due"]')?.value === tKey,
    pickedRow?.querySelector('input[data-action="set-due"]')?.value);
  check("the picker resets after adding", /Due date/.test(dueBtn.textContent), dueBtn.textContent);

  group("Calendar — task labels and holiday note");
  d.nav("Calendar");
  await settle();
  const ind = q(".cal-task-indicator");
  check("task counts read as words", !ind || /^\d+ tasks?$/.test(ind.textContent.trim()), ind?.textContent);
  check("the holiday explanation is a footnote", !q("#view-calendar .subtitle") && /estimates/.test(q(".cal-note")?.textContent || ""));

  group("Schedule — week, day and list");
  win.localStorage.removeItem("motionScheduleView");
  d.nav("Schedule");
  await settle();
  const sv = () => q("#view-schedule").dataset.schedView;
  check("starts on the week timetable", sv() === "week", sv());
  check("each class appears as a block", qa("#weekTimetable .tt-block").length > 0, q("#weekTimetable").textContent.slice(0, 80));
  check("the day list is out of the way", win.getComputedStyle(q("#dayClassList")).display === "none");
  click(q('#schedViewSwitch [data-view="list"]'));
  await settle();
  check("List shows only the table", sv() === "list" &&
    win.getComputedStyle(q("#weekWrap")).display === "none" && win.getComputedStyle(q("#allClassesTable")).display !== "none");
  click(q('#schedViewSwitch [data-view="day"]'));
  await settle();
  check("Day brings back the day picker", sv() === "day" && win.getComputedStyle(q("#dayPicker")).display !== "none");
  check("the choice is remembered", win.localStorage.getItem("motionScheduleView") === "day");
  click(q('#schedViewSwitch [data-view="week"]'));
  await settle();
  click(q("#weekTimetable .tt-block"));
  await settle();
  check("clicking a block opens that class", !q("#classModalOverlay").classList.contains("hidden"));
  key(d.doc.body, "Escape");
  await settle();

  group("Notes — page menu");
  click(q("#pageList .page-item"));
  await settle();
  check("page actions live in a ⋯ menu", q("#pageMenu").classList.contains("hidden") && !!q("#pageMenuBtn"));
  click(q("#pageMenuBtn"));
  await settle();
  check("the menu opens", !q("#pageMenu").classList.contains("hidden") && q("#pageMenuBtn").getAttribute("aria-expanded") === "true");
  const pagesBefore = qa("#pageList .page-item").length;
  const srcTitle = q("#pageTitleInput").value;
  click(q("#duplicatePageBtn"));
  await settle(80);
  check("Duplicate makes a copy and opens it", qa("#pageList .page-item").length === pagesBefore + 1 &&
    q("#pageTitleInput").value === `${srcTitle} (copy)`, q("#pageTitleInput").value);
  check("with the same content", q("#pageContent").textContent.length > 0);
  check("the menu closed", q("#pageMenu").classList.contains("hidden"));
  click(q("#deletePageBtn"));
  await confirmDialog(true);
  await settle();
  check("Delete still works from the menu", qa("#pageList .page-item").length === pagesBefore, String(qa("#pageList .page-item").length));

  group("Notes — empty folder");
  click(q("#newFolderBtn"));
  await settle();
  const fin = q("#pageList .folder-input");
  fin.value = "Empty one";
  key(fin, "Enter");
  await settle();
  const emptyBtn = q("#pageList .folder-empty");
  check("an empty folder offers a new note", !!emptyBtn && /New note here/.test(emptyBtn.textContent), emptyBtn?.textContent);
  click(emptyBtn);
  await settle(80);
  check("which lands inside that folder", !!q("#pageList .folder .page-item.nested"));
  click(q("#deletePageBtn"));
  await confirmDialog(true);
  await settle();
  click(q('#pageList [data-folder-action="delete"]'));
  await confirmDialog(true);
  await settle();

  group("Settings menu");
  check("one Settings button in the sidebar footer", !!q("#settingsBtn") && q("#settingsMenu").classList.contains("hidden"));
  click(q("#settingsBtn"));
  await settle();
  check("it opens with theme, reminders, export and import",
    !q("#settingsMenu").classList.contains("hidden") &&
    ["#themeToggle", "#remindersBtn", "#exportDataBtn", "#importDataBtn"].every((sel) => q("#settingsMenu " + sel)));
  check("it sits inside the window", (() => {
    const r = q("#settingsMenu").getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= win.innerHeight && r.width > 150;
  })(), JSON.stringify(q("#settingsMenu").getBoundingClientRect()));
  check("it opens right above its button", (() => {
    const m = q("#settingsMenu").getBoundingClientRect();
    const b = q("#settingsBtn").getBoundingClientRect();
    return Math.abs(b.top - m.bottom - 6) <= 2;
  })(), `${JSON.stringify(q("#settingsMenu").getBoundingClientRect())} vs ${JSON.stringify(q("#settingsBtn").getBoundingClientRect())}`);
  q("#settingsMenu").dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
  check("Escape closes it", q("#settingsMenu").classList.contains("hidden"));

  // A long notes list scrolls the sidebar; the menu must still open at the button.
  const sb = q("#sidebar");
  const filler = win.document.createElement("div");
  filler.style.height = "2000px";
  sb.insertBefore(filler, sb.querySelector(".sidebar-footer"));
  sb.scrollTop = sb.scrollHeight;
  await settle();
  click(q("#settingsBtn"));
  await settle();
  check("with the sidebar scrolled it still opens right above its button", (() => {
    const m = q("#settingsMenu").getBoundingClientRect();
    const b = q("#settingsBtn").getBoundingClientRect();
    return Math.abs(b.top - m.bottom - 6) <= 2 && m.top >= 0;
  })(), `${JSON.stringify(q("#settingsMenu").getBoundingClientRect())} vs ${JSON.stringify(q("#settingsBtn").getBoundingClientRect())}`);
  q("#settingsMenu").dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  filler.remove();
  sb.scrollTop = 0;
  await settle();

  group("Phone tab bar");
  check("five tabs and an add button exist", qa("#tabBar .tab").length === 5 && !!q("#fabBtn"));
  check("hidden on a wide screen", win.getComputedStyle(q("#tabBar")).display === "none");
  d.nav("Calendar");
  await settle();
  check("the current screen's tab is marked", q('#tabBar [aria-current="page"]')?.dataset.view === "calendar",
    q('#tabBar [aria-current="page"]')?.dataset.view);
  check("+ is labelled for the screen", q("#fabBtn").getAttribute("aria-label") === "New event", q("#fabBtn").getAttribute("aria-label"));
  d.nav("Checklists");
  await settle();
  check("screens without a tab mark none", !q('#tabBar [aria-current="page"]'));
}
