/* Inline SVG icon set. Keeps runtime-rendered markup consistent with the static
   icons written directly into index.html — same viewBox, same stroke settings. */

const ICON_PATHS = {
  page: '<path d="M14 3v5h5"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M9 13.5h6M9 17h4"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3.5 6h17M9 6V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V6M18.5 6l-.9 13a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.2 2.5 2.5 5.1-5.4"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  checkSquare: '<rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="m8 12.2 2.6 2.6L16 9.4"/>',
  checklist: '<path d="m3 6.5 1.8 1.8L8 5.2M3 16.5l1.8 1.8L8 15.2M11.5 7h9.5M11.5 17h9.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.2 2.2"/>',
  calendarSm: '<rect x="3" y="5" width="18" height="16" rx="3.5"/><path d="M3 10h18M8.5 3v4M15.5 3v4"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.1M12 19.3v2.1M4.7 4.7l1.5 1.5M17.8 17.8l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.7 19.3l1.5-1.5M17.8 6.2l1.5-1.5"/>',
  moon: '<path d="M20.2 13.6A8.3 8.3 0 0 1 10.4 3.8a8.5 8.5 0 1 0 9.8 9.8Z"/>',
  pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  flag: '<path d="M5 21V4.5M5 5.2h11.5l-2 3.6 2 3.6H5"/>',
  broom: '<path d="M4 20.5 9.5 15M9.5 15l-2-2 7-7 2 2-7 7Zm4.5-9 3.5-3.5a2.1 2.1 0 0 1 3 3L17 9"/><path d="M12.5 17.5 15 20l5.5-5.5"/>',
  repeat: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 12V9a3 3 0 0 1 3-3h14"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12v3a3 3 0 0 1-3 3h-14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>',
  bell: '<path d="M6 8.5a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 14.5 6 8.5Z"/><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0"/>',
  home: '<path d="M3 9.8 12 3l9 6.8V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.8Z"/>',
  download: '<path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5"/>',
  printer: '<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8" rx="2"/><path d="M7 13.5h10V21H7z"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v14.5a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 18V4.5Z"/><path d="M5 16.5h13.5"/>',
};

/**
 * @returns {string} an <svg> string ready to drop into an innerHTML template
 *
 * An unknown name used to produce `<svg>undefined</svg>` — a perfectly valid,
 * completely invisible element. Nothing errored and nothing showed. It now warns
 * and draws a dashed placeholder, so a missing icon is impossible to miss.
 */
export function icon(name, cls = "icon") {
  const paths = ICON_PATHS[name];

  if (!paths) {
    console.warn(`icon(): no such icon "${name}"`);
    return (
      `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-dasharray="3 2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>`
    );
  }

  return (
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
  );
}
