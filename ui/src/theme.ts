/**
 * Theme handling. Dark is the default; a stored choice wins, otherwise we
 * follow prefers-color-scheme on first visit. The theme is a `data-theme`
 * attribute on <html> — every color is a token, so switching re-colors
 * everything (including rendered SVG paths) without re-rendering.
 */

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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme === "dark" ? "#0a0b0e" : "#fafaf7");
  }
}

export function initTheme(): void {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
    return;
  }
  // Dark is the product default, regardless of the OS preference.
  applyTheme("dark");
}

export function toggleTheme(): void {
  const next = currentTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}
