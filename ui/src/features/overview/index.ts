import { LitElement, css } from "lit";
import { customElement } from "lit/decorators.js";
import type { Cmd } from "../../core/types.ts";
import { runCmd } from "../../core/cmd.ts";
import { loadOverview } from "./cmds.ts";
import { initialState, type Action, type State } from "./types.ts";
import { update } from "./update.ts";
import { view } from "./view.ts";

export { initialState, update, view };
export type { State, Action };

/**
 * Overview feature element (TEA): pure state/update/view with cmds for IO.
 */
@customElement("broadside-overview-view")
export class OverviewFeature extends LitElement {
  private model: State = initialState;

  private dispatch = (action: Action): void => {
    this.model = update(this.model, action);
    this.requestUpdate();
  };

  private run = (cmd: Cmd<Action>): void => {
    runCmd(cmd, this.dispatch);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.model = { ...initialState };
    this.dispatch({ type: "load_started" });
    this.run(loadOverview(this.model.trendDays, this.model.frequencyInterval));
  }

  protected override render() {
    return view(this.model, this.dispatch, this.run);
  }

  static override styles = css`
    :host {
      display: block;
      color: var(--text-primary);
      min-width: 0;
      max-width: 100%;
      overflow-x: clip;
    }
    .slo-strip-wrap {
      margin-bottom: 12px;
      min-width: 0;
    }
    .slo-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s-3);
      padding: var(--s-3) var(--s-4);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      flex-wrap: wrap;
    }
    .slo-left,
    .slo-right {
      display: inline-flex;
      align-items: center;
      gap: var(--s-3);
      min-width: 0;
      flex-wrap: wrap;
    }
    .slo-label,
    .slo-target-label {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      font-weight: 500;
      color: var(--text);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .slo-value {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      font-weight: 600;
      color: var(--text);
    }
    .slo-target {
      font-family: var(--font-mono);
      font-size: var(--step-0);
      color: var(--text);
    }
    .grid-slos {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 12px;
      min-width: 0;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
      margin-bottom: 12px;
      min-width: 0;
    }
    .grid-slos > *,
    .grid-2 > * {
      min-width: 0;
    }
    @media (max-width: 1100px) {
      .grid-2,
      .grid-slos {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .chart-footer {
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .table-wrap {
      overflow: auto;
      min-width: 0;
    }
    .panel-head {
      margin: 0 0 10px;
      font-family: var(--font-mono);
      font-size: var(--step-0);
      font-weight: 500;
      color: var(--text);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: var(--s-2);
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .data-table th {
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: var(--tracking-wide);
      color: var(--text-muted);
      padding: 6px 8px;
      border-bottom: 1px solid var(--hairline);
    }
    .data-table td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--hairline);
      white-space: nowrap;
    }
    .data-table tbody tr {
      cursor: pointer;
    }
    .data-table tbody tr:hover {
      background: var(--surface-2);
    }
    .status-cell {
      display: flex;
      align-items: center;
      gap: var(--s-2);
    }
    .muted {
      color: var(--text-muted);
    }
    .panel {
      background: var(--surface-1);
      border: 1px solid var(--border);
      border-radius: var(--radius-xs);
      padding: 12px;
      min-width: 0;
    }
    .panel.error {
      color: var(--red);
      border-color: var(--red);
    }
    .alert-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .alert-list li {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 6px 0;
      border-bottom: 1px solid var(--hairline);
      font-size: 13px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .alert-list li .mono {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .alert-list li .muted {
      min-width: 0;
    }
    .alert-delta {
      color: var(--red);
      font-family: var(--font-mono);
      font-weight: 600;
      flex: none;
    }
    .alert-list .run-link {
      color: var(--amber);
      text-decoration: none;
      margin-left: auto;
      flex: none;
    }
    .alert-list .run-link:hover {
      color: var(--amber-dim);
    }
    .mono {
      font-family: var(--font-mono);
    }
  `;
}
