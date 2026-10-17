import { describe, expect, it } from "vitest";

import { dockReducer, type DockAction } from "../src/core/reducer";
import { collectLeaves, findLeaf } from "../src/core/tree";
import type {
  AreaMetrics,
  DockLayout,
  DockState,
  DockTab,
  FloatingWindow,
  LeafGroup,
  SplitGroup,
} from "../src/types";

const metrics: AreaMetrics = {
  width: 1000,
  height: 800,
  padding: 0,
  minWidth: 180,
  minHeight: 120,
};

const tab = (id: string): DockTab => ({ id, title: id.toUpperCase() });

const leaf = (id: string, ...tabs: string[]): LeafGroup => ({
  kind: "leaf",
  id,
  tabs: tabs.map(tab),
  activeTabId: tabs[tabs.length - 1] ?? null,
  state: "open",
});

const floating = (id: string, ...tabs: string[]): FloatingWindow => ({
  id,
  rect: { x: 10, y: 10, width: 400, height: 300 },
  tabs: tabs.map(tab),
  activeTabId: tabs[tabs.length - 1] ?? null,
  state: "open",
});

const stateOf = (layout: DockLayout, focusId: string | null = null): DockState => ({
  layout,
  focusId,
});

const row = (children: DockLayout["root"][], sizes: number[]): SplitGroup => ({
  kind: "split",
  id: "S-row",
  direction: "row",
  sizes,
  children: children as SplitGroup["children"],
});

const run = (state: DockState, ...actions: DockAction[]): DockState =>
  actions.reduce(dockReducer, state);

describe("open-tab", () => {
  it("creates the root group on an empty layout", () => {
    const next = run(stateOf({ root: null, floating: [] }), {
      type: "open-tab",
      tab: tab("t1"),
    });

    expect(next.layout.root?.kind).toBe("leaf");
    expect((next.layout.root as LeafGroup).tabs).toHaveLength(1);
    expect(next.focusId).toBe(next.layout.root?.id);
  });

  it("stacks into the focused group", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [] }, "L1");
    const next = run(state, { type: "open-tab", tab: tab("t2") });

    const group = next.layout.root as LeafGroup;
    expect(group.tabs.map((entry) => entry.id)).toEqual(["t1", "t2"]);
    expect(group.activeTabId).toBe("t2");
  });

  it("falls back to the first group when the focus is stale", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [] }, "GONE");
    const next = run(state, { type: "open-tab", tab: tab("t2") });

    expect((next.layout.root as LeafGroup).id).toBe("L1");
  });

  it("opens a floating window when given a rect and metrics", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [] });
    const next = run(state, {
      type: "open-tab",
      tab: tab("t2"),
      rect: { x: 50, y: 60, width: 400, height: 300 },
      metrics,
    });

    expect(next.layout.root).toBe(state.layout.root);
    expect(next.layout.floating).toHaveLength(1);
    expect(next.layout.floating[0].rect).toEqual({ x: 50, y: 60, width: 400, height: 300 });
    expect(next.focusId).toBe(next.layout.floating[0].id);
  });

  it("splits the focused group when given an explicit edge target", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [] }, "L1");
    const next = run(state, {
      type: "open-tab",
      tab: tab("t2"),
      target: { kind: "leaf", leafId: "L1", zone: "bottom" },
    });

    const split = next.layout.root as SplitGroup;
    expect(split.kind).toBe("split");
    expect(split.direction).toBe("column");
    expect(collectLeaves(split)).toHaveLength(2);
  });
});

describe("close-tab", () => {
  it("removes the tab and keeps the group", () => {
    const state = stateOf({ root: leaf("L1", "t1", "t2"), floating: [] });
    const next = run(state, { type: "close-tab", tabId: "t1" });

    const group = next.layout.root as LeafGroup;
    expect(group.tabs.map((entry) => entry.id)).toEqual(["t2"]);
    expect(group.activeTabId).toBe("t2");
  });

  it("activates the last tab when the active one closes", () => {
    const state = stateOf({ root: leaf("L1", "t1", "t2"), floating: [] });
    const next = run(state, { type: "close-tab", tabId: "t2" });

    expect((next.layout.root as LeafGroup).activeTabId).toBe("t1");
  });

  it("removes the group when its last tab closes", () => {
    const state = stateOf({
      root: row([leaf("L1", "t1"), leaf("L2", "t2")], [0.5, 0.5]),
      floating: [],
    });
    const next = run(state, { type: "close-tab", tabId: "t1" });

    // The split collapses into the surviving group.
    expect(next.layout.root?.kind).toBe("leaf");
    expect(next.layout.root?.id).toBe("L2");
  });

  it("removes a floating window when its last tab closes", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [floating("F1", "t2")] });
    const next = run(state, { type: "close-tab", tabId: "t2" });

    expect(next.layout.floating).toHaveLength(0);
  });

  it("clears the focus when the focused container disappears", () => {
    const state = stateOf({ root: null, floating: [floating("F1", "t1")] }, "F1");
    const next = run(state, { type: "close-tab", tabId: "t1" });

    expect(next.focusId).toBeNull();
  });
});

