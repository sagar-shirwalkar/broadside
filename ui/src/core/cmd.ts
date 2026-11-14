import type { Cmd } from "./types.ts";

/** Execute a command and dispatch its resulting action. */
export function runCmd<A>(cmd: Cmd<A>, dispatch: (a: A) => void): void {
  void cmd()
    .then(dispatch)
    .catch(() => {
      // Commands own their error handling; a rejected cmd is ignored by the runtime.
    });
}
