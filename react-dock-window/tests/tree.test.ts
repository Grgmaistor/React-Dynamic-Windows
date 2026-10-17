import { describe, expect, it } from "vitest";

import {
  activateTabInLeaf,
  addTabToLeaf,
  activeTab,
  collectLeaves,
  dragSplitSizes,
  findLeaf,
  findLeafOfTab,
  findParentSplit,
  normalizeSizes,
  removeLeaf,
  setSplitSizes,
  splitLeaf,
  withActivatedTab,
} from "../src/core/tree";
import type { DockNode, DockTab, LeafGroup, SplitGroup } from "../src/types";

const tab = (id: string): DockTab => ({ id, title: id.toUpperCase() });

const leaf = (id: string, ...tabs: string[]): LeafGroup => ({
  kind: "leaf",
  id,
  tabs: tabs.map(tab),
  activeTabId: tabs[tabs.length - 1] ?? null,
  state: "open",
});

const split = (
  direction: "row" | "column",
  children: DockNode[],
  sizes: number[],
): SplitGroup => ({ kind: "split", id: `split-${direction}`, direction, children, sizes });

const leafIds = (root: DockNode | null) => collectLeaves(root).map((entry) => entry.id);

describe("collectLeaves / findLeaf", () => {
  const tree = split("row", [leaf("a", "t1"), split("column", [leaf("b"), leaf("c")], [0.4, 0.6])], [0.5, 0.5]);

  it("flattens the tree in reading order", () => {
    expect(leafIds(tree)).toEqual(["a", "b", "c"]);
  });

  it("finds a leaf by id and returns null otherwise", () => {
    expect(findLeaf(tree, "b")?.id).toBe("b");
    expect(findLeaf(tree, "missing")).toBeNull();
    expect(findLeaf(null, "a")).toBeNull();
  });

  it("locates the group holding a tab", () => {
    const withTab = addTabToLeaf(tree, "c", tab("inside"));
    expect(findLeafOfTab(withTab, "inside")?.id).toBe("c");
    expect(findLeafOfTab(withTab, "nope")).toBeNull();
  });
});

