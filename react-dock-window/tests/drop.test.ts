import { describe, expect, it } from "vitest";

import { applyDrop, bandOf, previewFor, resolveDropTarget, type DropSnapshot } from "../src/core/drop";
import type {
  AreaMetrics,
  DockLayout,
  DockOptions,
  DockTab,
  FloatingWindow,
  LeafGroup,
  SplitGroup,
} from "../src/types";

const options: Pick<DockOptions, "edgeRatio" | "stackInset"> = {
  edgeRatio: 0.25,
  stackInset: 0.4,
};

const metrics: AreaMetrics = {
  width: 1000,
  height: 800,
  padding: 0,
  minWidth: 180,
  minHeight: 120,
};

const area = { x: 0, y: 0, width: 1000, height: 800 };

const tab = (id: string): DockTab => ({ id, title: id.toUpperCase() });

const leaf = (id: string, ...tabs: string[]): LeafGroup => ({
  kind: "leaf",
  id,
  tabs: tabs.map(tab),
  activeTabId: tabs[tabs.length - 1] ?? null,
  state: "open",
});

const floating = (id: string, rect: FloatingWindow["rect"], ...tabs: string[]): FloatingWindow => ({
  id,
  rect,
  tabs: tabs.map(tab),
  activeTabId: tabs[tabs.length - 1] ?? null,
  state: "open",
});

/* ------------------------------------------------------------------ bandOf */

describe("bandOf", () => {
  const rect = { x: 0, y: 0, width: 1000, height: 800 };

  it("picks the edge zone near any border, split by the nearer axis", () => {
    expect(bandOf(rect, { x: 50, y: 400 }, options)).toEqual({ type: "edge", zone: "left" });
    expect(bandOf(rect, { x: 950, y: 400 }, options)).toEqual({ type: "edge", zone: "right" });
    expect(bandOf(rect, { x: 500, y: 20 }, options)).toEqual({ type: "edge", zone: "top" });
    expect(bandOf(rect, { x: 500, y: 780 }, options)).toEqual({ type: "edge", zone: "bottom" });
  });

  it("picks the core when the pointer is far enough from every edge", () => {
    expect(bandOf(rect, { x: 500, y: 400 }, options)).toEqual({ type: "core" });
    expect(bandOf(rect, { x: 400, y: 320 }, options)).toEqual({ type: "core" });
  });

  it("picks the ring between the edge band and the core", () => {
    // 30% from the left edge: past the 25% edge band, short of the 40% core.
    expect(bandOf(rect, { x: 300, y: 400 }, options)).toEqual({ type: "ring" });
    // 35% from the top edge.
    expect(bandOf(rect, { x: 500, y: 280 }, options)).toEqual({ type: "ring" });
  });

  it("treats a point outside the rect as a ring (free drop)", () => {
    expect(bandOf(rect, { x: -10, y: 400 }, options)).toEqual({ type: "ring" });
    expect(bandOf(rect, { x: 500, y: 900 }, options)).toEqual({ type: "ring" });
  });

  it("normalises distances so the bands work on non-square rects", () => {
    const tall = { x: 0, y: 0, width: 200, height: 2000 };
    // 50px from the left of a 200px-wide rect is 25% -> still an edge band.
    expect(bandOf(tall, { x: 50, y: 1000 }, options)).toEqual({ type: "edge", zone: "left" });
    // Same 50px on the 2000px axis is 2.5% -> the vertical edge wins instead.
    expect(bandOf(tall, { x: 100, y: 50 }, options)).toEqual({ type: "edge", zone: "top" });
  });

  it("clamps the edge band so it never swallows the core", () => {
    const wide: Pick<DockOptions, "edgeRatio" | "stackInset"> = { edgeRatio: 0.5, stackInset: 0.3 };
    // 32% from the left edge: the edge band is capped at 30%, so this is core.
    expect(bandOf(rect, { x: 320, y: 400 }, wide)).toEqual({ type: "core" });
  });
});

