import { createId } from "./ids";
import { clamp } from "./rect";
import type {
  DockNode,
  DockTab,
  DockZone,
  FloatingWindow,
  LeafGroup,
  Rect,
  SplitDirection,
  SplitGroup,
  WindowState,
} from "../types";

/* --------------------------------------------------------------------------
 * Traversal
 * ----------------------------------------------------------------------- */

export const isSplit = (node: DockNode): node is SplitGroup =>
  node.kind === "split";

export const collectLeaves = (node: DockNode | null): LeafGroup[] => {
  if (!node) return [];
  if (node.kind === "leaf") return [node];
  return node.children.flatMap(collectLeaves);
};

export const findLeaf = (
  node: DockNode | null,
  leafId: string,
): LeafGroup | null => {
  if (!node) return null;
  if (node.kind === "leaf") return (node.id === leafId ? node : null);
  for (const child of node.children) {
    const hit = findLeaf(child, leafId);
    if (hit) return hit;
  }
  return null;
};

export const findLeafOfTab = (
  node: DockNode | null,
  tabId: string,
): LeafGroup | null =>
  collectLeaves(node).find((leaf) =>
    leaf.tabs.some((tab) => tab.id === tabId),
  ) ?? null;

export const findSplit = (
  node: DockNode | null,
  splitId: string,
): SplitGroup | null => {
  if (!node) return null;
  if (node.kind === "split") {
    if (node.id === splitId) return node;
    for (const child of node.children) {
      const hit = findSplit(child, splitId);
      if (hit) return hit;
    }
  }
  return null;
};

export const findParentSplit = (
  node: DockNode | null,
  childId: string,
): SplitGroup | null => {
  if (!node || node.kind === "leaf") return null;
  if (node.children.some((child) => child.id === childId)) return node;
  for (const child of node.children) {
    const hit = findParentSplit(child, childId);
    if (hit) return hit;
  }
  return null;
};

const containsLeaf = (node: DockNode, leafId: string): boolean =>
  node.kind === "leaf" ? node.id === leafId : node.children.some((child) => containsLeaf(child, leafId));

/* --------------------------------------------------------------------------
 * Structural edits — every function returns a new tree (or the same tree when
 * nothing has to change, so no-op interactions never cause a re-render).
 * ----------------------------------------------------------------------- */

/** Replaces a node; `replacement: null` removes it and collapses its parent. */
export const replaceNode = (
  node: DockNode,
  targetId: string,
  replacement: DockNode | null,
): DockNode | null => {
  if (node.id === targetId) return replacement;
  if (node.kind === "leaf") return node;

  const children: DockNode[] = [];
  let changed = false;

  for (const child of node.children) {
    const next = replaceNode(child, targetId, replacement);
    if (next !== child) changed = true;
    if (next) children.push(next);
  }

  if (!changed) return node;
  if (children.length === 0) return null;
  // Collapsing a split with a single survivor keeps the tree shallow.
  if (children.length === 1) return children[0];

  const removedSize = node.sizes.reduce(
    (total, size, index) =>
      children.some((child) => child.id === node.children[index].id)
        ? total
        : total + size,
    0,
  );
  const remaining = node.children
    .map((child, index) => ({ child, size: node.sizes[index] }))
    .filter(({ child }) => children.some((entry) => entry.id === child.id))
    .map(({ size }) => size);

  const rest = 1 - removedSize;
  const sizes =
    rest > 0
      ? remaining.map((size) => size / rest)
      : children.map(() => 1 / children.length);

  return { ...node, children, sizes };
};

/** Drops a leaf, redistributing the freed share to its siblings. */
export const removeLeaf = (
  root: DockNode | null,
  leafId: string,
): DockNode | null => {
  if (!root) return null;
  if (root.kind === "leaf") return root.id === leafId ? null : root;

  const index = root.children.findIndex(
    (child) => child.id === leafId || containsLeaf(child, leafId),
  );
  if (index === -1) return root;

  const child = root.children[index];
  const nextChild = child.kind === "leaf" ? null : removeLeaf(child, leafId);
  if (child.kind === "leaf") return replaceNode(root, leafId, null);
  if (nextChild === child) return root;
  if (!nextChild) return replaceNode(root, child.id, null);
  return {
    ...root,
    children: root.children.map((entry, i) => (i === index ? nextChild : entry)),
  };
};

