import { html, type TemplateResult } from "lit";
import type { Cmd } from "../../core/types.js";
import type { RunRow, RunStatus } from "../../types.js";
import { formatDuration, formatMs, formatNumber, formatPercent, latencyClass, relativeTime } from "../../lib/format.js";
import { navigate } from "../../lib/router.js";
import "../../components/skeleton.js";
import "../../components/confirm-dialog.js";
import "../../components/status-dot.js";
import "../../components/select.js";
import { deleteRun, loadRuns } from "./cmds.js";
import type { Action, State } from "./types.js";

const PAGE_SIZES = [25, 50, 100];

function page(state: State): number {
  return Math.floor(state.offset / state.limit) + 1;
}
function hasNext(state: State): boolean {
  return state.runs.length === state.limit;
}
function statusTone(status: RunStatus): "ok" | "warn" | "bad" {
  if (status === "completed") return "ok";
  if (status === "failed") return "bad";
  return "warn";
}
function statusTextClass(status: RunStatus): string {
  if (status === "completed") return "status-ok";
  if (status === "failed") return "status-bad";
  return "status-warn";
}
function pageNumbers(state: State): Array<number | "…"> {
  const current = page(state);
  const lastPage = hasNext(state) ? current + 1 : current;
  if (lastPage <= 7) return Array.from({ length: lastPage }, (_, i) => i + 1);
  const pages = new Set<number>([1, 2, 3, current - 1, current, current + 1, lastPage]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= lastPage).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  if (prev < lastPage) out.push("…");
  return out;
}

export function view(
  state: State,
  dispatch: (a: Action) => void,
  run: (c: Cmd<Action>) => void,
): TemplateResult {
  const goToPage = (p: number) => {
    const offset = Math.max(0, p - 1) * state.limit;
    dispatch({ type: "set_offset", offset });
    dispatch({ type: "load_started" });
    run(loadRuns(state.limit, offset));
  };
  const changePage = (delta: number) => goToPage(page(state) + delta);
  const onLimit = (e: CustomEvent<{ value: string }>) => {
    const limit = Number(e.detail.value);
    dispatch({ type: "set_limit", limit });
    dispatch({ type: "load_started" });
    run(loadRuns(limit, 0));
  };
  const onConfirmDelete = () => {
    if (!state.confirmTarget) return;
    dispatch({ type: "delete_started" });
    run(deleteRun(state.confirmTarget));
  };

  return html`
    <div class="page">
      <div class="toolbar">
        <h1>Runs</h1>
        <div class="controls">
          <broadside-select
            .options=${PAGE_SIZES.map((n) => ({ value: String(n), label: `${n}/page` }))}
            .value=${String(state.limit)}
            @change=${onLimit}
            aria-label="Rows per page"
          ></broadside-select>
          <button
            class="btn primary"
            @click=${(e: Event) =>
              (e.currentTarget as HTMLElement).dispatchEvent(
                new CustomEvent("new-run", { bubbles: true, composed: true }),
              )}
          >
            + new run
          </button>
        </div>
      </div>

      <div class="table-wrap">
        ${state.loading
          ? html`<broadside-skeleton variant="table"></broadside-skeleton>`
          : state.runs.length === 0
            ? html`<p class="empty">// no runs yet — hit "+ new run"</p>`
            : html`<table>
                <thead>
                  <tr>
                    <th>id</th><th>started</th><th>duration</th><th>requests</th>
                    <th>p50</th><th>p95</th><th>p99</th><th>errors</th><th>status</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  ${state.runs.map(
                    (row: RunRow) => html`<tr @click=${() => navigate(`/runs/${row.id}`)}>
                      <td class="mono id">${row.id.slice(0, 8)}</td>
                      <td class="muted" title=${row.started_at}>${relativeTime(row.started_at)}</td>
                      <td>${formatDuration(row.duration_ms)}</td>
                      <td>${formatNumber(row.total_requests)}</td>
                      <td class=${latencyClass(row.p50)}>${formatMs(row.p50)}</td>
                      <td class=${latencyClass(row.p95)}>${formatMs(row.p95)}</td>
                      <td class=${latencyClass(row.p99)}>${formatMs(row.p99)}</td>
                      <td>${formatPercent(row.error_rate)}</td>
                      <td class="status-cell ${statusTextClass(row.status)}">
                        <broadside-status-dot
                          tone=${statusTone(row.status)}
                          .pulse=${row.status === "running"}
                        ></broadside-status-dot>
                        <span>${row.status}</span>
                        ${row.partial_data
                          ? html`<span class="warn" title=${`partial data${row.dropped_points ? ` (dropped ${row.dropped_points})` : ""}${row.failure_reason ? ` · ${row.failure_reason}` : ""}`}> ⚠</span>`
                          : row.failure_reason
                            ? html`<span class="muted" title=${row.failure_reason}> · ${row.failure_reason}</span>`
                            : ""}
                      </td>
                      <td>
                        <button
                          class="icon-text-btn"
                          title="Delete run"
                          aria-label="Delete run"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            dispatch({ type: "ask_delete", target: row });
                          }}
                        >
                          <svg class="icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                            <path d="M3 4h10M6 4V3h4v1M5 4v8h6V4M7 6v4M9 6v4" />
                          </svg>
                          delete
                        </button>
                      </td>
                    </tr>`,
                  )}
                </tbody>
              </table>`}
      </div>

      <div class="pager">
        <button class="btn" ?disabled=${state.offset === 0 || state.loading} @click=${() => changePage(-1)}>← Previous</button>
        ${pageNumbers(state).map((entry) =>
          entry === "…"
            ? html`<span class="ellipsis" aria-hidden="true">…</span>`
            : html`<button
                class="page-btn ${entry === page(state) ? "current" : ""}"
                aria-current=${entry === page(state) ? "page" : undefined}
                @click=${() => goToPage(entry as number)}
              >${entry}</button>`,
        )}
        <button class="btn" ?disabled=${!hasNext(state) || state.loading} @click=${() => changePage(1)}>Next →</button>
      </div>
    </div>

    <broadside-confirm-dialog
      .open=${state.confirmOpen}
      .busy=${state.confirmBusy}
      .title=${state.confirmTarget?.status === "running" ? "kill run?" : "delete run?"}
      .body=${state.confirmTarget?.status === "running"
        ? "This will terminate the Artillery process. Partial data may be lost."
        : "This will permanently remove the run and all its metrics."}
      .confirmLabel=${state.confirmTarget?.status === "running" ? "kill" : "delete"}
      @close=${() => dispatch({ type: "close_confirm" })}
      @confirm=${onConfirmDelete}
    ></broadside-confirm-dialog>
  `;
}