describe("activate-tab", () => {
  it("moves the tab to the active position and focuses the group", () => {
    const state = stateOf({ root: leaf("L1", "t1", "t2"), floating: [] });
    const next = run(state, { type: "activate-tab", tabId: "t1", containerId: "L1" });

    const group = next.layout.root as LeafGroup;
    expect(group.tabs.map((entry) => entry.id)).toEqual(["t2", "t1"]);
    expect(next.focusId).toBe("L1");
  });

  it("activates a tab inside a floating window", () => {
    const state = stateOf({ root: null, floating: [floating("F1", "t1", "t2")] });
    const next = run(state, { type: "activate-tab", tabId: "t1" });

    expect(next.layout.floating[0].activeTabId).toBe("t1");
    expect(next.focusId).toBe("F1");
  });

  it("returns the same state for an unknown tab", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [] });
    expect(run(state, { type: "activate-tab", tabId: "nope" })).toBe(state);
  });
});

describe("set-window-state", () => {
  it("maximizes and restores a docked group", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [] });
    const max = run(state, { type: "set-window-state", windowId: "L1", state: "maximized" });
    expect((max.layout.root as LeafGroup).state).toBe("maximized");

    const restored = run(max, { type: "set-window-state", windowId: "L1", state: "open" });
    expect((restored.layout.root as LeafGroup).state).toBe("open");
  });

  it("minimizes a floating window without touching its rect", () => {
    const state = stateOf({ root: null, floating: [floating("F1", "t1")] });
    const next = run(state, { type: "set-window-state", windowId: "F1", state: "minimized" });

    expect(next.layout.floating[0].state).toBe("minimized");
    expect(next.layout.floating[0].rect).toEqual(state.layout.floating[0].rect);
  });

  it("returns the same state for an unknown window", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [] });
    expect(run(state, { type: "set-window-state", windowId: "nope", state: "maximized" })).toBe(state);
  });
});

describe("raise", () => {
  it("moves the window to the top of the paint order", () => {
    const state = stateOf({ root: null, floating: [floating("F1", "t1"), floating("F2", "t2")] });
    const next = run(state, { type: "raise", windowId: "F1" });

    expect(next.layout.floating.map((window) => window.id)).toEqual(["F2", "F1"]);
    expect(next.focusId).toBe("F1");
  });

  it("returns the same array when the window is already on top", () => {
    const state = stateOf({ root: null, floating: [floating("F1", "t1"), floating("F2", "t2")] }, "F2");
    const next = run(state, { type: "raise", windowId: "F2" });

    expect(next.layout.floating).toBe(state.layout.floating);
    expect(next.focusId).toBe("F2");
  });
});

describe("float-tab", () => {
  it("tears a tab out of a group into a new floating window", () => {
    const state = stateOf({ root: leaf("L1", "t1", "t2"), floating: [] });
    const next = run(state, {
      type: "float-tab",
      tabId: "t1",
      windowId: "F1",
      rect: { x: 100, y: 120, width: 400, height: 300 },
    });

    expect((next.layout.root as LeafGroup).tabs.map((entry) => entry.id)).toEqual(["t2"]);
    expect(next.layout.floating).toHaveLength(1);
    expect(next.layout.floating[0].id).toBe("F1");
    expect(next.layout.floating[0].tabs.map((entry) => entry.id)).toEqual(["t1"]);
    expect(next.focusId).toBe("F1");
  });

  it("removes the group when the only tab is torn out", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [] });
    const next = run(state, {
      type: "float-tab",
      tabId: "t1",
      windowId: "F1",
      rect: { x: 0, y: 0, width: 400, height: 300 },
    });

    expect(next.layout.root).toBeNull();
    expect(next.layout.floating).toHaveLength(1);
  });
});