const directionForZone = (zone: Exclude<DockZone, "center">): SplitDirection =>
  zone === "left" || zone === "right" ? "row" : "column";

const zoneIsBefore = (zone: Exclude<DockZone, "center">): boolean =>
  zone === "left" || zone === "top";

/**
 * Splits `leafId` and puts `next` on the `zone` side of it. When the parent
 * split already runs along the same axis the new group joins it (one divider
 * instead of a nested pair); otherwise a fresh nested split is created.
 */
export const splitLeaf = (
  root: DockNode,
  leafId: string,
  zone: Exclude<DockZone, "center">,
  next: LeafGroup,
): DockNode => {
  const target = findLeaf(root, leafId);
  if (!target || target.id === next.id) return root;

  const direction = directionForZone(zone);
  const before = zoneIsBefore(zone);
  const parent = findParentSplit(root, leafId);

  if (parent && parent.direction === direction) {
    const index = parent.children.findIndex((child) => child.id === leafId);
    const insertAt = before ? index : index + 1;
    const children = [...parent.children];
    children.splice(insertAt, 0, next);
    const sizes = [...parent.sizes];
    const half = sizes[index] / 2;
    sizes[index] = half;
    sizes.splice(insertAt, 0, half);
    const split: SplitGroup = { ...parent, children, sizes: normalizeSizes(sizes) };
    return replaceNode(root, parent.id, split) ?? root;
  }

  const split: SplitGroup = {
    kind: "split",
    id: createId("split"),
    direction,
    children: before ? [next, target] : [target, next],
    sizes: [0.5, 0.5],
  };
  return replaceNode(root, leafId, split) ?? root;
};

export const normalizeSizes = (sizes: number[]): number[] => {
  const safe = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
  const total = safe.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return sizes.map(() => 1 / sizes.length);
  return safe.map((size) => size / total);
};

/* --------------------------------------------------------------------------
 * Tab operations
 * ----------------------------------------------------------------------- */

export const activeTab = (
  container: { tabs: DockTab[]; activeTabId: string | null },
): DockTab | null =>
  container.tabs.find((tab) => tab.id === container.activeTabId) ??
  container.tabs[container.tabs.length - 1] ??
  null;

/** Appends a tab and makes it active. */
export const withAddedTab = (
  container: { tabs: DockTab[]; activeTabId: string | null },
  tab: DockTab,
  activate = true,
): { tabs: DockTab[]; activeTabId: string | null } => {
  if (container.tabs.some((entry) => entry.id === tab.id)) return container;
  const tabs = [...container.tabs, tab];
  return {
    tabs,
    activeTabId: activate ? tab.id : container.activeTabId ?? tab.id,
  };
};

/** Moves a tab to the back of the stack (the active position). */
export const withActivatedTab = (
  container: { tabs: DockTab[]; activeTabId: string | null },
  tabId: string,
): { tabs: DockTab[]; activeTabId: string | null } => {
  const index = container.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || index === container.tabs.length - 1) return container;
  const tabs = [...container.tabs];
  const [tab] = tabs.splice(index, 1);
  tabs.push(tab);
  return { tabs, activeTabId: tabId };
};

export const addTabToLeaf = (
  root: DockNode | null,
  leafId: string,
  tab: DockTab,
  activate = true,
): DockNode | null => {
  if (!root) return null;
  return replaceNodeById(root, (node) =>
    node.kind === "leaf" && node.id === leafId
      ? { ...node, ...withAddedTab(node, tab, activate) }
      : node,
  );
};

