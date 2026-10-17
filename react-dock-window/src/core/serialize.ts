import { normalizeSizes } from "./tree";
import type { DockLayout, DockNode, DockTab, FloatingWindow, WindowState } from "../types";

interface StoredTab {
  id?: unknown;
  title?: unknown;
  closable?: unknown;
  data?: unknown;
}

interface StoredNode {
  kind?: unknown;
  id?: unknown;
  tabs?: unknown;
  activeTabId?: unknown;
  state?: unknown;
  direction?: unknown;
  sizes?: unknown;
  children?: unknown;
}

interface StoredLayout {
  version?: unknown;
  root?: unknown;
  floating?: unknown;
}

const STATES: WindowState[] = ["open", "minimized", "maximized"];

const isFiniteRect = (value: unknown): value is { x: number; y: number; width: number; height: number } =>
  Boolean(value) &&
  typeof value === "object" &&
  ["x", "y", "width", "height"].every(
    (key) => typeof (value as Record<string, unknown>)[key] === "number" &&
      Number.isFinite((value as Record<string, unknown>)[key]),
  );

const readTab = (raw: unknown, seen: Set<string>): DockTab | null => {
  const stored = raw as StoredTab;
  if (!stored || typeof stored.id !== "string" || seen.has(stored.id)) return null;
  seen.add(stored.id);
  return {
    id: stored.id,
    title: typeof stored.title === "string" ? stored.title : stored.id,
    closable: typeof stored.closable === "boolean" ? stored.closable : undefined,
    data: "data" in stored ? stored.data : undefined,
  };
};

const readState = (raw: unknown): WindowState =>
  STATES.includes(raw as WindowState) ? (raw as WindowState) : "open";

const readNode = (raw: unknown, ids: Set<string>, tabs: Set<string>): DockNode | null => {
  const stored = raw as StoredNode;
  if (!stored || typeof stored.id !== "string" || ids.has(stored.id)) return null;

  if (stored.kind === "leaf") {
    const rawTabs = Array.isArray(stored.tabs) ? stored.tabs : [];
    const parsed = rawTabs
      .map((entry) => readTab(entry, tabs))
      .filter((entry): entry is DockTab => entry !== null);
    if (parsed.length === 0) return null;
    ids.add(stored.id);
    const active =
      typeof stored.activeTabId === "string" &&
      parsed.some((tab) => tab.id === stored.activeTabId)
        ? stored.activeTabId
        : parsed[parsed.length - 1].id;
    return {
      kind: "leaf",
      id: stored.id,
      tabs: parsed,
      activeTabId: active,
      state: readState(stored.state),
    };
  }

  if (stored.kind === "split") {
    const rawChildren = Array.isArray(stored.children) ? stored.children : [];
    const rawSizes = Array.isArray(stored.sizes) ? (stored.sizes as unknown[]) : [];
    const parsed = rawChildren.map((child, index) => ({
      node: readNode(child, ids, tabs),
      size: typeof rawSizes[index] === "number" && Number.isFinite(rawSizes[index])
        ? (rawSizes[index] as number)
        : null,
    }));
    const kept = parsed.filter(
      (entry): entry is { node: DockNode; size: number | null } => entry.node !== null,
    );
    if (kept.length === 0) return null;
    if (kept.length === 1) return kept[0].node;
    ids.add(stored.id);
    const sizes = kept.every((entry) => entry.size !== null)
      ? normalizeSizes(kept.map((entry) => entry.size as number))
      : kept.map(() => 1 / kept.length);
    return {
      kind: "split",
      id: stored.id,
      direction: stored.direction === "column" ? "column" : "row",
      children: kept.map((entry) => entry.node),
      sizes,
    };
  }

  return null;
};

const readFloating = (raw: unknown, ids: Set<string>, tabs: Set<string>): FloatingWindow | null => {
  const stored = raw as StoredNode & { rect?: unknown };
  if (!stored || typeof stored.id !== "string" || ids.has(stored.id)) return null;
  if (!isFiniteRect(stored.rect)) return null;
  const rawTabs = Array.isArray(stored.tabs) ? stored.tabs : [];
  const parsed = rawTabs
    .map((entry) => readTab(entry, tabs))
    .filter((entry): entry is DockTab => entry !== null);
  if (parsed.length === 0) return null;
  ids.add(stored.id);
  const active =
    typeof stored.activeTabId === "string" && parsed.some((tab) => tab.id === stored.activeTabId)
      ? stored.activeTabId
      : parsed[parsed.length - 1].id;
  return {
    id: stored.id,
    rect: {
      x: stored.rect.x,
      y: stored.rect.y,
      width: stored.rect.width,
      height: stored.rect.height,
    },
    tabs: parsed,
    activeTabId: active,
    state: readState(stored.state),
  };
};

/** Stable JSON snapshot of the layout, safe to persist. */
export const serializeLayout = (layout: DockLayout): string =>
  JSON.stringify({ version: 1, root: layout.root, floating: layout.floating });

/**
 * Rebuilds a layout from JSON. Anything invalid (unknown ids, duplicate ids,
 * empty groups, malformed rects) is dropped rather than thrown, so a stale or
 * hand-edited save can never break the app.
 */
export const parseLayout = (raw: string): DockLayout | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const stored = parsed as StoredLayout;
  if (!stored || typeof stored !== "object" || stored.version !== 1) return null;

  const ids = new Set<string>();
  const tabs = new Set<string>();
  const root = stored.root ? readNode(stored.root, ids, tabs) : null;
  const floating = (Array.isArray(stored.floating) ? stored.floating : [])
    .map((entry) => readFloating(entry, ids, tabs))
    .filter((entry): entry is FloatingWindow => entry !== null);

  return { root, floating };
};
