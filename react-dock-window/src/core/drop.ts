import { clamp, pointInRect } from "./rect";
import {
  activateTabInLeaf,
  addTabToLeaf,
  collectLeaves,
  createFloatingWindow,
  findFloating,
  findLeaf,
  removeLeaf,
  splitLeaf,
  withAddedTab,
} from "./tree";
import type {
  AreaMetrics,
  DockLayout,
  DockOptions,
  DockTab,
  DockZone,
  DropPreview,
  DropTarget,
  LeafGroup,
  Point,
  Rect,
} from "../types";

export interface LeafBox {
  leafId: string;
  rect: Rect;
}

export interface DropSnapshot {
  /** Docked group rects in area coordinates (measured when the drag began). */
  leaves: LeafBox[];
  /** Floating windows at their *display* rects (maximize/minimize applied). */
  floating: Array<{ id: string; rect: Rect }>;
  area: Rect;
}

type Band =
  | { type: "edge"; zone: Exclude<DockZone, "center"> }
  | { type: "core" }
  | { type: "ring" };

/**
 * Three concentric bands inside a target rect, mirroring Visual Studio Code:
 *
 *   outer band (edgeRatio)  -> split the group on that edge
 *   inner core (stackInset) -> stack the dragged tabs into the group
 *   ring between them       -> release keeps the window floating
 */
export const bandOf = (
  rect: Rect,
  point: Point,
  options: Pick<DockOptions, "edgeRatio" | "stackInset">,
): Band => {
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  const distanceX = Math.min(point.x - rect.x, rect.x + width - point.x) / width;
  const distanceY =
    Math.min(point.y - rect.y, rect.y + height - point.y) / height;

  if (distanceX < 0 || distanceY < 0) return { type: "ring" };

  const edge = Math.min(options.edgeRatio, options.stackInset - 1e-3);

  if (distanceX <= edge || distanceY <= edge) {
    const horizontal = distanceX <= distanceY;
    const zone = horizontal
      ? point.x < rect.x + width / 2
        ? "left"
        : "right"
      : point.y < rect.y + height / 2
        ? "top"
        : "bottom";
    return { type: "edge", zone };
  }

  if (distanceX >= options.stackInset && distanceY >= options.stackInset) {
    return { type: "core" };
  }

  return { type: "ring" };
};

/**
 * Resolves where a released drag lands.
 *
 * - topmost floating window under the point (never the dragged one) -> merge
 * - docked group under the point -> band rules (split / stack / free)
 * - empty layout -> the area itself behaves like one big group
 * - outside the area or in a ring -> `null`, the window stays floating
 *
 * A dragged group dropped back onto itself always resolves to its own
 * center: the drop is a no-op and the window returns to its dock slot.
 */
export const resolveDropTarget = (
  point: Point,
  snapshot: DropSnapshot,
  sourceId: string | null,
  options: Pick<DockOptions, "edgeRatio" | "stackInset">,
): DropTarget | null => {
  if (
    point.x < snapshot.area.x ||
    point.y < snapshot.area.y ||
    point.x > snapshot.area.x + snapshot.area.width ||
    point.y > snapshot.area.y + snapshot.area.height
  ) {
    return null;
  }

  for (let index = snapshot.floating.length - 1; index >= 0; index -= 1) {
    const entry = snapshot.floating[index];
    if (entry.id === sourceId) continue;
    if (pointInRect(point, entry.rect)) {
      return { kind: "floating", windowId: entry.id };
    }
  }

  const leaf = snapshot.leaves.find((box) => pointInRect(point, box.rect));

  if (!leaf) {
    const band = bandOf(snapshot.area, point, options);
    return band.type === "core" ? { kind: "empty" } : null;
  }

  if (sourceId && leaf.leafId === sourceId) {
    return { kind: "leaf", leafId: leaf.leafId, zone: "center" };
  }

  const band = bandOf(leaf.rect, point, options);
  if (band.type === "edge") return { kind: "leaf", leafId: leaf.leafId, zone: band.zone };
  if (band.type === "core") return { kind: "leaf", leafId: leaf.leafId, zone: "center" };
  return null;
};

/** Preview geometry for a resolved target; `null` means "free" (no paint). */
export const previewFor = (
  target: DropTarget | null,
  snapshot: DropSnapshot,
): DropPreview | null => {
  if (!target) return null;

  if (target.kind === "empty") {
    return { rect: inset(snapshot.area, 0.12), zone: "center" };
  }

  if (target.kind === "floating") {
    const window = snapshot.floating.find((entry) => entry.id === target.windowId);
    return window ? { rect: window.rect, zone: "floating" } : null;
  }

  const box = snapshot.leaves.find((entry) => entry.leafId === target.leafId);
  if (!box) return null;

  if (target.zone === "center") {
    return { rect: box.rect, zone: "center" };
  }

  const half = {
    left: { ...box.rect, width: box.rect.width / 2 },
    right: {
      ...box.rect,
      x: box.rect.x + box.rect.width / 2,
      width: box.rect.width / 2,
    },
    top: { ...box.rect, height: box.rect.height / 2 },
    bottom: {
      ...box.rect,
      y: box.rect.y + box.rect.height / 2,
      height: box.rect.height / 2,
    },
  } as const;

  return { rect: half[target.zone], zone: target.zone };
};