export const activateTabInLeaf = (
  root: DockNode | null,
  leafId: string,
  tabId: string,
): DockNode | null => {
  if (!root) return null;
  return replaceNodeById(root, (node) =>
    node.kind === "leaf" && node.id === leafId
      ? { ...node, ...withActivatedTab(node, tabId) }
      : node
  );
};

export const setLeafState = (
  root: DockNode | null,
  leafId: string,
  state: WindowState,
): DockNode | null => {
  if (!root) return null;
  if (findLeaf(root, leafId)?.state === state) return root;
  return replaceNodeById(root, (node) =>
    node.kind === "leaf" && node.id === leafId ? { ...node, state } : node
  );
};

/** Bottom-up map over every node; returns the same tree when nothing changed. */
export const replaceNodeById = (
  node: DockNode,
  update: (node: DockNode) => DockNode,
): DockNode => {
  const next =
    node.kind === "leaf"
      ? node
      : (() => {
          let changed = false;
          const children = node.children.map((child) => {
            const mapped = replaceNodeById(child, update);
            if (mapped !== child) changed = true;
            return mapped;
          });
          return changed ? { ...node, children } : node;
        })();

  return update(next);
};

/* --------------------------------------------------------------------------
 * Splits
 * ----------------------------------------------------------------------- */

/**
 * Sizes after dragging the divider between `index - 1` and `index` by
 * `delta` (fraction of the split's main axis). Pure: `sizesAtStart` is the
 * snapshot taken when the divider press began, so repeated calls during one
 * drag never accumulate error.
 */
export const dragSplitSizes = (
  sizesAtStart: number[],
  index: number,
  delta: number,
  minShare: number,
): number[] => {
  const previous = index - 1;
  if (index <= 0 || index >= sizesAtStart.length) return sizesAtStart;

  const sizes = [...sizesAtStart];
  const pair = sizes[previous] + sizes[index];
  const lower = Math.min(minShare, pair / 2);
  const upper = Math.max(lower, pair - lower);
  sizes[previous] = clamp(sizes[previous] + delta, lower, upper);
  sizes[index] = pair - sizes[previous];
  return normalizeSizes(sizes);
};

export const setSplitSizes = (
  root: DockNode | null,
  splitId: string,
  sizes: number[],
): DockNode | null => {
  if (!root) return null;
  const split = findSplit(root, splitId);
  if (!split || split.sizes.length !== sizes.length) return root;
  if (sizes.every((size, index) => Math.abs(size - split.sizes[index]) < 1e-6)) {
    return root;
  }
  return replaceNodeById(root, (node) =>
    node.kind === "split" && node.id === splitId
      ? { ...node, sizes: normalizeSizes(sizes) }
      : node
  );
};

/* --------------------------------------------------------------------------
 * Floating windows
 * ----------------------------------------------------------------------- */

export const findFloating = (
  layout: { floating: FloatingWindow[] },
  windowId: string,
): FloatingWindow | null =>
  layout.floating.find((window) => window.id === windowId) ?? null;

export const withFloatingRect = (
  layout: { floating: FloatingWindow[]; root: DockNode | null },
  windowId: string,
  update: (window: FloatingWindow) => FloatingWindow,
): { floating: FloatingWindow[]; root: DockNode | null } => {
  let changed = false;
  const floating = layout.floating.map((window) => {
    if (window.id !== windowId) return window;
    const next = update(window);
    if (next !== window) changed = true;
    return next;
  });
  return changed ? { ...layout, floating } : layout;
};

export const raiseFloating = (
  floating: FloatingWindow[],
  windowId: string,
): FloatingWindow[] => {
  const index = floating.findIndex((window) => window.id === windowId);
  if (index === -1 || index === floating.length - 1) return floating;
  const next = [...floating];
  const [window] = next.splice(index, 1);
  next.push(window);
  return next;
};

export const createFloatingWindow = (
  id: string,
  rect: Rect,
  tabs: DockTab[],
  activeTabId: string | null,
): FloatingWindow => ({
  id,
  rect,
  tabs,
  activeTabId,
  state: "open",
});
