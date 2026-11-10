import { LitElement, css } from "lit";
import { customElement } from "lit/decorators.js";
import type { Cmd } from "../../core/types.js";
import { runCmd } from "../../core/cmd.js";
import { initialState, type Action, type State } from "./types.js";
import { update } from "./update.js";
import { view } from "./view.js";

export { initialState, update, view };
export type { State, Action };

@customElement("broadside-login")
export class LoginFeature extends LitElement {
  private model: State = initialState;

  private dispatch = (action: Action): void => {
    this.model = update(this.model, action);
    this.requestUpdate();
    if (action.type === "submit_succeeded") {
      this.dispatchEvent(
        new CustomEvent("login-success", { bubbles: true, composed: true }),
      );
    }
  };

  private run = (cmd: Cmd<Action>): void => {
    runCmd(cmd, this.dispatch);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.model = { ...initialState };
  }

  protected override render() {
    return view(this.model, this.dispatch, this.run);
  }

  static override styles = css`
    .page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: var(--s-6) var(--s-5);
      animation: fade-up var(--dur-slow) var(--ease);
    }
    .card {
      width: min(380px, 100%);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--s-6);
    }
    .brand {
      text-align: center;
      margin-bottom: var(--s-5);
    }
    .brand-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--amber);
      box-shadow: 0 0 12px var(--amber);
    }
    h1 {
      margin: var(--s-3) 0 0;
      font-size: var(--step-3);
      font-weight: 500;
      letter-spacing: -0.035em;
    }
    .sub {
      margin: 4px 0 0;
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: var(--step--1);
    }
    .warn {
      color: var(--warn);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      margin: 0 0 var(--s-4);
    }
    .field {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute);
      margin-bottom: var(--s-4);
    }
    .input {
      display: block;
      width: 100%;
      margin-top: var(--s-1);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: var(--step-0);
      padding: var(--s-2) var(--s-3);
      outline: none;
      box-sizing: border-box;
      transition: border-color var(--dur-fast) var(--ease);
    }
    .input:focus {
      border-color: var(--amber-dim);
    }
    .btn {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      width: 100%;
      padding: var(--s-3) var(--s-5);
      border-radius: var(--radius);
      cursor: pointer;
      transition: all var(--dur-fast) var(--ease);
    }
    .btn.primary {
      background: var(--amber);
      border: 1px solid var(--amber);
      color: var(--ink);
    }
    .btn.primary:hover:not(:disabled) {
      background: var(--amber-dim);
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .foot {
      margin-top: var(--s-6);
      text-align: center;
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute-2);
    }
  `;
}
