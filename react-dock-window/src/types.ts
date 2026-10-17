import type { ReactNode } from "react";

/** Rectangle in dock-area local coordinates (origin = top-left of the area). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Point = { x: number; y: number };

/** Window display state. `rect` always stores the windowed geometry. */
export type WindowState = "open" | "minimized" | "maximized";

/** One tab inside a window group. The host renders the body via `renderView`. */
export interface DockTab {
  id: string;
  title: string;
  /** Rendered left of the title in the tab strip. */
  icon?: ReactNode;
  /** Defaults to `true`. */
  closable?: boolean;
  /** Free-form host payload (handy when `renderView` looks content up by id). */
  data?: unknown;
}

export type SplitDirection = "row" | "column";

/** A window group inside the dock tree: owns tabs, active tab and state. */
export interface LeafGroup {
  kind: "leaf";
  id: string;
  tabs: DockTab[];
  /** `null` only for an empty (placeholder) group. */
  activeTabId: string | null;
  state: WindowState;
}

/** Two or more children laid out along one axis with draggable dividers. */
export interface SplitGroup {
  kind: "split";
  id: string;
  direction: SplitDirection;
  /** Weights, one per child, summing to 1. */
  sizes: number[];
  children: DockNode[];
}

export type DockNode = LeafGroup | SplitGroup;

/** A window that floats above the dock tree at its own rect. */
export interface FloatingWindow {
  id: string;
  /** Windowed geometry, area-local. Never overwritten by maximize/minimize. */
  rect: Rect;
  tabs: DockTab[];
  activeTabId: string | null;
  state: WindowState;
}

export interface DockLayout {
  root: DockNode | null;
  /** Paint order: last entry renders on top. */
  floating: FloatingWindow[];
}

/** Where a drop lands relative to a docked group. */
export type DockZone = "left" | "right" | "top" | "bottom" | "center";

export type DropTarget =
  /** Split (`zone !== "center"`) or stack (`zone === "center"`) into a group. */
  | { kind: "leaf"; leafId: string; zone: DockZone }
  /** Merge the dragged tabs into an existing floating window. */
  | { kind: "floating"; windowId: string }
  /** The layout is empty: the drop creates the root group. */
  | { kind: "empty" };

/** Visual preview painted while a drag can land. */
export interface DropPreview {
  rect: Rect;
  /** `free` = release keeps the window floating. */
  zone: DockZone | "floating" | "free";
}

/** Resolved geometry of the area, used for clamping and hit tests. */
export interface AreaMetrics {
  /** Area size in px. */
  width: number;
  height: number;
  /** Padding kept between a floating window and the area border. */
  padding: number;
  minWidth: number;
  minHeight: number;
}

export interface DockLabels {
  minimize: string;
  maximize: string;
  restore: string;
  close: string;
}

export interface DockOptions {
  /** Share of a group (0..1) used as the edge zone that triggers a split. */
  edgeRatio: number;
  /** Distance (0..1) from the group border the pointer must be inside for a stack. */
  stackInset: number;
  /** Minimum floating window size in px. */
  minWindowWidth: number;
  minWindowHeight: number;
  /** Padding between floating windows and the area border in px. */
  padding: number;
  /** Travel (px) before a pressed tab tears out of its group. */
  tabPullThreshold: number;
  /** Travel (px) before a press counts as a real drag (protects plain clicks). */
  dragThreshold: number;
  /** Header height in px, used for minimized windows. */
  headerHeight: number;
  /** Smallest share a divider may leave behind on either side. */
  minSplitShare: number;
  /** Hold Alt while releasing to force a floating drop. */
  forceFloatAltKey: boolean;
  labels: DockLabels;
}

export interface DockState {
  layout: DockLayout;
  /** Window id (leaf or floating) that received the last interaction. */
  focusId: string | null;
}
