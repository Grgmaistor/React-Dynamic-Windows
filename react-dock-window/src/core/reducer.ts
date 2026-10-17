import { defaultTarget, applyDrop, openTabInto, reflowFloating } from "./drop";
import { createId } from "./ids";
import { normalizeRect } from "./rect";
import {
  activateTabInLeaf,
  collectLeaves,
  createFloatingWindow,
  findFloating,
  findLeaf,
  findLeafOfTab,
  raiseFloating,
  removeLeaf,
  setLeafState,
  setSplitSizes,
  withActivatedTab,
  withFloatingRect,
} from "./tree";
import type {
  AreaMetrics,
  DockLayout,
  DockNode,
  DockState,
  DockTab,
  DropTarget,
  Rect,
  WindowState,
} from "../types";

export type DockAction =
  | {
      type: "open-tab";
      tab: DockTab;
      /** Omitted -> focused group, first group, or the empty area. */
      target?: DropTarget;
      /** With `metrics` and no target: open as a floating window at `rect`. */
      rect?: Rect;
      metrics?: AreaMetrics;
    }
  | { type: "close-tab"; tabId: string }
  | { type: "activate-tab"; tabId: string; containerId?: string }
  | { type: "set-window-state"; windowId: string; state: WindowState }
  | { type: "raise"; windowId: string }
  | { type: "float-tab"; tabId: string; windowId: string; rect: Rect }
  | { type: "drop"; sourceId: string; rect: Rect; target: DropTarget | null; metrics: AreaMetrics }
  | { type: "set-rect"; windowId: string; rect: Rect; metrics: AreaMetrics }
  | { type: "set-split-sizes"; splitId: string; sizes: number[] }
  | { type: "set-layout"; layout: DockLayout }
  | { type: "reflow"; metrics: AreaMetrics };

const containerOf = (layout: DockLayout, tabId: string): string | null => {
  const leaf = findLeafOfTab(layout.root, tabId);
  if (leaf) return leaf.id;
  const window = layout.floating.find((entry) =>
    entry.tabs.some((tab) => tab.id === tabId),
  );
  return window?.id ?? null;
};

/** Drops a tab from whichever container holds it; empties disappear. */
const detachTab = (layout: DockLayout, tabId: string): DockLayout => {
  const leaf = findLeafOfTab(layout.root, tabId);
  if (leaf) {
    const tabs = leaf.tabs.filter((tab) => tab.id !== tabId);
    if (tabs.length === 0) {
      return { root: removeLeaf(layout.root, leaf.id), floating: layout.floating };
    }
    return {
      root: withLeafTabs(layout, leaf.id, tabs),
      floating: layout.floating,
    };
  }

  const window = layout.floating.find((entry) =>
    entry.tabs.some((tab) => tab.id === tabId),
  );
  if (!window) return layout;
  const tabs = window.tabs.filter((tab) => tab.id !== tabId);
  if (tabs.length === 0) {
    return { root: layout.root, floating: layout.floating.filter((entry) => entry.id !== window.id) };
  }
  return {
    root: layout.root,
    floating: layout.floating.map((entry) =>
      entry.id === window.id
        ? {
            ...entry,
            tabs,
            activeTabId:
              entry.activeTabId === tabId
                ? tabs[tabs.length - 1].id
                : entry.activeTabId,
          }
        : entry,
    ),
  };
};

const withLeafTabs = (
  layout: DockLayout,
  leafId: string,
  tabs: DockTab[],
): DockLayout["root"] =>
  layout.root ? replaceLeafTabs(layout.root, leafId, tabs) : null;

