import { pad } from "./dates.js";

/** At most this many event bars stack in one week; the rest become "+N more". */
export const CAL_MAX_LANES = 3;
/** Weeks never collapse below this, so a sparse month still looks like a grid. */
export const CAL_MIN_WEEK_HEIGHT = 124;

const HEAD_ROW_MIN = 46;
const BAR_ROW_H = 26;

/**
 * Lays out a month as six weeks of day cells plus horizontal event bars.
 *
 * A multi-day event is drawn as one bar per week it touches, clipped to that
 * week's columns. Lanes (vertical slots) are chosen greedily, but an event that
 * continues from the previous week keeps its previous lane where possible — so a
 * long event reads as one unbroken line down the month instead of zig-zagging.
 *
 * @param {number} year
 * @param {number} month 0-indexed
 * @param {{id: string, title: string, dates: string[]}[]} eventsList
 */
export function buildMonthWeeks(year, month, eventsList) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weeks = [];
  let prevLaneMap = {};

  for (let week = 0; week < 6; week++) {
    const dayKeys = Array.from({ length: 7 }, (_, d) => {
      const dayNum = week * 7 + d - firstDay + 1;
      return dayNum >= 1 && dayNum <= daysInMonth
        ? `${year}-${pad(month + 1)}-${pad(dayNum)}`
        : null;
    });

    // Events overlapping this week, clipped to this week's columns.
    const candidates = eventsList
      .map((ev) => {
        const colsInWeek = [];
        dayKeys.forEach((k, idx) => {
          if (k && ev.dates.includes(k)) colsInWeek.push(idx);
        });
        if (!colsInWeek.length) return null;

        const sortedDates = [...ev.dates].sort();
        const startCol = Math.min(...colsInWeek);
        const endCol = Math.max(...colsInWeek);

        return {
          ev,
          startCol,
          endCol,
          capStart: dayKeys[startCol] === sortedDates[0],
          capEnd: dayKeys[endCol] === sortedDates[sortedDates.length - 1],
        };
      })
      .filter(Boolean);

    // Continuing events are placed first so they can reclaim their old lane.
    const continuing = candidates
      .filter((b) => b.ev.id in prevLaneMap)
      .sort((a, b) => prevLaneMap[a.ev.id] - prevLaneMap[b.ev.id]);
    const fresh = candidates
      .filter((b) => !(b.ev.id in prevLaneMap))
      .sort(
        (a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol)
      );

    const lanes = [];
    const laneMap = {};
    const bars = [];
    let overflowCount = 0;

    [...continuing, ...fresh].forEach((bar) => {
      const fits = (li) =>
        !lanes[li] || !lanes[li].some((b) => !(bar.endCol < b.startCol || bar.startCol > b.endCol));

      const preferred = bar.ev.id in prevLaneMap ? prevLaneMap[bar.ev.id] : -1;

      let lane = -1;
      if (preferred !== -1 && preferred < CAL_MAX_LANES && fits(preferred)) {
        lane = preferred;
      } else {
        for (let li = 0; li < CAL_MAX_LANES; li++) {
          if (fits(li)) {
            lane = li;
            break;
          }
        }
      }

      if (lane === -1) {
        overflowCount++;
        return;
      }

      if (!lanes[lane]) lanes[lane] = [];
      lanes[lane].push({ startCol: bar.startCol, endCol: bar.endCol });
      laneMap[bar.ev.id] = lane;
      bars.push({ ...bar, lane });
    });

    const lanesUsed = lanes.length;
    const barRowCount = lanesUsed + (overflowCount > 0 ? 1 : 0);

    // Explicit rows: a header row sized for the day number and holiday chips,
    // then one fixed row per event lane. Without this the full-height day boxes
    // let the browser inflate row 1 and push the bars below the day cells.
    const filler = CAL_MIN_WEEK_HEIGHT - HEAD_ROW_MIN - barRowCount * BAR_ROW_H;
    const gridTemplateRows = [
      `minmax(${HEAD_ROW_MIN}px, auto)`,
      ...Array(barRowCount).fill(`${BAR_ROW_H}px`),
      filler > 0 ? `${filler}px` : "0px",
    ].join(" ");

    weeks.push({ dayKeys, bars, overflowCount, overflowRow: lanesUsed + 2, gridTemplateRows });
    prevLaneMap = laneMap;
  }

  return weeks;
}
