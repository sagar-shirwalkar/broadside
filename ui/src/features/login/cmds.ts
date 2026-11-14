import type { Cmd } from "../../core/types.ts";
import { api, ApiError, setToken } from "../../services/api.ts";
import type { Action } from "./types.ts";

export function submitLogin(token: string): Cmd<Action> {
  return async () => {
    const t = token.trim();
    if (!t) return { type: "submit_failed", error: "enter the API token" };
    setToken(t);
    try {
      await api<unknown[]>("/api/runs?limit=1");
      return { type: "submit_succeeded" };
    } catch (err) {
      return {
        type: "submit_failed",
        error:
          err instanceof ApiError && err.status === 401
            ? "that token was rejected. try again."
            : "could not reach the server.",
      };
    }
  };
}
