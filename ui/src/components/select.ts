import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Custom select dropdown: card-like appearance matching the app's
 * tooltip/dialog styling (mono font, hairline border, graphite surface).
 * Closes on outside click or Escape. No native browser UI.
 *
 * Usage:
 *   <broadside-select
 *     .options=${[{value:"30",label:"30 days"}]}
 *     .value=${"30"}
 *     @change=${(e) => (this.days = e.detail.value)}
 *   ></broadside-select>
 */
@customElement("broadside-select")
export class Select extends LitElement {
  @property({ type: Array }) options: SelectOption[] = [];
  @property() value = "";
  @property() label = "";
  @state() private open = false;

  private onDocClick = (e: MouseEvent) => {
    if (!this.open) return;
    const path = e.composedPath();
    if (!path.includes(this)) this.open = false;
  };

  private onDocKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.open = false;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocClick);
    document.addEventListener("keydown", this.onDocKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("click", this.onDocClick);
    document.removeEventListener("keydown", this.onDocKey);
  }

  private toggle(e: Event) {
    e.stopPropagation();
    this.open = !this.open;
  }

  private choose(e: Event, value: string) {
    e.stopPropagation();
    this.open = false;
    if (value === this.value) return;
    this.dispatchEvent(
      new CustomEvent("change", { detail: { value }, bubbles: true, composed: true }),
    );
  }

  private current(): SelectOption | undefined {
    return this.options.find((o) => o.value === this.value);
  }

  override render() {
    const current = this.current();
    return html`
      <span class="wrap">
        ${this.label ? html`<span class="label">${this.label}</span>` : nothing}
        <button
          class="trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded=${this.open}
          @click=${this.toggle}
        >
          <span>${current?.label ?? this.value}</span>
          <span class="chevron" aria-hidden="true">▾</span>
        </button>
        ${this.open
          ? html`<ul class="menu" role="listbox">
              ${this.options.map(
                (o) => html`<li
                  role="option"
                  aria-selected=${o.value === this.value}
                  class=${o.value === this.value ? "selected" : ""}
                  @click=${(e: Event) => this.choose(e, o.value)}
                >
                  ${o.label}
                </li>`,
              )}
            </ul>`
          : nothing}
      </span>
    `;
  }

  static styles = css`
    .wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--s-2);
    }
    .label {
      font-family: var(--font-mono);
      font-size: var(--step--1);
      color: var(--mute);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--s-2);
      font-family: var(--font-mono);
      font-size: var(--step--1);
      padding: var(--s-2) var(--s-3);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: border-color var(--dur-fast) var(--ease);
    }
    .trigger:hover {
      border-color: var(--amber-dim);
    }
    .chevron {
      color: var(--mute);
      font-size: 10px;
    }
    .menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      min-width: 160px;
      margin: 0;
      padding: var(--s-1);
      list-style: none;
      background: var(--surface-2);
      border: 1px solid var(--amber);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-card);
      z-index: 30;
      font-family: var(--font-mono);
      font-size: var(--step--1);
    }
    .menu li {
      padding: var(--s-2) var(--s-3);
      border-radius: var(--radius);
      cursor: pointer;
      color: var(--text-dim);
      white-space: nowrap;
    }
    .menu li:hover {
      background: var(--surface);
      color: var(--text);
    }
    .menu li.selected {
      color: var(--amber);
    }
  `;
}