const inset = (rect: Rect, ratio: number): Rect => ({
  x: rect.x + rect.width * ratio,
  y: rect.y + rect.height * ratio,
  width: rect.width * (1 - ratio * 2),
  height: rect.height * (1 - ratio * 2),
});

/* --------------------------------------------------------------------------
 * Applying a settled drag
 * ----------------------------------------------------------------------- */

export interface DropInput {
  sourceId: string;
  rect: Rect;
  target: DropTarget | null;
  metrics: AreaMetrics;
}

const newLeafFrom = (id: string, source: { tabs: DockTab[]; activeTabId: string | null }): LeafGroup => ({
  kind: "leaf",
  id,
  tabs: source.tabs,
  activeTabId: source.activeTabId,
  state: "open",
});

/**
 * Applies a released drag.
 *
 * `sourceId` may be a floating window or a docked group:
 *  - floating + no target     -> stays floating at the released rect
 *  - docked   + no target     -> tears out into a floating window
 *  - floating + group target  -> its tabs join that group, window disappears
 *  - docked   + group target  -> the group moves (center = merge, edge = split)
 *  - any       + self target  -> no-op, the window returns to its slot
 */
export const applyDrop = (layout: DockLayout, input: DropInput): DockLayout => {
  const { sourceId, rect, target, metrics } = input;
  const floatingSource = findFloating(layout, sourceId);
  const leafSource = findLeaf(layout.root, sourceId);

  if (!floatingSource && !leafSource) return layout;

  const source: { tabs: DockTab[]; activeTabId: string | null } = floatingSource
    ? { tabs: floatingSource.tabs, activeTabId: floatingSource.activeTabId }
    : { tabs: leafSource!.tabs, activeTabId: leafSource!.activeTabId };

  const normalize = (next: Rect): Rect => ({
    x: clamp(next.x, metrics.padding, Math.max(metrics.padding, metrics.width - metrics.padding - next.width)),
    y: clamp(next.y, metrics.padding, Math.max(metrics.padding, metrics.height - metrics.padding - next.height)),
    width: Math.max(metrics.minWidth, next.width),
    height: Math.max(metrics.minHeight, next.height),
  });

  const detachSource = (current: DockLayout): DockLayout => ({
    root: floatingSource ? current.root : removeLeaf(current.root, sourceId),
    floating: floatingSource
      ? current.floating.filter((window) => window.id !== sourceId)
      : current.floating,
  });

  // Release with nowhere to dock: docked groups tear out, floating ones settle.
  if (!target) {
    if (floatingSource) {
      const rect2 = normalize(rect);
      return {
        root: layout.root,
        floating: layout.floating.map((window) =>
          window.id === sourceId
            ? { ...window, rect: rect2, state: "open" }
            : window,
        ),
      };
    }

    const window = createFloatingWindow(
      sourceId,
      normalize(rect),
      source.tabs,
      source.activeTabId,
    );
    return { root: removeLeaf(layout.root, sourceId), floating: [...layout.floating, window] };
  }

  // Dropping onto another floating window merges both tab stacks.
  if (target.kind === "floating") {
    const withoutSource = detachSource(layout);
    const merged = findFloating(withoutSource, target.windowId);
    if (!merged) return layout;
    const tabs = [...merged.tabs, ...source.tabs];
    return {
      root: withoutSource.root,
      floating: withoutSource.floating.map((window) =>
        window.id === target.windowId
          ? {
              ...window,
              tabs,
              activeTabId: source.activeTabId ?? window.activeTabId,
              rect: normalize(window.rect),
              state: "open",
            }
          : window,
      ),
    };
  }

  // Empty layout: the drop creates the root group.
  if (target.kind === "empty") {
    const withoutSource = detachSource(layout);
    if (withoutSource.root) return withoutSource;
    return { ...withoutSource, root: newLeafFrom(sourceId, source) };
  }

  const targetLeaf = findLeaf(layout.root, target.leafId);
  if (!targetLeaf) return layout;

  // Self target: the window came back to where it started.
  if (leafSource && target.leafId === sourceId) {
    return layout;
  }

  const zone = target.zone;
  if (zone === "center") {
    return stackIntoLeaf(target.leafId, source, () => detachSource(layout));
  }

  return splitWithSource(layout, source, { leafId: target.leafId, zone }, sourceId);
};

