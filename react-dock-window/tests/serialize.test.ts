import { describe, expect, it } from "vitest";

import { parseLayout, serializeLayout } from "../src/core/serialize";
import type { DockLayout, DockTab, FloatingWindow, LeafGroup, SplitGroup } from "../src/types";

const tab = (id: string): DockTab => ({ id, title: id.toUpperCase() });

const layout: DockLayout = {
  root: {
    kind: "split",
    id: "S1",
    direction: "row",
    sizes: [0.6, 0.4],
    children: [
      { kind: "leaf", id: "L1", tabs: [tab("t1"), tab("t2")], activeTabId: "t2", state: "open" },
      {
        kind: "split",
        id: "S2",
        direction: "column",
        sizes: [0.5, 0.5],
        children: [
          { kind: "leaf", id: "L2", tabs: [tab("t3")], activeTabId: "t3", state: "maximized" },
          { kind: "leaf", id: "L3", tabs: [tab("t4")], activeTabId: "t4", state: "minimized" },
        ],
      },
    ],
  },
  floating: [
    {
      id: "F1",
      rect: { x: 40, y: 60, width: 520, height: 320 },
      tabs: [tab("t5")],
      activeTabId: "t5",
      state: "open",
    } satisfies FloatingWindow,
  ],
};

describe("serializeLayout / parseLayout", () => {
  it("round-trips a nested layout", () => {
    const restored = parseLayout(serializeLayout(layout));

    expect(restored).toEqual(layout);
  });

  it("round-trips tab payloads and closable flags", () => {
    const withData: DockLayout = {
      root: {
        kind: "leaf",
        id: "L1",
        tabs: [{ ...tab("t1"), closable: false, data: { kind: "editor", file: "a.ts" } }],
        activeTabId: "t1",
        state: "open",
      },
      floating: [],
    };

    const restored = parseLayout(serializeLayout(withData));
    const group = restored?.root as LeafGroup;
    expect(group.tabs[0].closable).toBe(false);
    expect(group.tabs[0].data).toEqual({ kind: "editor", file: "a.ts" });
  });

  it("keeps window states across a round trip", () => {
    const restored = parseLayout(serializeLayout(layout));
    const split = restored?.root as SplitGroup;
    const inner = split.children[1] as SplitGroup;

    expect((inner.children[0] as LeafGroup).state).toBe("maximized");
    expect((inner.children[1] as LeafGroup).state).toBe("minimized");
  });

  it("rejects non-JSON input", () => {
    expect(parseLayout("{not json")).toBeNull();
    expect(parseLayout("")).toBeNull();
  });

  it("rejects layouts without the expected version", () => {
    expect(parseLayout(JSON.stringify({ version: 2, root: null, floating: [] }))).toBeNull();
    expect(parseLayout(JSON.stringify({ root: null }))).toBeNull();
  });

  it("drops duplicate window ids instead of rendering them twice", () => {
    const raw = JSON.stringify({
      version: 1,
      root: { kind: "leaf", id: "L1", tabs: [tab("t1")], activeTabId: "t1", state: "open" },
      floating: [
        { id: "F1", rect: { x: 0, y: 0, width: 100, height: 100 }, tabs: [tab("t2")], activeTabId: "t2", state: "open" },
        { id: "F1", rect: { x: 5, y: 5, width: 100, height: 100 }, tabs: [tab("t3")], activeTabId: "t3", state: "open" },
      ],
    });

    const restored = parseLayout(raw);
    expect(restored?.floating).toHaveLength(1);
    expect(restored?.floating[0].tabs[0].id).toBe("t2");
  });

  it("drops duplicate tab ids so a tab never renders twice", () => {
    const raw = JSON.stringify({
      version: 1,
      root: {
        kind: "leaf",
        id: "L1",
        tabs: [tab("t1"), tab("t1")],
        activeTabId: "t1",
        state: "open",
      },
      floating: [],
    });

    const restored = parseLayout(raw);
    expect((restored?.root as LeafGroup).tabs).toHaveLength(1);
  });

  it("drops empty groups rather than rendering a blank window", () => {
    const raw = JSON.stringify({
      version: 1,
      root: { kind: "leaf", id: "L1", tabs: [], activeTabId: null, state: "open" },
      floating: [],
    });

    expect(parseLayout(raw)?.root).toBeNull();
  });

  it("collapses a split whose children were all dropped", () => {
    const raw = JSON.stringify({
      version: 1,
      root: {
        kind: "split",
        id: "S1",
        direction: "row",
        sizes: [0.5, 0.5],
        children: [
          { kind: "leaf", id: "L1", tabs: [], activeTabId: null, state: "open" },
          { kind: "leaf", id: "L2", tabs: [], activeTabId: null, state: "open" },
        ],
      },
      floating: [],
    });

    expect(parseLayout(raw)?.root).toBeNull();
  });

  it("keeps the surviving child when a split loses one side", () => {
    const raw = JSON.stringify({
      version: 1,
      root: {
        kind: "split",
        id: "S1",
        direction: "row",
        sizes: [0.5, 0.5],
        children: [
          { kind: "leaf", id: "L1", tabs: [tab("t1")], activeTabId: "t1", state: "open" },
          { kind: "leaf", id: "L2", tabs: [], activeTabId: null, state: "open" },
        ],
      },
      floating: [],
    });

    const restored = parseLayout(raw);
    expect(restored?.root?.kind).toBe("leaf");
    expect(restored?.root?.id).toBe("L1");
  });

  it("falls back to the last tab when activeTabId is stale", () => {
    const raw = JSON.stringify({
      version: 1,
      root: {
        kind: "leaf",
        id: "L1",
        tabs: [tab("t1"), tab("t2")],
        activeTabId: "GONE",
        state: "open",
      },
      floating: [],
    });

    expect((parseLayout(raw)?.root as LeafGroup).activeTabId).toBe("t2");
  });

  it("rejects floating windows with malformed rects", () => {
    const raw = JSON.stringify({
      version: 1,
      root: { kind: "leaf", id: "L1", tabs: [tab("t1")], activeTabId: "t1", state: "open" },
      floating: [{ id: "F1", rect: { x: "a", y: 0, width: 10, height: 10 }, tabs: [tab("t2")], activeTabId: "t2", state: "open" }],
    });

    expect(parseLayout(raw)?.floating).toHaveLength(0);
  });

  it("normalises split sizes back to a sum of 1", () => {
    const raw = JSON.stringify({
      version: 1,
      root: {
        kind: "split",
        id: "S1",
        direction: "row",
        sizes: [3, 1],
        children: [
          { kind: "leaf", id: "L1", tabs: [tab("t1")], activeTabId: "t1", state: "open" },
          { kind: "leaf", id: "L2", tabs: [tab("t2")], activeTabId: "t2", state: "open" },
        ],
      },
      floating: [],
    });

    const split = parseLayout(raw)?.root as SplitGroup;
    expect(split.sizes[0]).toBeCloseTo(0.75);
    expect(split.sizes[1]).toBeCloseTo(0.25);
  });

  it("replaces an unknown window state with open", () => {
    const raw = JSON.stringify({
      version: 1,
      root: { kind: "leaf", id: "L1", tabs: [tab("t1")], activeTabId: "t1", state: "flying" },
      floating: [],
    });

    expect((parseLayout(raw)?.root as LeafGroup).state).toBe("open");
  });
});
