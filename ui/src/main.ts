import "./styles/index.css";
import "./app/index.js";
import { adoptTokenFromUrl } from "./services/api.js";
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
