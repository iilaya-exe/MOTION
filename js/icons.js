/* Inline SVG icon set. Keeps runtime-rendered markup consistent with the static
   icons written directly into index.html — same viewBox, same stroke settings. */

const ICON_PATHS = {
  page: '<path d="M14 3v5h5"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M9 13.5h6M9 17h4"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3.5 6h17M9 6V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V6M18.5 6l-.9 13a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.2 2.5 2.5 5.1-5.4"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.2 2.2"/>',
  calendarSm: '<rect x="3" y="5" width="18" height="16" rx="3.5"/><path d="M3 10h18M8.5 3v4M15.5 3v4"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.1M12 19.3v2.1M4.7 4.7l1.5 1.5M17.8 17.8l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.7 19.3l1.5-1.5M17.8 6.2l1.5-1.5"/>',
  moon: '<path d="M20.2 13.6A8.3 8.3 0 0 1 10.4 3.8a8.5 8.5 0 1 0 9.8 9.8Z"/>',
  pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v14.5a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 18V4.5Z"/><path d="M5 16.5h13.5"/>',
};

/** @returns {string} an <svg> string ready to drop into an innerHTML template */
export function icon(name, cls = "icon") {
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`
  );
}