/* -------------------------------------------------------- resolveDropTarget */

const twoGroups: DropSnapshot = {
  area,
  leaves: [
    { leafId: "L1", rect: { x: 0, y: 0, width: 500, height: 800 } },
    { leafId: "L2", rect: { x: 500, y: 0, width: 500, height: 800 } },
  ],
  floating: [],
};

describe("resolveDropTarget", () => {
  it("returns null outside the dock area", () => {
    expect(resolveDropTarget({ x: -10, y: 400 }, twoGroups, "F1", options)).toBeNull();
    expect(resolveDropTarget({ x: 1010, y: 400 }, twoGroups, "F1", options)).toBeNull();
    expect(resolveDropTarget({ x: 500, y: -1 }, twoGroups, "F1", options)).toBeNull();
  });

  it("resolves the edge band of a group to a split", () => {
    expect(resolveDropTarget({ x: 20, y: 400 }, twoGroups, "F1", options)).toEqual({
      kind: "leaf",
      leafId: "L1",
      zone: "left",
    });
    expect(resolveDropTarget({ x: 980, y: 400 }, twoGroups, "F1", options)).toEqual({
      kind: "leaf",
      leafId: "L2",
      zone: "right",
    });
  });

  it("resolves the core of a group to a stack (center)", () => {
    expect(resolveDropTarget({ x: 250, y: 400 }, twoGroups, "F1", options)).toEqual({
      kind: "leaf",
      leafId: "L1",
      zone: "center",
    });
  });

  it("resolves the ring to a free drop (window stays floating)", () => {
    // 160/500 = 32% from the left edge of L1: ring band.
    expect(resolveDropTarget({ x: 160, y: 400 }, twoGroups, "F1", options)).toBeNull();
  });

  it("prefers the topmost floating window over the group under it", () => {
    const snapshot: DropSnapshot = {
      ...twoGroups,
      floating: [{ id: "F1", rect: { x: 600, y: 100, width: 200, height: 200 } }],
    };

    expect(resolveDropTarget({ x: 700, y: 150 }, snapshot, "F2", options)).toEqual({
      kind: "floating",
      windowId: "F1",
    });
  });

  it("never resolves to the dragged window itself", () => {
    const snapshot: DropSnapshot = {
      ...twoGroups,
      floating: [{ id: "F1", rect: { x: 600, y: 100, width: 200, height: 200 } }],
    };

    // The same point falls through to the L2 edge band.
    expect(resolveDropTarget({ x: 700, y: 150 }, snapshot, "F1", options)).toEqual({
      kind: "leaf",
      leafId: "L2",
      zone: "top",
    });
  });

  it("resolves a drop back onto the source group to its center (no-op)", () => {
    const target = resolveDropTarget({ x: 250, y: 400 }, twoGroups, "L1", options);
    expect(target).toEqual({ kind: "leaf", leafId: "L1", zone: "center" });
  });

  it("resolves the core of an empty area to an empty-layout drop", () => {
    const empty: DropSnapshot = { area, leaves: [], floating: [] };
    expect(resolveDropTarget({ x: 500, y: 400 }, empty, "F1", options)).toEqual({ kind: "empty" });
  });

  it("resolves the edge band of an empty area to a free drop", () => {
    const empty: DropSnapshot = { area, leaves: [], floating: [] };
    expect(resolveDropTarget({ x: 50, y: 400 }, empty, "F1", options)).toBeNull();
  });

  it("still merges into a floating window when the layout is empty", () => {
    const empty: DropSnapshot = {
      area,
      leaves: [],
      floating: [{ id: "F1", rect: { x: 100, y: 100, width: 300, height: 300 } }],
    };
    expect(resolveDropTarget({ x: 200, y: 200 }, empty, "F2", options)).toEqual({
      kind: "floating",
      windowId: "F1",
    });
  });
});

/* -------------------------------------------------------------- previewFor */

