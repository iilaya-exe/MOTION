import { pad, DAY_ABBR } from "./dates.js";

export const CLASS_COLORS = [
  "indigo", "violet", "blue", "teal", "green", "amber", "rose", "slate",
];

export function colorClass(c) {
  return "c-" + (CLASS_COLORS.includes(c?.color) ? c.color : "indigo");
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":");
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

export function formatTime(hhmm) {
  const total = toMinutes(hhmm);
  const hr = Math.floor(total / 60);
  const min = total % 60;
  const ampm = hr >= 12 ? "PM" : "AM";
  const h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${h12}:${pad(min)} ${ampm}`;
}

export function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function classesOnDay(classes, day) {
  return classes
    .filter((c) => c.days.includes(day))
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

export function ongoingClass(classes) {
  const m = nowMinutes();
  return (
    classesOnDay(classes, new Date().getDay()).find(
      (c) => toMinutes(c.start) <= m && m < toMinutes(c.end)
    ) || null
  );
}

export function nextClassToday(classes) {
  const m = nowMinutes();
  return classesOnDay(classes, new Date().getDay()).find((c) => toMinutes(c.start) > m) || null;
}

export function describeDays(days) {
  return [...days].sort((a, b) => a - b).map((d) => DAY_ABBR[d]).join(" ");
}

/**
 * Days always run Mon..Sat like a standard timetable; Sunday only appears if
 * something is actually scheduled on it.
 */
export function weekDaysShown(classes) {
  const days = [1, 2, 3, 4, 5, 6];
  if (classesOnDay(classes, 0).length) days.unshift(0);
  return days;
}

/**
 * Assign side-by-side lanes to classes that overlap in time. Lanes are computed
 * per cluster of overlapping items, so a morning clash doesn't narrow the whole
 * day.
 *
 * @param {{s: number, e: number}[]} items sorted by start time
 * @returns the same items, each with `lane` and `lanes` (total lanes in cluster)
 */
export function layoutDayBlocks(items) {
  const out = [];
  let cluster = [];
  let clusterEnd = -1;

  function flush() {
    if (!cluster.length) return;
    const laneEnds = [];
    cluster.forEach((it) => {
      let lane = laneEnds.findIndex((end) => end <= it.s);
      if (lane === -1) {
        laneEnds.push(it.e);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = it.e;
      }
      it.lane = lane;
    });
    cluster.forEach((it) => {
      it.lanes = laneEnds.length;
      out.push(it);
    });
    cluster = [];
  }

  items.forEach((it) => {
    if (cluster.length && it.s >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  });
  flush();

  return out;
}
