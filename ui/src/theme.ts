/** Theme handling. Shoelace components read CSS variables, so toggling the
 *  `sl-theme-dark` class (plus our own tokens in theme.css via
 *  `data-theme`) re-colors everything, including the SVG charts. */

const THEME_KEY = "broadside.theme";

export type Theme = "light" | "dark";

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // Shoelace's dark theme stylesheet is keyed off this class.
  root.classList.toggle("sl-theme-dark", theme === "dark");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      theme === "dark" ? "#1d1d20" : "#faf8f4",
    );
  }
}

export function initTheme(): void {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
    return;
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

export function toggleTheme(): void {
  const next = currentTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}
