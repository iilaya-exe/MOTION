/* Dates are stored as "YYYY-MM-DD" strings in the user's local timezone. They
   are never parsed with `new Date(string)`, which would read them as UTC and
   shift the day for anyone west of Greenwich. */

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function dateKey(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey() {
  return dateKey(new Date());
}

export function formatDateLabel(key) {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatShortDate(key) {
  return parseDateKey(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "Aug 10" for one day, "Aug 10 – Aug 14" for a span. Non-contiguous date sets
 * get a day count so the range isn't read as every day in between.
 */
export function formatDateSpan(sortedDates) {
  if (!sortedDates.length) return "";

  const first = sortedDates[0];
  const last = sortedDates[sortedDates.length - 1];
  if (sortedDates.length === 1) return formatShortDate(first);

  const spanDays = Math.round((parseDateKey(last) - parseDateKey(first)) / 86400000) + 1;
  const label = formatShortDate(first) + " – " + formatShortDate(last);
  return spanDays === sortedDates.length ? label : `${label} (${sortedDates.length} days)`;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const DAY_CHIPS = ["S", "M", "T", "W", "Th", "F", "S"];
export const DAY_ABBR = ["Su", "M", "T", "W", "Th", "F", "Sa"];
export const DAY_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
