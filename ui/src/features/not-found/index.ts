import { LitElement, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { initialState, type Action, type State } from "./types.js";
import { update } from "./update.js";
import { view } from "./view.js";

export { initialState, update, view };
export type { State, Action };

@customElement("broadside-not-found")
export class NotFoundFeature extends LitElement {
  @property() message = "Page not found";
  private model: State = initialState(this.message);

  private dispatch = (action: Action): void => {
    this.model = update(this.model, action);
    this.requestUpdate();
  };

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("message")) {
      this.dispatch({ type: "set_message", message: this.message });
    }
  }

  protected override render() {
    return view(this.model);
  }

  static override styles = css`
    .page {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--s-4);
      padding: var(--s-10) 0;
      animation: fade-up var(--dur-slow) var(--ease);
    }
    .code {
      margin: 0;
      font-size: var(--step-5);
      font-weight: 500;
      color: var(--mute-2);
      line-height: 1;
      letter-spacing: -0.035em;
    }
    h1 {
      margin: 0;
      font-size: var(--step-2);
    }
    .hint {
      margin: 0;
      color: var(--mute);
      font-family: var(--font-mono);
      font-size: var(--step--1);
    }
    .btn {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      padding: var(--s-2) var(--s-5);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .btn:hover {
      border-color: var(--amber);
      color: var(--amber);
    }
  `;
}
