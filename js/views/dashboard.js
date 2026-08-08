import { store } from "../store.js";
import { $, esc } from "../dom.js";
import { dateKey, formatDateSpan, todayKey } from "../lib/dates.js";
import { addTask } from "./tasks.js";

function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The next 7 days including today, as date keys. */
function weekKeys() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return dateKey(d);
  });
}

export function render() {
  const state = store.state;
  const now = new Date();

  $("greeting").textContent = greetingFor(now.getHours());
  $("todayLabel").textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const today = todayKey();
  const dueToday = state.tasks.filter((t) => t.due === today && !t.done);
  const overdue = state.tasks.filter((t) => t.due && t.due < today && !t.done);

  const week = weekKeys();

  // Count distinct events overlapping the window — a 5-day event is one event,
  // not five, and it still counts if only part of it falls inside.
  const eventsThisWeek = state.eventsList.filter((ev) =>
    ev.dates.some((d) => week.includes(d))
  );

  const checklistsInProgress = state.checklists.filter(
    (cl) => cl.items.length > 0 && cl.items.some((i) => !i.done)
  ).length;

  $("statDueToday").textContent = dueToday.length;
  $("statOverdue").textContent = overdue.length;
  $("statEvents").textContent = eventsThisWeek.length;
  $("statChecklists").textContent = checklistsInProgress;

  $("dashDueToday").innerHTML = dueToday.length
    ? dueToday
        .map(
          (t) =>
            `<li><span>${esc(t.text)}</span>` +
            `<span class="badge priority-${esc(t.priority)}">${esc(t.priority)}</span></li>`
        )
        .join("")
    : '<li><span class="muted">Nothing due today. Nice!</span></li>';

  // One row per event (not per day), showing its full span, earliest first.
  const upcoming = eventsThisWeek
    .map((ev) => {
      const sorted = [...ev.dates].sort();
      return { text: ev.title, span: formatDateSpan(sorted), sortKey: sorted[0] };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  $("dashUpcoming").innerHTML = upcoming.length
    ? upcoming
        .map(
          (item) =>
            `<li><span>${esc(item.text)}</span>` +
            `<span class="muted">${esc(item.span)}</span></li>`
        )
        .join("")
    : '<li><span class="muted">No events in the next 7 days.</span></li>';
}

export function mount() {
  const input = $("quickTaskInput");

  const submit = () => {
    addTask(input.value, todayKey(), "medium");
    input.value = "";
    render();
  };

  $("quickTaskBtn").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}