describe("set-rect", () => {
  it("normalises the rect and reopens a minimized window", () => {
    const minimized: FloatingWindow = { ...floating("F1", "t1"), state: "minimized" };
    const state = stateOf({ root: null, floating: [minimized] });
    const next = run(state, {
      type: "set-rect",
      windowId: "F1",
      rect: { x: -50, y: -50, width: 10, height: 10 },
      metrics,
    });

    expect(next.layout.floating[0].rect).toEqual({ x: 0, y: 0, width: 180, height: 120 });
    expect(next.layout.floating[0].state).toBe("open");
  });

  it("returns the same state when the rect is unchanged", () => {
    const state = stateOf({ root: null, floating: [floating("F1", "t1")] });
    const next = run(state, {
      type: "set-rect",
      windowId: "F1",
      rect: state.layout.floating[0].rect,
      metrics,
    });

    expect(next).toBe(state);
  });
});

describe("set-split-sizes", () => {
  it("updates the weights of a split", () => {
    const state = stateOf({
      root: row([leaf("L1", "t1"), leaf("L2", "t2")], [0.5, 0.5]),
      floating: [],
    });
    const next = run(state, { type: "set-split-sizes", splitId: "S-row", sizes: [0.7, 0.3] });

    expect((next.layout.root as SplitGroup).sizes).toEqual([0.7, 0.3]);
  });

  it("returns the same state for an unknown split", () => {
    const state = stateOf({
      root: row([leaf("L1", "t1"), leaf("L2", "t2")], [0.5, 0.5]),
      floating: [],
    });
    expect(run(state, { type: "set-split-sizes", splitId: "nope", sizes: [1] })).toBe(state);
  });
});

describe("set-layout / reflow", () => {
  it("replaces the layout and clears the focus", () => {
    const state = stateOf({ root: leaf("L1", "t1"), floating: [] }, "L1");
    const layout: DockLayout = { root: leaf("L9", "t9"), floating: [] };
    const next = run(state, { type: "set-layout", layout });

    expect(next.layout).toBe(layout);
    expect(next.focusId).toBeNull();
  });

  it("clamps floating windows back inside the area on reflow", () => {
    const wide: FloatingWindow = { ...floating("F1", "t1"), rect: { x: 900, y: 700, width: 400, height: 300 } };
    const state = stateOf({ root: null, floating: [wide] });
    const next = run(state, { type: "reflow", metrics });

    const rect = next.layout.floating[0].rect;
    expect(rect.x + rect.width).toBeLessThanOrEqual(metrics.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(metrics.height);
  });

  it("returns the same state when every window already fits", () => {
    const state = stateOf({ root: null, floating: [floating("F1", "t1")] });
    expect(run(state, { type: "reflow", metrics })).toBe(state);
  });
});

describe("drop", () => {
  it("focuses the target group after a stack drop", () => {
    const state = stateOf({
      root: null,
      floating: [floating("F1", "t2")],
    }, "F1");
    const next = run(state, {
      type: "drop",
      sourceId: "F1",
      rect: { x: 0, y: 0, width: 400, height: 300 },
      target: { kind: "empty" },
      metrics,
    });

    expect(next.layout.root?.id).toBe("F1");
    expect(next.focusId).toBe("F1");
  });

  it("keeps the source focused after a free drop that only moved it", () => {
    const state = stateOf({ root: null, floating: [floating("F1", "t1")] }, "F1");
    const next = run(state, {
      type: "drop",
      sourceId: "F1",
      rect: { x: 200, y: 200, width: 400, height: 300 },
      target: null,
      metrics,
    });

    expect(next.layout.floating[0].rect).toEqual({ x: 200, y: 200, width: 400, height: 300 });
    expect(next.focusId).toBe("F1");
  });
});

describe("id safety", () => {
  it("generates unique ids for every opened group", () => {
    const state = stateOf({ root: null, floating: [] });
    const next = run(
      state,
      { type: "open-tab", tab: tab("t1") },
      { type: "open-tab", tab: tab("t2"), target: { kind: "empty" } },
    );

    const leaves = collectLeaves(next.layout.root);
    expect(leaves).toHaveLength(1);
    expect(findLeaf(next.layout.root, leaves[0].id)).not.toBeNull();
  });
});