describe("previewFor", () => {
  it("paints the whole group for a stack drop", () => {
    const preview = previewFor({ kind: "leaf", leafId: "L1", zone: "center" }, twoGroups);
    expect(preview).toEqual({ rect: twoGroups.leaves[0].rect, zone: "center" });
  });

  it("paints half the group for an edge drop", () => {
    const preview = previewFor({ kind: "leaf", leafId: "L1", zone: "left" }, twoGroups);
    expect(preview?.rect).toEqual({ x: 0, y: 0, width: 250, height: 800 });
    expect(preview?.zone).toBe("left");
  });

  it("paints an inset area for an empty-layout drop", () => {
    const preview = previewFor({ kind: "empty" }, { area, leaves: [], floating: [] });
    expect(preview?.rect.width).toBeLessThan(area.width);
    expect(preview?.zone).toBe("center");
  });

  it("paints the target window for a floating merge", () => {
    const snapshot: DropSnapshot = {
      ...twoGroups,
      floating: [{ id: "F1", rect: { x: 600, y: 100, width: 200, height: 200 } }],
    };
    expect(previewFor({ kind: "floating", windowId: "F1" }, snapshot)).toEqual({
      rect: { x: 600, y: 100, width: 200, height: 200 },
      zone: "floating",
    });
  });

  it("paints nothing for a free drop", () => {
    expect(previewFor(null, twoGroups)).toBeNull();
  });
});

/* --------------------------------------------------------------- applyDrop */

