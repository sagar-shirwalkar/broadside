import type { TemplateResult } from "lit";

/** A command is an async effect that resolves to an Action for the runtime to dispatch. */
export type Cmd<A> = () => Promise<A>;

/** Pure view function: render state into a Lit template. */
export type View<M, A> = (
  state: M,
  dispatch: (action: A) => void,
  run: (cmd: Cmd<A>) => void,
) => TemplateResult;

export interface Init<M, A> {
  model: M;
  cmd?: Cmd<A>;
}
