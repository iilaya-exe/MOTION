import { $ } from "../dom.js";
import { icon } from "../icons.js";

/* index.html applies the stored theme before first paint; this module only has
   to keep the toggle button and the OS listener in sync afterwards. */

const THEME_KEY = "motionTheme";
const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;

function storedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

const effectiveTheme = () => storedTheme() || (darkQuery?.matches ? "dark" : "light");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  const btn = $("themeToggle");
  const dark = theme === "dark";
  btn.innerHTML = icon(dark ? "sun" : "moon") + `<span>${dark ? "Light mode" : "Dark mode"}</span>`;
  btn.setAttribute("title", dark ? "Switch to light mode" : "Switch to dark mode");
}

export function mount() {
  $("themeToggle").addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* preference just won't persist */
    }
    applyTheme(next);
  });

  // Follow the OS only while the user hasn't made an explicit choice.
  darkQuery?.addEventListener("change", () => {
    if (!storedTheme()) applyTheme(darkQuery.matches ? "dark" : "light");
  });

  applyTheme(effectiveTheme());
}