/** Stacking helper — moves every source tab into the target group. */
export const stackIntoLeaf = (
  targetLeafId: string,
  source: { tabs: DockTab[]; activeTabId: string | null },
  detach: () => DockLayout,
): DockLayout => {
  const withoutSource = detach();
  const leaf = findLeaf(withoutSource.root, targetLeafId);
  if (!leaf) return withoutSource;

  let root = withoutSource.root;
  for (const tab of source.tabs) {
    root = addTabToLeaf(root, targetLeafId, tab, tab.id === source.activeTabId);
  }
  root = source.activeTabId
    ? activateTabInLeaf(root, targetLeafId, source.activeTabId)
    : root;

  return { root, floating: withoutSource.floating };
};

const splitWithSource = (
  layout: DockLayout,
  source: { tabs: DockTab[]; activeTabId: string | null },
  target: { leafId: string; zone: Exclude<DockZone, "center"> },
  sourceId: string,
): DockLayout => {
  const withoutSource = detachSourceBoth(layout, sourceId);
  const leaf = findLeaf(withoutSource.root, target.leafId);
  if (!leaf) return layout;

  const next: LeafGroup = {
    kind: "leaf",
    id: `${sourceId}:split:${Date.now().toString(36)}`,
    tabs: source.tabs,
    activeTabId: source.activeTabId,
    state: "open",
  };

  return {
    root: splitLeaf(withoutSource.root!, target.leafId, target.zone, next),
    floating: withoutSource.floating,
  };
};

const detachSourceBoth = (layout: DockLayout, sourceId: string): DockLayout => ({
  root: findLeaf(layout.root, sourceId) ? removeLeaf(layout.root, sourceId) : layout.root,
  floating: findFloating(layout, sourceId)
    ? layout.floating.filter((window) => window.id !== sourceId)
    : layout.floating,
});

/* --------------------------------------------------------------------------
 * Open / close helpers
 * ----------------------------------------------------------------------- */

/** Default target for `open()`: focused group, first group, or the empty area. */
export const defaultTarget = (
  layout: DockLayout,
  focusId: string | null,
): DropTarget | null => {
  if (layout.root) {
    if (focusId) {
      const focus = findLeaf(layout.root, focusId);
      if (focus) return { kind: "leaf", leafId: focus.id, zone: "center" };
      const floating = findFloating(layout, focusId);
      if (floating) return { kind: "floating", windowId: floating.id };
    }
    const [first] = collectLeaves(layout.root);
    if (first) return { kind: "leaf", leafId: first.id, zone: "center" };
  }
  return { kind: "empty" };
};

/** Preview used by `open()` when no explicit target is given. */
export const openTabInto = (
  layout: DockLayout,
  tab: DockTab,
  target: DropTarget | null,
  createLeafId: () => string,
): DockLayout => {
  if (!target || target.kind === "empty" || !layout.root) {
    const leaf: LeafGroup = {
      kind: "leaf",
      id: createLeafId(),
      tabs: [tab],
      activeTabId: tab.id,
      state: "open",
    };
    return { root: leaf, floating: [] };
  }

  if (target.kind === "floating") {
    const window = findFloating(layout, target.windowId);
    if (!window) return layout;
    return {
      root: layout.root,
      floating: layout.floating.map((entry) =>
        entry.id === target.windowId
          ? { ...entry, ...withAddedTab(entry, tab) }
          : entry,
      ),
    };
  }

  const leaf = findLeaf(layout.root, target.leafId);
  if (!leaf) return layout;

  if (target.zone === "center") {
    return { root: addTabToLeaf(layout.root, target.leafId, tab), floating: layout.floating };
  }

  const next: LeafGroup = {
    kind: "leaf",
    id: createLeafId(),
    tabs: [tab],
    activeTabId: tab.id,
    state: "open",
  };
  return {
    root: splitLeaf(layout.root, target.leafId, target.zone, next),
    floating: layout.floating,
  };
};

/** Clamps every floating window back into the area after a resize. */
export const reflowFloating = (
  layout: DockLayout,
  metrics: AreaMetrics,
): DockLayout => {
  let changed = false;
  const floating = layout.floating.map((window) => {
    const rect = normalizeInside(window.rect, metrics);
    if (
      rect.x === window.rect.x &&
      rect.y === window.rect.y &&
      rect.width === window.rect.width &&
      rect.height === window.rect.height
    ) {
      return window;
    }
    changed = true;
    return { ...window, rect };
  });
  return changed ? { ...layout, floating } : layout;
};

const normalizeInside = (rect: Rect, metrics: AreaMetrics): Rect => {
  const width = Math.min(Math.max(rect.width, metrics.minWidth), Math.max(metrics.minWidth, metrics.width - metrics.padding * 2));
  const height = Math.min(Math.max(rect.height, metrics.minHeight), Math.max(metrics.minHeight, metrics.height - metrics.padding * 2));
  return {
    x: clamp(rect.x, metrics.padding, Math.max(metrics.padding, metrics.width - metrics.padding - width)),
    y: clamp(rect.y, metrics.padding, Math.max(metrics.padding, metrics.height - metrics.padding - height)),
    width,
    height,
  };
};
