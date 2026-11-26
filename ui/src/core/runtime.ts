import { LitElement } from "lit";
import type { Cmd, Init, View } from "./types.ts";
import { runCmd } from "./cmd.ts";

/**
 * TEA/MVU runtime: binds a pure (init/update/view) triple to a Lit custom element.
 * The view receives (model, dispatch, run) so it can dispatch actions or run commands.
 */
export function createTeaComponent<M, A>(
  tagName: string,
  initFn: () => Init<M, A>,
  updateFn: (model: M, action: A) => M,
  viewFn: View<M, A>,
): void {
  class TeaElement extends LitElement {
    private model!: M;

    override connectedCallback(): void {
      super.connectedCallback();
      const { model, cmd } = initFn();
      this.model = model;
      if (cmd) runCmd(cmd, this.dispatch);
      this.requestUpdate();
    }

    dispatch = (action: A): void => {
      this.model = updateFn(this.model, action);
      this.requestUpdate();
    };

    run = (cmd: Cmd<A>): void => {
      runCmd(cmd, this.dispatch);
    };

    protected override render() {
      return viewFn(this.model, this.dispatch, this.run);
    }
  }

  if (!customElements.get(tagName)) {
    customElements.define(tagName, TeaElement);
  }
}
