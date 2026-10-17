/* react-dock-window
 * Docking window system: floating windows, tab groups, tear-out tabs and
 * dynamic VS Code style split docking.
 *
 * Styles live in `./styles/react-dock-window.css` and are bundled to
 * `react-dock-window/styles.css` — import them once next to the components.
 */

import "./styles/react-dock-window.css";

/* ------------------------------- components ----------------------------- */

export { DockProvider, DEFAULT_OPTIONS, loadLayout } from "./context/DockContext";
export type {
  DockActions,
  DockApi,
  DockProviderProps,
  DockRuntime,
} from "./context/DockContext";
export {
  useDock,
  useDockActions,
  useDockLayout,
  useDockOptions,
  useDockRuntime,
} from "./context/DockContext";

export { DockArea } from "./components/DockArea";
export type { DockAreaProps } from "./components/DockArea";
export { WindowFrame } from "./components/WindowFrame";
export type { WindowFrameProps } from "./components/WindowFrame";
export { TabStrip } from "./components/TabStrip";
export type { TabStripProps } from "./components/TabStrip";
export { Divider } from "./components/Divider";
export type { DividerProps } from "./components/Divider";

/* ------------------------------ model helpers --------------------------- */

export {
  activeTab,
  activateTabInLeaf,
  addTabToLeaf,
  collectLeaves,
  createFloatingWindow,
  dragSplitSizes,
  findFloating,
  findLeaf,
  findLeafOfTab,
  findParentSplit,
  findSplit,
  isSplit,
  normalizeSizes,
  raiseFloating,
  removeLeaf,
  replaceNode,
  replaceNodeById,
  setLeafState,
  setSplitSizes,
  splitLeaf,
  withActivatedTab,
  withAddedTab,
  withFloatingRect,
} from "./core/tree";

export {
  applyDrop,
  bandOf,
  defaultTarget,
  openTabInto,
  previewFor,
  reflowFloating,
  resolveDropTarget,
  stackIntoLeaf,
} from "./core/drop";
export type { DropInput, DropSnapshot, LeafBox } from "./core/drop";

export { parseLayout, serializeLayout } from "./core/serialize";
export { dockReducer } from "./core/reducer";
export type { DockAction } from "./core/reducer";
export { createId } from "./core/ids";

export {
  clamp,
  createDefaultRect,
  displayRect,
  fallbackMetrics,
  intersects,
  normalizeRect,
  pointInRect,
  rectsEqual,
  resizeRect,
  toAreaPoint,
  toAreaRect,
  toClientRect,
} from "./core/rect";
export type { ResizeEdge } from "./core/rect";

/* --------------------------------- types --------------------------------- */

export type {
  AreaMetrics,
  DockLabels,
  DockLayout,
  DockNode,
  DockOptions,
  DockState,
  DockTab,
  DockZone,
  DropPreview,
  DropTarget,
  FloatingWindow,
  LeafGroup,
  Point,
  Rect,
  SplitDirection,
  SplitGroup,
  WindowState,
} from "./types";