describe("applyDrop", () => {
  it("settles a floating window released with nowhere to dock", () => {
    const layout: DockLayout = {
      root: leaf("L1", "t1"),
      floating: [floating("F1", { x: 0, y: 0, width: 400, height: 300 }, "t2")],
    };

    const next = applyDrop(layout, {
      sourceId: "F1",
      rect: { x: -100, y: -100, width: 50, height: 50 },
      target: null,
      metrics,
    });

    expect(next.root).toBe(layout.root);
    expect(next.floating).toHaveLength(1);
    // Clamped into the area and up to the minimum size.
    expect(next.floating[0].rect).toEqual({ x: 0, y: 0, width: 180, height: 120 });
    expect(next.floating[0].state).toBe("open");
  });

  it("tears a docked group out into a floating window when released free", () => {
    const layout: DockLayout = { root: leaf("L1", "t1", "t2"), floating: [] };

    const next = applyDrop(layout, {
      sourceId: "L1",
      rect: { x: 100, y: 100, width: 400, height: 300 },
      target: null,
      metrics,
    });

    expect(next.root).toBeNull();
    expect(next.floating).toHaveLength(1);
    expect(next.floating[0].id).toBe("L1");
    expect(next.floating[0].tabs.map((entry) => entry.id)).toEqual(["t1", "t2"]);
    expect(next.floating[0].rect).toEqual({ x: 100, y: 100, width: 400, height: 300 });
  });

  it("merges the dragged tabs into the target floating window", () => {
    const layout: DockLayout = {
      root: leaf("L1", "t1"),
      floating: [
        floating("F1", { x: 0, y: 0, width: 400, height: 300 }, "t2"),
        floating("F2", { x: 50, y: 50, width: 400, height: 300 }, "t3"),
      ],
    };

    const next = applyDrop(layout, {
      sourceId: "F1",
      rect: { x: 50, y: 50, width: 400, height: 300 },
      target: { kind: "floating", windowId: "F2" },
      metrics,
    });

    expect(next.root).toBe(layout.root);
    expect(next.floating).toHaveLength(1);
    expect(next.floating[0].id).toBe("F2");
    expect(next.floating[0].tabs.map((entry) => entry.id)).toEqual(["t3", "t2"]);
    expect(next.floating[0].activeTabId).toBe("t2");
  });

  it("treats a floating window dropped onto itself as a no-op", () => {
    const layout: DockLayout = {
      root: leaf("L1", "t1"),
      floating: [floating("F1", { x: 0, y: 0, width: 400, height: 300 }, "t2")],
    };

    const next = applyDrop(layout, {
      sourceId: "F1",
      rect: { x: 0, y: 0, width: 400, height: 300 },
      target: { kind: "floating", windowId: "F1" },
      metrics,
    });

    expect(next).toBe(layout);
  });

  it("stacks a floating window's tabs into a docked group", () => {
    const layout: DockLayout = {
      root: leaf("L1", "t1"),
      floating: [floating("F1", { x: 0, y: 0, width: 400, height: 300 }, "t2")],
    };

    const next = applyDrop(layout, {
      sourceId: "F1",
      rect: { x: 0, y: 0, width: 400, height: 300 },
      target: { kind: "leaf", leafId: "L1", zone: "center" },
      metrics,
    });

    expect(next.floating).toHaveLength(0);
    expect(next.root?.kind).toBe("leaf");
    const group = next.root as LeafGroup;
    expect(group.tabs.map((entry) => entry.id)).toEqual(["t1", "t2"]);
    expect(group.activeTabId).toBe("t2");
  });

  it("moves a docked group into another group when stacked", () => {
    const layout: DockLayout = {
      root: {
        kind: "split",
        id: "S1",
        direction: "row",
        sizes: [0.5, 0.5],
        children: [leaf("L1", "t1"), leaf("L2", "t2")],
      },
      floating: [],
    };

    const next = applyDrop(layout, {
      sourceId: "L1",
      rect: { x: 0, y: 0, width: 500, height: 800 },
      target: { kind: "leaf", leafId: "L2", zone: "center" },
      metrics,
    });

    // The split collapses; L2 keeps its tab plus the moved ones.
    expect(next.root?.kind).toBe("leaf");
    const group = next.root as LeafGroup;
    expect(group.id).toBe("L2");
    expect(group.tabs.map((entry) => entry.id)).toEqual(["t2", "t1"]);
  });

  it("splits a group when dropped on its edge", () => {
    const layout: DockLayout = {
      root: leaf("L1", "t1"),
      floating: [floating("F1", { x: 0, y: 0, width: 400, height: 300 }, "t2")],
    };

    const next = applyDrop(layout, {
      sourceId: "F1",
      rect: { x: 0, y: 0, width: 400, height: 300 },
      target: { kind: "leaf", leafId: "L1", zone: "right" },
      metrics,
    });

    expect(next.floating).toHaveLength(0);
    const split = next.root as SplitGroup;
    expect(split.kind).toBe("split");
    expect(split.direction).toBe("row");
    expect(split.children.map((child) => child.id)).toEqual(["L1", expect.stringContaining("F1:split:")]);
    expect((split.children[1] as LeafGroup).tabs.map((entry) => entry.id)).toEqual(["t2"]);
  });

  it("returns the same layout for a drop back onto the source group", () => {
    const layout: DockLayout = { root: leaf("L1", "t1"), floating: [] };

    const next = applyDrop(layout, {
      sourceId: "L1",
      rect: { x: 0, y: 0, width: 500, height: 800 },
      target: { kind: "leaf", leafId: "L1", zone: "center" },
      metrics,
    });

    expect(next).toBe(layout);
  });

  it("creates the root group when dropping into an empty layout", () => {
    const layout: DockLayout = {
      root: null,
      floating: [floating("F1", { x: 0, y: 0, width: 400, height: 300 }, "t1")],
    };

    const next = applyDrop(layout, {
      sourceId: "F1",
      rect: { x: 0, y: 0, width: 400, height: 300 },
      target: { kind: "empty" },
      metrics,
    });

    expect(next.floating).toHaveLength(0);
    expect(next.root).toEqual(leaf("F1", "t1"));
  });

  it("ignores a drop whose source no longer exists", () => {
    const layout: DockLayout = { root: leaf("L1", "t1"), floating: [] };

    const next = applyDrop(layout, {
      sourceId: "GONE",
      rect: { x: 0, y: 0, width: 400, height: 300 },
      target: { kind: "leaf", leafId: "L1", zone: "center" },
      metrics,
    });

    expect(next).toBe(layout);
  });
});
