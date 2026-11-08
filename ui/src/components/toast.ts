/**
 * Minimal toast notifications (Shoelace ships no toast component).
 * `notifyToast` appends an auto-dismissing message to a fixed-position
 * host; messages survive until removed or the timeout elapses.
 */

export type ToastVariant = "success" | "danger" | "warning" | "neutral";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const HOST_ID = "broadside-toasts";
let counter = 0;
let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host) return host;
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    host = existing;
    return host;
  }
  const el = document.createElement("div");
  el.id = HOST_ID;
  el.setAttribute("aria-live", "polite");
  el.className = "toast-host";
  const style = document.createElement("style");
  style.textContent = `
    .toast-host {
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 999;
      max-width: min(360px, calc(100vw - 40px));
    }
    .toast {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-left: 4px solid var(--text-muted);
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 14px;
      box-shadow: var(--shadow-card);
      animation: toast-in 160ms ease;
    }
    .toast-success { border-left-color: var(--success); }
    .toast-danger { border-left-color: var(--danger); }
    .toast-warning { border-left-color: var(--warning); }
    @keyframes toast-in {
      from { opacity: 0; transform: translateY(6px); }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(el);
  host = el;
  return host;
}

export function notifyToast(
  message: string,
  variant: ToastVariant = "neutral",
  durationMs = 5000,
): void {
  const hostEl = ensureHost();
  const id = ++counter;
  const el = document.createElement("div");
  el.className = `toast toast-${variant}`;
  el.dataset.toastId = String(id);
  el.textContent = message;
  hostEl.appendChild(el);
  const remove = () => el.remove();
  el.addEventListener("click", remove);
  if (durationMs > 0) {
    window.setTimeout(remove, durationMs);
  }
}