describe("splitLeaf", () => {
  it("creates a nested split when the axis differs", () => {
    const tree = split("row", [leaf("a"), leaf("b")], [0.5, 0.5]);
    const next = splitLeaf(tree, "a", "bottom", leaf("c"));

    expect(next.kind).toBe("split");
    const root = next as SplitGroup;
    expect(root.direction).toBe("row");
    const inner = root.children[0] as SplitGroup;
    expect(inner.direction).toBe("column");
    // Dropping at the bottom stacks the new group *under* the target.
    expect(leafIds(next)).toEqual(["a", "c", "b"]);
    expect(inner.sizes).toEqual([0.5, 0.5]);
  });

  it("joins the parent split when the axis already matches", () => {
    const tree = split("row", [leaf("a"), leaf("b")], [0.6, 0.4]);
    const next = splitLeaf(tree, "a", "right", leaf("c"));

    const root = next as SplitGroup;
    expect(root.children.map((child) => child.id)).toEqual(["a", "c", "b"]);
    // The target's share is halved; the rest of the row is untouched.
    expect(root.sizes[0]).toBeCloseTo(0.3);
    expect(root.sizes[1]).toBeCloseTo(0.3);
    expect(root.sizes[2]).toBeCloseTo(0.4);
    expect(root.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
  });

  it("inserts before the target for left/top drops", () => {
    const tree = split("column", [leaf("a"), leaf("b")], [0.5, 0.5]);
    const next = splitLeaf(tree, "b", "top", leaf("c"));

    expect(leafIds(next)).toEqual(["a", "c", "b"]);
  });

  it("returns the same tree when the target does not exist", () => {
    const tree = leaf("a");
    expect(splitLeaf(tree, "missing", "left", leaf("b"))).toBe(tree);
  });
});

describe("removeLeaf", () => {
  it("collapses a split with a single remaining child", () => {
    const tree = split("row", [leaf("a"), leaf("b")], [0.5, 0.5]);
    const next = removeLeaf(tree, "b");

    expect(next?.kind).toBe("leaf");
    expect(next?.id).toBe("a");
  });

  it("keeps siblings and redistributes the freed share", () => {
    const tree = split("row", [leaf("a"), split("column", [leaf("b"), leaf("c")], [0.5, 0.5]), leaf("d")], [0.2, 0.5, 0.3]);
    const next = removeLeaf(tree, "b") as SplitGroup;

    expect(leafIds(next)).toEqual(["a", "c", "d"]);
    // The survivor inherits its collapsed parent's whole share.
    expect(next.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
    expect(next.sizes[0]).toBeCloseTo(0.2);
  });

  it("removes the whole tree when the last leaf goes", () => {
    expect(removeLeaf(leaf("a"), "a")).toBeNull();
  });
});

describe("tab operations", () => {
  it("activates by moving the tab to the back of the stack", () => {
    const grouped = leaf("g", "a", "b", "c");
    const next = withActivatedTab(grouped, "a");

    expect(next.tabs.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
    expect(activeTab(next)?.id).toBe("a");
  });

  it("returns the same container when the tab is already active", () => {
    const grouped = leaf("g", "a", "b");
    expect(withActivatedTab(grouped, "b")).toBe(grouped);
  });

  it("appends new tabs and activates them", () => {
    const tree = addTabToLeaf(leaf("g", "a"), "g", tab("b"));
    expect(activeTab(tree as LeafGroup)?.id).toBe("b");
  });

  it("activates a tab inside the tree without touching siblings", () => {
    const tree = split("row", [leaf("a", "t1", "t2"), leaf("b")], [0.5, 0.5]);
    const next = activateTabInLeaf(tree, "a", "t1") as SplitGroup;

    expect((next.children[0] as LeafGroup).activeTabId).toBe("t1");
    expect((next.children[1] as LeafGroup).activeTabId).toBeNull();
    expect(activateTabInLeaf(tree, "a", "t1")).not.toBe(tree);
  });
});

describe("split sizing", () => {
  const sizes = [0.5, 0.3, 0.2];

  it("moves a divider without touching distant children", () => {
    const next = dragSplitSizes(sizes, 1, 0.1, 0.1);

    expect(next[0]).toBeCloseTo(0.6);
    expect(next[1]).toBeCloseTo(0.2);
    expect(next[2]).toBe(0.2);
  });

  it("never lets a divider push a child below the minimum share", () => {
    const next = dragSplitSizes(sizes, 1, 5, 0.1);

    // The dragged pair keeps its total; only the split inside it moves.
    expect(next[0]).toBeCloseTo(0.7);
    expect(next[1]).toBeCloseTo(0.1);
    expect(next[2]).toBe(0.2);
    expect(Math.min(...next)).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });

  it("ignores invalid divider indexes", () => {
    expect(dragSplitSizes(sizes, 0, 0.2, 0.1)).toBe(sizes);
    expect(dragSplitSizes(sizes, 3, 0.2, 0.1)).toBe(sizes);
  });

  it("normalises sizes back to a sum of 1", () => {
    expect(normalizeSizes([2, 2, 4])).toEqual([0.25, 0.25, 0.5]);
    expect(normalizeSizes([0, 0])).toEqual([0.5, 0.5]);
  });

  it("updates a split in the tree and bails out when nothing changes", () => {
    const tree = split("row", [leaf("a"), leaf("b")], [0.5, 0.5]);
    const id = (tree as SplitGroup).id;

    const next = setSplitSizes(tree, id, [0.7, 0.3]) as SplitGroup;
    expect(next.sizes).toEqual([0.7, 0.3]);
    expect(setSplitSizes(tree, id, [0.5, 0.5])).toBe(tree);
    expect(setSplitSizes(tree, "missing", [1])).toBe(tree);
  });
});

describe("parent lookup", () => {
  it("finds the split that owns a child", () => {
    const tree = split("row", [leaf("a"), split("column", [leaf("b"), leaf("c")], [0.5, 0.5])], [0.5, 0.5]);
    const inner = (tree as SplitGroup).children[1] as SplitGroup;

    expect(findParentSplit(tree, inner.id)?.id).toBe((tree as SplitGroup).id);
    expect(findParentSplit(tree, "a")?.id).toBe((tree as SplitGroup).id);
    expect(findParentSplit(tree, "root")).toBeNull();
  });
});