const replaceLeafTabs = (
  root: DockNode,
  leafId: string,
  tabs: DockTab[],
): DockNode => {
  if (root.kind === "leaf") {
    if (root.id !== leafId) return root;
    return {
      ...root,
      tabs,
      activeTabId:
        root.activeTabId && tabs.some((tab) => tab.id === root.activeTabId)
          ? root.activeTabId
          : tabs[tabs.length - 1]?.id ?? null,
    };
  }
  let changed = false;
  const children = root.children.map((child) => {
    const next = replaceLeafTabs(child, leafId, tabs);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...root, children } : root;
};

export const dockReducer = (state: DockState, action: DockAction): DockState => {
  switch (action.type) {
    case "open-tab": {
      const { tab, target: explicit, rect, metrics } = action;

      if (rect && metrics && !explicit) {
        const window = createFloatingWindow(
          createId("window"),
          normalizeRect(rect, metrics),
          [tab],
          tab.id,
        );
        return {
          layout: { root: state.layout.root, floating: [...state.layout.floating, window] },
          focusId: window.id,
        };
      }

      const target = explicit ?? defaultTarget(state.layout, state.focusId);
      if (!target) return state;

      if (target.kind === "empty" || !state.layout.root) {
        const id = createId("group");
        return {
          layout: {
            root: { kind: "leaf", id, tabs: [tab], activeTabId: tab.id, state: "open" },
            floating: state.layout.floating,
          },
          focusId: id,
        };
      }

      const layout = openTabInto(state.layout, tab, target, () => createId("group"));
      if (layout === state.layout) return state;
      return {
        layout,
        focusId:
          target.kind === "floating" ? target.windowId : target.leafId,
      };
    }

    case "close-tab": {
      const layout = detachTab(state.layout, action.tabId);
      if (layout === state.layout) return state;
      return {
        layout,
        focusId:
          state.focusId && !containerExists(layout, state.focusId)
            ? null
            : state.focusId,
      };
    }

    case "activate-tab": {
      const containerId =
        action.containerId ?? containerOf(state.layout, action.tabId);
      if (!containerId) return state;

      const leaf = findLeaf(state.layout.root, containerId);
      if (leaf) {
        const root = activateTabInLeaf(state.layout.root, containerId, action.tabId);
        if (root === state.layout.root) return { ...state, focusId: containerId };
        return { layout: { root, floating: state.layout.floating }, focusId: containerId };
      }

      if (findFloating(state.layout, containerId)) {
        const floating = state.layout.floating.map((window) =>
          window.id === containerId
            ? { ...window, ...withActivatedTab(window, action.tabId) }
            : window,
        );
        return { layout: { root: state.layout.root, floating }, focusId: containerId };
      }

      return state;
    }

    case "set-window-state": {
      const { windowId, state: next } = action;
      const leaf = findLeaf(state.layout.root, windowId);
      if (leaf) {
        const root = setLeafState(state.layout.root, windowId, next);
        if (root === state.layout.root) return state;
        return { ...state, layout: { root, floating: state.layout.floating } };
      }
      if (findFloating(state.layout, windowId)) {
        const floating = state.layout.floating.map((window) =>
          window.id === windowId ? { ...window, state: next } : window,
        );
        return { ...state, layout: { root: state.layout.root, floating } };
      }
      return state;
    }

    case "raise": {
      if (!findFloating(state.layout, action.windowId)) return state;
      const floating = raiseFloating(state.layout.floating, action.windowId);
      if (floating === state.layout.floating) return { ...state, focusId: action.windowId };
      return {
        layout: { root: state.layout.root, floating },
        focusId: action.windowId,
      };
    }

    case "float-tab": {
      const source = findLeafOfTab(state.layout.root, action.tabId);
      const floatingSource = state.layout.floating.find((window) =>
        window.tabs.some((tab) => tab.id === action.tabId),
      );
      const sourceContainer = source ?? floatingSource;
      const tab = sourceContainer?.tabs.find((entry) => entry.id === action.tabId);
      if (!sourceContainer || !tab) return state;

      const withoutTab = detachTab(state.layout, action.tabId);
      const window = createFloatingWindow(
        action.windowId,
        action.rect,
        [tab],
        tab.id,
      );
      return {
        layout: { root: withoutTab.root, floating: [...withoutTab.floating, window] },
        focusId: window.id,
      };
    }

    case "drop": {
      const layout = applyDrop(state.layout, {
        sourceId: action.sourceId,
        rect: action.rect,
        target: action.target,
        metrics: action.metrics,
      });
      if (layout === state.layout) return { ...state, focusId: action.sourceId };

      const focus =
        containerExists(layout, action.sourceId)
          ? action.sourceId
          : action.target && action.target.kind !== "empty"
            ? action.target.kind === "floating"
              ? action.target.windowId
              : action.target.leafId
            : collectLeaves(layout.root)[0]?.id ?? layout.floating[0]?.id ?? null;

      return { layout, focusId: focus };
    }

    case "set-rect": {
      if (!findFloating(state.layout, action.windowId)) return state;
      const rect = normalizeRect(action.rect, action.metrics);
      const layout = withFloatingRect(state.layout, action.windowId, (window) =>
        window.rect.x === rect.x &&
        window.rect.y === rect.y &&
        window.rect.width === rect.width &&
        window.rect.height === rect.height
          ? window
          : { ...window, rect, state: "open" },
      );
      if (layout === state.layout) return state;
      return { ...state, layout };
    }

    case "set-split-sizes": {
      const root = setSplitSizes(state.layout.root, action.splitId, action.sizes);
      if (root === state.layout.root) return state;
      return { ...state, layout: { root, floating: state.layout.floating } };
    }

    case "set-layout": {
      return { layout: action.layout, focusId: null };
    }

    case "reflow": {
      const layout = reflowFloating(state.layout, action.metrics);
      if (layout === state.layout) return state;
      return { ...state, layout };
    }

    default:
      return state;
  }
};

const containerExists = (layout: DockLayout, id: string): boolean =>
  Boolean(findLeaf(layout.root, id) ?? findFloating(layout, id));
