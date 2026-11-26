import { notifyToast } from "../components/toast.ts";

const TOKEN_KEY = "broadside.token";

/** Dispatched on window when the API answers 401. The app shell shows the
 *  login view in response. */
export const UNAUTHORIZED_EVENT = "broadside:unauthorized";

/** Dispatched by run-detail / live-view so the topbar can show the run's
 *  status next to its title. */
export const RUN_STATUS_EVENT = "broadside:run-status";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Adopt a `?token=` on first page load (handy for shared links). */
export function adoptTokenFromUrl(): void {
  const token = new URLSearchParams(window.location.search).get("token");
  if (token) setToken(token);
}

/**
 * Authenticated fetch wrapper. Adds the stored Bearer token, surfaces a
 * login view on 401, and shows a toast on other failures.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Network error — server unreachable");
  }

  if (res.status === 401) {
    if (token) clearToken();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(401, "unauthorized");
  }

  if (!res.ok) {
    // Error bodies may be JSON ({ error }) or plain text (proxy/crash 500s).
    const text = await res.text().catch(() => "");
    let message = `request failed (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) message = parsed.error;
    } catch {
      if (text.trim()) message = text.trim();
    }
    notifyToast(`Failed to load: ${message}`, "danger");
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as T;
}

/** EventSource URL with the token appended — EventSource cannot set headers. */
export function sseUrl(path: string): string {
  const token = getToken();
  if (!token) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}token=${encodeURIComponent(token)}`;
}

const inFlight = new Map<string, Promise<unknown>>();

/** Deduplicates concurrent identical GETs (React-style double effects in
 *  development and repeated view renders). */
export function apiGet<T>(path: string): Promise<T> {
  const existing = inFlight.get(path);
  if (existing) return existing as Promise<T>;
  const promise = api<T>(path).finally(() => inFlight.delete(path));
  inFlight.set(path, promise);
  return promise;
}
