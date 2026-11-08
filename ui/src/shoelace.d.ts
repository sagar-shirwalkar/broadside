/** Minimal element typings so Lit templates can bind properties on Shoelace
 *  components without pulling in the full component type graph. */
import type { SlAlert } from "@shoelace-style/shoelace/dist/components/alert/alert.js";
import type { SlBadge } from "@shoelace-style/shoelace/dist/components/badge/badge.js";
import type { SlButton } from "@shoelace-style/shoelace/dist/components/button/button.js";
import type { SlCard } from "@shoelace-style/shoelace/dist/components/card/card.js";
import type { SlCheckbox } from "@shoelace-style/shoelace/dist/components/checkbox/checkbox.js";
import type { SlDialog } from "@shoelace-style/shoelace/dist/components/dialog/dialog.js";
import type { SlIcon } from "@shoelace-style/shoelace/dist/components/icon/icon.js";
import type { SlInput } from "@shoelace-style/shoelace/dist/components/input/input.js";
import type { SlSelect } from "@shoelace-style/shoelace/dist/components/select/select.js";
import type { SlSkeleton } from "@shoelace-style/shoelace/dist/components/skeleton/skeleton.js";
import type { SlTextarea } from "@shoelace-style/shoelace/dist/components/textarea/textarea.js";
import type { SlTooltip } from "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";

declare global {
  interface HTMLElementTagNameMap {
    "sl-alert": SlAlert;
    "sl-badge": SlBadge;
    "sl-button": SlButton;
    "sl-card": SlCard;
    "sl-checkbox": SlCheckbox;
    "sl-dialog": SlDialog;
    "sl-icon": SlIcon;
    "sl-input": SlInput;
    "sl-select": SlSelect;
    "sl-skeleton": SlSkeleton;
    "sl-textarea": SlTextarea;
    "sl-tooltip": SlTooltip;
  }
}

export {};
