import { pad } from "./dates.js";

/* Philippine holidays.
   Regular and fixed special holidays are set by law and computed exactly.
   Movable lunar holidays (Chinese New Year, Eid'l Fitr, Eid'l Adha) come from an
   estimated table and are labelled "(est.)" — the Philippine government confirms
   the exact date by proclamation closer to the year. */

const CNY_DATES = {
  2024: "2024-02-10", 2025: "2025-01-29", 2026: "2026-02-17", 2027: "2027-02-06",
  2028: "2028-01-26", 2029: "2029-02-13", 2030: "2030-02-03",
};

const EID_FITR_DATES = {
  2024: "2024-04-10", 2025: "2025-03-31", 2026: "2026-03-20", 2027: "2027-03-10",
  2028: "2028-02-27", 2029: "2029-02-15", 2030: "2030-02-05",
};

const EID_ADHA_DATES = {
  2024: "2024-06-17", 2025: "2025-06-07", 2026: "2026-05-27", 2027: "2027-05-17",
  2028: "2028-05-06", 2029: "2029-04-25", 2030: "2030-04-15",
};

/** Anonymous Gregorian computus. */
function computeEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function lastMondayOfAugust(year) {
  const d = new Date(year, 8, 0); // Aug 31
  d.setDate(d.getDate() - ((d.getDay() - 1 + 7) % 7));
  return d;
}

const holidayCache = {};

/** @returns {Record<string, {name: string, type: "regular"|"special"}[]>} keyed by YYYY-MM-DD */
export function getHolidaysForYear(year) {
  if (holidayCache[year]) return holidayCache[year];

  const map = {};

  const addKey = (key, name, type) => {
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push({ name, type });
  };
  const add = (monthIndex, day, name, type) =>
    addKey(`${year}-${pad(monthIndex + 1)}-${pad(day)}`, name, type);
  const addDate = (d, name, type) => add(d.getMonth(), d.getDate(), name, type);

  // Fixed regular holidays
  add(0, 1, "New Year's Day", "regular");
  add(3, 9, "Araw ng Kagitingan", "regular");
  add(4, 1, "Labor Day", "regular");
  add(5, 12, "Independence Day", "regular");
  add(10, 30, "Bonifacio Day", "regular");
  add(11, 25, "Christmas Day", "regular");
  add(11, 30, "Rizal Day", "regular");

  // Fixed special (non-working) holidays
  add(1, 25, "EDSA People Power Anniversary", "special");
  add(7, 21, "Ninoy Aquino Day", "special");
  add(10, 1, "All Saints' Day", "special");
  add(10, 2, "All Souls' Day", "special");
  add(11, 8, "Feast of the Immaculate Conception", "special");
  add(11, 24, "Christmas Eve", "special");
  add(11, 31, "Last Day of the Year", "special");

  // Computed holidays
  addDate(lastMondayOfAugust(year), "National Heroes Day", "regular");
  const easter = computeEaster(year);
  addDate(addDays(easter, -3), "Maundy Thursday", "regular");
  addDate(addDays(easter, -2), "Good Friday", "regular");
  addDate(addDays(easter, -1), "Black Saturday", "special");

  // Estimated movable holidays
  addKey(CNY_DATES[year], "Chinese New Year (est.)", "special");
  addKey(EID_FITR_DATES[year], "Eid'l Fitr (est.)", "special");
  addKey(EID_ADHA_DATES[year], "Eid'l Adha (est.)", "special");

  holidayCache[year] = map;
  return map;
}
