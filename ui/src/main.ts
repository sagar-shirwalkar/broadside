import "@shoelace-style/shoelace/dist/themes/light.css";
import "@shoelace-style/shoelace/dist/themes/dark.css";
import "./theme.css";
import "./app.js";
import { adoptTokenFromUrl } from "./api.js";
import { initTheme } from "./theme.js";

adoptTokenFromUrl();
initTheme();

// Offline shell (production only — the Vite dev server bypasses it).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // No offline shell; the app still works online.
    });
  });
}
