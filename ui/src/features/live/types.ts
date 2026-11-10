export interface State { readonly runId: string }
export const initialState = (runId = ""): State => ({ runId });
export type Action = { type: "noop" };
