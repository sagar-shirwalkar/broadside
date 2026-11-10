// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

async function mount<T extends HTMLElement>(tag: string, props: Record<string, unknown> = {}): Promise<T> {
  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

async function settled(el: HTMLElement): Promise<void> {
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("chart-panel rendering", () => {
  it("renders the heading title (regression: native title-attribute removal must not clear heading)", async () => {
    await import("./chart-panel.js");
    const el = await mount<HTMLElement & { title: string }>("broadside-chart-panel", {
      title: "throughput",
      series: [],
    });
    // Simulate attribute-based setting (as Lit templates do) then settle.
    el.setAttribute("title", "throughput");
    await settled(el);
    const h3 = el.shadowRoot?.querySelector("h3");
    expect(h3?.textContent).toContain("throughput");
    // Host must not keep the native title attribute (obscures chart hover).
    expect(el.hasAttribute("title")).toBe(false);
  });
});

describe("kpi-card rendering", () => {
  it("renders value and does not crash on null/empty spark (regression)", async () => {
    await import("./kpi-card.js");
    const el = await mount<HTMLElement>("broadside-kpi-card", {
      label: "p95",
      value: "210ms",
      spark: null,
      dot: "peach",
    });
    expect(el.shadowRoot?.textContent).toContain("p95");
    expect(el.shadowRoot?.textContent).toContain("210ms");
    expect(el.shadowRoot?.querySelector(".spark")).toBeNull();

    // Empty spark also fine.
    Object.assign(el, { spark: [] });
    await settled(el);
    expect(el.shadowRoot?.querySelector(".spark")).toBeNull();
  });

  it("renders a sparkline path when given enough points", async () => {
    await import("./kpi-card.js");
    const el = await mount<HTMLElement>("broadside-kpi-card", {
      label: "rps",
      value: "10",
      spark: [1, 2, 3, 4],
      dot: "mint",
    });
    const path = el.shadowRoot?.querySelector("path.spark-line");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")).toContain("M");
  });
});

describe("status-dot rendering", () => {
  it("renders the requested tone and pulse state", async () => {
    await import("./status-dot.js");
    const ok = await mount<HTMLElement>("broadside-status-dot", { tone: "ok" });
    expect(ok.shadowRoot?.querySelector(".dot-ok")).not.toBeNull();

    const warn = await mount<HTMLElement>("broadside-status-dot", { tone: "warn", pulse: true });
    expect(warn.shadowRoot?.querySelector(".dot-warn.pulse")).not.toBeNull();

    const bad = await mount<HTMLElement>("broadside-status-dot", { tone: "bad" });
    expect(bad.shadowRoot?.querySelector(".dot-bad")).not.toBeNull();
  });
});

describe("info-tip rendering", () => {
  it("renders tooltip text", async () => {
    await import("./info-tip.js");
    const el = await mount<HTMLElement>("broadside-info-tip", {
      text: "hello tooltip",
      label: "about",
    });
    expect(el.shadowRoot?.textContent).toContain("hello tooltip");
    expect(el.shadowRoot?.querySelector('[role="tooltip"]')).not.toBeNull();
  });
});
