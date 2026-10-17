import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { dockReducer } from "../core/reducer";
import { previewFor, resolveDropTarget, type DropSnapshot } from "../core/drop";
import { createId } from "../core/ids";
import {
  clamp,
  displayRect,
  fallbackMetrics,
  resizeRect,
  toAreaPoint,
  toAreaRect,
  toClientRect,
  type ResizeEdge,
} from "../core/rect";
import { parseLayout, serializeLayout } from "../core/serialize";
import { dragSplitSizes, findFloating, findLeaf, findSplit } from "../core/tree";
import type {
  AreaMetrics,
  DockLayout,
  DockOptions,
  DockState,
  DockTab,
  DropTarget,
  Point,
  Rect,
  SplitDirection,
  WindowState,
} from "../types";

export const DEFAULT_OPTIONS: DockOptions = {
  edgeRatio: 0.25,
  stackInset: 0.4,
  minWindowWidth: 180,
  minWindowHeight: 120,
  padding: 0,
  tabPullThreshold: 12,
  dragThreshold: 5,
  headerHeight: 40,
  minSplitShare: 0.1,
  forceFloatAltKey: true,
  labels: {
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore",
    close: "Close",
  },
};

/** Public, stable API exposed by `useDock()`. */
export interface DockApi {
  layout: DockLayout;
  focusId: string | null;
  options: DockOptions;
  metrics: AreaMetrics;
  /** Docks a tab into the focused group (or a sensible default). */
  open: (tab: DockTab, target?: DropTarget) => void;
  /** Opens a tab as a floating window at a cascaded (or given) rect. */
  openFloating: (tab: DockTab, rect?: Rect) => void;
  close: (tabId: string) => void;
  activate: (tabId: string, containerId?: string) => void;
  setWindowState: (windowId: string, state: WindowState) => void;
  /** Sets absolute child weights of a split (normalised internally). */
  setSplitSizes: (splitId: string, sizes: number[]) => void;
  setLayout: (layout: DockLayout) => void;
  getLayout: () => DockLayout;
  serialize: () => string;
}

/** Internal handlers used by the window chrome. */
export interface DockRuntime {
  areaRef: (element: HTMLDivElement | null) => void;
  overlayRef: RefObject<HTMLDivElement | null>;
  registerCell: (id: string, element: HTMLDivElement | null) => void;
  registerWindow: (id: string, element: HTMLDivElement | null) => void;
  reportSize: (size: { x: number; y: number; width: number; height: number }) => void;
  beginMove: (sourceId: string, event: ReactPointerEvent) => void;
  beginResize: (windowId: string, edge: ResizeEdge, event: ReactPointerEvent) => void;
  beginTabPress: (containerId: string, tabId: string, event: ReactPointerEvent) => void;
  beginDivider: (
    splitId: string,
    index: number,
    axisSize: number,
    direction: SplitDirection,
    event: ReactPointerEvent,
  ) => void;
}

interface DockLayoutValue {
  layout: DockLayout;
  focusId: string | null;
}

interface DockOptionsValue {
  options: DockOptions;
  metrics: AreaMetrics;
}

/** The imperative half of the API — stable for the lifetime of the provider. */
export type DockActions = Omit<DockApi, "layout" | "focusId" | "options" | "metrics">;

const DockLayoutContext = createContext<DockLayoutValue | null>(null);
const DockOptionsContext = createContext<DockOptionsValue | null>(null);
const DockActionsContext = createContext<DockActions | null>(null);
const DockRuntimeContext = createContext<DockRuntime | null>(null);

const requireValue = <T,>(value: T | null, hook: string): T => {
  if (value === null) {
    throw new Error(`${hook} must be used inside <DockProvider>`);
  }
  return value;
};

export const useDockLayout = (): DockLayoutValue =>
  requireValue(useContext(DockLayoutContext), "useDockLayout");

export const useDockOptions = (): DockOptionsValue =>
  requireValue(useContext(DockOptionsContext), "useDockOptions");

export const useDockActions = (): DockActions =>
  requireValue(useContext(DockActionsContext), "useDockActions");

export const useDockRuntime = (): DockRuntime =>
  requireValue(useContext(DockRuntimeContext), "useDockRuntime");

/** Everything the host needs: latest layout plus the imperative actions. */
export const useDock = (): DockApi => {
  const state = useDockLayout();
  const { options, metrics } = useDockOptions();
  const actions = useDockActions();
  return useMemo(
    () => ({ ...state, options, metrics, ...actions }),
    [state, options, metrics, actions],
  );
};

/* --------------------------------------------------------------------------
 * Drag sessions live in a ref, never in React state: the dragged window
 * follows the pointer through direct style writes, so a drag costs zero
 * re-renders and never fights React for the same inline styles.
 * ----------------------------------------------------------------------- */

interface SessionBase {
  startX: number;
  startY: number;
  origin: Point;
  areaRect: Rect;
  moved: boolean;
  /** Style attribute captured before the ghost took over; restored on settle. */
  savedStyle: string | null;
  ghostId: string | null;
}

interface MoveSession extends SessionBase {
  kind: "move";
  sourceId: string;
  startRect: Rect;
  modelRect: Rect;
  currentRect: Rect;
  offsetX: number;
  offsetY: number;
  wasState: WindowState;
  snapshot: DropSnapshot | null;
}

interface TabSession extends SessionBase {
  kind: "tab";
  containerId: string;
  tabId: string;
  startRect: Rect;
  offsetX: number;
  offsetY: number;
}

interface ResizeSession extends SessionBase {
  kind: "resize";
  windowId: string;
  edge: ResizeEdge;
  startRect: Rect;
  currentRect: Rect;
}

interface DividerSession extends SessionBase {
  kind: "divider";
  splitId: string;
  index: number;
  axisSize: number;
  direction: SplitDirection;
  sizesAtStart: number[];
}

type Session = MoveSession | TabSession | ResizeSession | DividerSession;

const rectOf = (element: Element): Rect => {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
};

export interface DockProviderProps {
  children: ReactNode;
  initialLayout?: DockLayout | null;
  options?: Partial<DockOptions>;
  onLayoutChange?: (layout: DockLayout) => void;
}

export function DockProvider({
  children,
  initialLayout,
  options: optionOverride,
  onLayoutChange,
}: DockProviderProps) {
  const options = useMemo<DockOptions>(
    () => ({
      ...DEFAULT_OPTIONS,
      ...optionOverride,
      labels: { ...DEFAULT_OPTIONS.labels, ...optionOverride?.labels },
    }),
    [optionOverride],
  );

  const [state, dispatch] = useReducer(
    dockReducer,
    initialLayout ?? { root: null, floating: [] },
    (layout): DockState => ({ layout, focusId: null }),
  );
  const [areaBox, setAreaBox] = useState({ x: 0, y: 0, width: 0, height: 0 });

  const metrics = useMemo<AreaMetrics>(
    () => ({
      width: areaBox.width || fallbackMetrics(options).width,
      height: areaBox.height || fallbackMetrics(options).height,
      padding: options.padding,
      minWidth: options.minWindowWidth,
      minHeight: options.minWindowHeight,
    }),
    [areaBox, options],
  );

  // Latest values for pointer handlers that outlive renders.
  const latest = useRef({ state, options, metrics });
  useEffect(() => {
    latest.current = { state, options, metrics };
  });

  const areaElement = useRef<HTMLDivElement | null>(null);
  const cellEls = useRef(new Map<string, HTMLDivElement>());
  const windowEls = useRef(new Map<string, HTMLDivElement>());
  const sessionRef = useRef<Session | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onLayoutChange?.(state.layout);
  }, [state.layout, onLayoutChange]);

  /* ------------------------------- overlay ----------------------------- */

  const hideOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.style.display = "none";
    overlay.className = "rdw-overlay";
    overlay.removeAttribute("data-zone");
  }, []);

  const paintOverlay = useCallback(
    (target: DropTarget | null, snapshot: DropSnapshot | null, origin: Point) => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const preview = target && snapshot ? previewFor(target, snapshot) : null;
      if (!preview) {
        hideOverlay();
        return;
      }
      overlay.style.display = "block";
      overlay.style.left = `${preview.rect.x + origin.x}px`;
      overlay.style.top = `${preview.rect.y + origin.y}px`;
      overlay.style.width = `${preview.rect.width}px`;
      overlay.style.height = `${preview.rect.height}px`;
      overlay.className = "rdw-overlay is-visible";
      overlay.setAttribute("data-zone", preview.zone);
    },
    [hideOverlay],
  );

  /* ------------------------------ ghost paint -------------------------- */

  const beginGhost = useCallback((session: Session, id: string) => {
    const element = windowEls.current.get(id);
    if (!element || session.ghostId === id) return;
    session.savedStyle = element.style.cssText;
    session.ghostId = id;
    element.classList.add("is-dragging");
  }, []);

  const styleGhost = useCallback((id: string, rect: Rect) => {
    const element = windowEls.current.get(id);
    if (!element) return;
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  }, []);

  const clearGhost = useCallback((session: Session) => {
    if (!session.ghostId) return;
    const element = windowEls.current.get(session.ghostId);
    if (element) {
      element.classList.remove("is-dragging", "is-snap-preview");
      element.style.cssText = session.savedStyle ?? "";
    }
    session.ghostId = null;
    session.savedStyle = null;
  }, []);

  /* ------------------------------ snapshot ----------------------------- */

  const makeSnapshot = useCallback((origin: Point): DropSnapshot => {
    const { state: current, options: opts, metrics: currentMetrics } = latest.current;

    const leaves = [...cellEls.current.entries()]
      .filter(([id]) => findLeaf(current.layout.root, id))
      .map(([id, element]) => ({ leafId: id, rect: toAreaRect(rectOf(element), origin) }));

    return {
      leaves,
      floating: current.layout.floating.map((window) => ({
        id: window.id,
        rect:
          window.state === "open"
            ? window.rect
            : displayRect(window.state, window.rect, currentMetrics, opts),
      })),
      area: { x: 0, y: 0, width: currentMetrics.width, height: currentMetrics.height },
    };
  }, []);

  /* ------------------------------ sessions ----------------------------- */

  const handleMoveRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const handleUpRef = useRef<(event: PointerEvent) => void>(() => undefined);

  const attach = useCallback(() => {
    if (detachRef.current) return;
    const onMove = (event: PointerEvent) => handleMoveRef.current(event);
    const onUp = (event: PointerEvent) => handleUpRef.current(event);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    detachRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const endSession = useCallback((): Session | null => {
    const session = sessionRef.current;
    sessionRef.current = null;
    detachRef.current?.();
    detachRef.current = null;
    areaElement.current?.classList.remove("is-dragging");
    if (session) clearGhost(session);
    hideOverlay();
    return session;
  }, [clearGhost, hideOverlay]);

  const settleMove = (session: MoveSession, event: PointerEvent) => {
    const { metrics: currentMetrics, options: opts } = latest.current;
    const areaLocal = toAreaRect(session.currentRect, session.origin);
    const target =
      opts.forceFloatAltKey && event.altKey
        ? null
        : session.snapshot
          ? resolveDropTarget(
              toAreaPoint({ x: event.clientX, y: event.clientY }, session.origin),
              session.snapshot,
              session.sourceId,
              opts,
            )
          : null;

    dispatch({
      type: "drop",
      sourceId: session.sourceId,
      rect: areaLocal,
      target,
      metrics: currentMetrics,
    });
  };

  const handleResizeMove = (session: ResizeSession, event: PointerEvent) => {
    const { metrics: currentMetrics, options: opts } = latest.current;
    if (!session.moved) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance < opts.dragThreshold) return;
      session.moved = true;
    }

    const startLocal = toAreaRect(session.startRect, session.origin);
    const next = resizeRect(
      startLocal,
      session.edge,
      event.clientX - session.startX,
      event.clientY - session.startY,
      currentMetrics,
    );
    const client = toClientRect(next, session.origin);
    session.currentRect = client;
    beginGhost(session, session.windowId);
    styleGhost(session.windowId, client);
  };

  const handleWindowMove = (session: MoveSession, event: PointerEvent) => {
    const { options: opts, metrics: currentMetrics } = latest.current;

    if (!session.moved) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance < opts.dragThreshold) return;
      session.moved = true;

      if (session.wasState !== "open") {
        // Restore first: the windowed geometry lands under the pointer.
        const offsetX = clamp(session.offsetX, 0, session.modelRect.width);
        const offsetY = clamp(session.offsetY, 0, opts.headerHeight);
        session.offsetX = offsetX;
        session.offsetY = offsetY;
        session.startX = event.clientX;
        session.startY = event.clientY;
        session.startRect = {
          x: event.clientX - offsetX,
          y: event.clientY - offsetY,
          width: session.modelRect.width,
          height: session.modelRect.height,
        };
      }
      session.snapshot = makeSnapshot(session.origin);
    }

    const width = session.startRect.width;
    const height = session.startRect.height;
    const area = session.areaRect;
    const rect: Rect = {
      ...session.startRect,
      x: clamp(
        event.clientX - session.offsetX,
        area.x + currentMetrics.padding,
        area.x + area.width - width - currentMetrics.padding,
      ),
      y: clamp(
        event.clientY - session.offsetY,
        area.y + currentMetrics.padding,
        area.y + area.height - height - currentMetrics.padding,
      ),
    };
    session.currentRect = rect;

    const target = session.snapshot
      ? resolveDropTarget(
          toAreaPoint({ x: event.clientX, y: event.clientY }, session.origin),
          session.snapshot,
          session.sourceId,
          opts,
        )
      : null;

    beginGhost(session, session.sourceId);
    styleGhost(session.sourceId, rect);
    windowEls.current
      .get(session.sourceId)
      ?.classList.toggle("is-snap-preview", target !== null);
    paintOverlay(target, session.snapshot, session.origin);
  };

  const handleTabMove = (session: TabSession, event: PointerEvent) => {
    const { options: opts } = latest.current;

    if (!session.moved) {
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (distance <= opts.tabPullThreshold) return;
      session.moved = true;

      const layout = latest.current.state.layout;
      const container =
        findLeaf(layout.root, session.containerId) ??
        findFloating(layout, session.containerId);

      if (!container) {
        endSession();
        return;
      }

      if (container.tabs.length > 1) {
        // Tear the tab out into its own window, still under the pointer.
        const areaPoint = toAreaPoint(
          { x: event.clientX, y: event.clientY },
          session.origin,
        );
        const rect: Rect = {
          x: areaPoint.x - session.startRect.width / 2,
          y: areaPoint.y - clamp(session.offsetY, 0, opts.headerHeight),
          width: session.startRect.width,
          height: session.startRect.height,
        };
        const windowId = createId("window");
        dispatch({ type: "float-tab", tabId: session.tabId, windowId, rect });
        promoteToMove(session, windowId, toClientRect(rect, session.origin), event);
        return;
      }

      // A single tab: pulling it moves the whole window.
      promoteToMove(session, session.containerId, session.startRect, event);
    }
  };

  /** Turns a tab press into a window move without swapping the listeners. */
  const promoteToMove = (
    tabSession: TabSession,
    sourceId: string,
    client: Rect,
    event: PointerEvent,
  ) => {
    const move: MoveSession = {
      kind: "move",
      sourceId,
      startX: tabSession.startX,
      startY: tabSession.startY,
      startRect: client,
      modelRect: client,
      currentRect: client,
      offsetX: clamp(event.clientX - client.x, 0, client.width),
      offsetY: clamp(event.clientY - client.y, 0, latest.current.options.headerHeight),
      wasState: "open",
      moved: true,
      snapshot: makeSnapshot(tabSession.origin),
      origin: tabSession.origin,
      areaRect: tabSession.areaRect,
      savedStyle: null,
      ghostId: null,
    };
    sessionRef.current = move;
    beginGhost(move, sourceId);
    styleGhost(sourceId, client);
  };

  const handleMove = (event: PointerEvent) => {
    const session = sessionRef.current;
    if (!session) return;

    if (session.kind === "divider") {
      if (!session.moved) {
        const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
        if (distance < 2) return;
        session.moved = true;
      }
      const deltaPx =
        session.direction === "row"
          ? event.clientX - session.startX
          : event.clientY - session.startY;
      dispatch({
        type: "set-split-sizes",
        splitId: session.splitId,
        sizes: dragSplitSizes(
          session.sizesAtStart,
          session.index,
          deltaPx / Math.max(session.axisSize, 1),
          latest.current.options.minSplitShare,
        ),
      });
      return;
    }

    // Safety net: a release we never saw must not leave a session hanging.
    if ((event.buttons & 1) === 0) {
      handleUpRef.current(event);
      return;
    }

    if (session.kind === "tab") handleTabMove(session, event);
    else if (session.kind === "resize") handleResizeMove(session, event);
    else handleWindowMove(session, event);
  };

  const handleUp = (event: PointerEvent) => {
    const session = endSession();
    if (!session) return;

    // Divider sizes are applied live; a tab that never tore out is a click.
    if (session.kind === "divider" || session.kind === "tab") return;
    if (!session.moved) return;

    if (session.kind === "resize") {
      dispatch({
        type: "set-rect",
        windowId: session.windowId,
        rect: toAreaRect(session.currentRect, session.origin),
        metrics: latest.current.metrics,
      });
      return;
    }

    settleMove(session, event);
  };

  useEffect(() => {
    handleMoveRef.current = handleMove;
    handleUpRef.current = handleUp;
  });

  useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  /* ------------------------------ runtime ------------------------------ */

  const beginMove = useCallback(
    (sourceId: string, event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      const area = areaElement.current;
      if (!area) return;
      event.preventDefault();

      const areaRect = rectOf(area);
      const origin = { x: areaRect.x, y: areaRect.y };
      const { state: current, options: opts } = latest.current;
      const floating = findFloating(current.layout, sourceId);
      const leaf = findLeaf(current.layout.root, sourceId);
      const windowState: WindowState = floating?.state ?? leaf?.state ?? "open";

      const windowElement = windowEls.current.get(sourceId);
      const cellElement = cellEls.current.get(sourceId);
      const display = windowElement
        ? rectOf(windowElement)
        : cellElement
          ? rectOf(cellElement)
          : areaRect;
      const model = floating
        ? toClientRect(floating.rect, origin)
        : cellElement
          ? rectOf(cellElement)
          : display;

      const session: MoveSession = {
        kind: "move",
        sourceId,
        startX: event.clientX,
        startY: event.clientY,
        startRect: display,
        modelRect: model,
        currentRect: display,
        offsetX: clamp(event.clientX - display.x, 0, display.width),
        offsetY: clamp(event.clientY - display.y, 0, opts.headerHeight),
        wasState: windowState,
        moved: false,
        snapshot: null,
        origin,
        areaRect,
        savedStyle: null,
        ghostId: null,
      };
      sessionRef.current = session;
      attach();
      area.classList.add("is-dragging");

      if (floating) {
        dispatch({ type: "raise", windowId: sourceId });
      } else if (leaf?.activeTabId) {
        dispatch({
          type: "activate-tab",
          tabId: leaf.activeTabId,
          containerId: sourceId,
        });
      }
    },
    [attach],
  );

  const beginResize = useCallback(
    (windowId: string, edge: ResizeEdge, event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      const area = areaElement.current;
      const element = windowEls.current.get(windowId);
      if (!area || !element) return;
      event.preventDefault();
      event.stopPropagation();

      const areaRect = rectOf(area);
      const box = rectOf(element);
      const session: ResizeSession = {
        kind: "resize",
        windowId,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        startRect: box,
        currentRect: box,
        moved: false,
        origin: { x: areaRect.x, y: areaRect.y },
        areaRect,
        savedStyle: null,
        ghostId: null,
      };
      sessionRef.current = session;
      attach();
      area.classList.add("is-dragging");
    },
    [attach],
  );

  const beginTabPress = useCallback(
    (containerId: string, tabId: string, event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      const element = windowEls.current.get(containerId);
      const area = areaElement.current;
      if (!element || !area) return;
      event.preventDefault();

      dispatch({ type: "activate-tab", tabId, containerId });

      if (findFloating(latest.current.state.layout, containerId)) {
        dispatch({ type: "raise", windowId: containerId });
      }

      const areaBox = rectOf(area);
      const box = rectOf(element);
      const session: TabSession = {
        kind: "tab",
        containerId,
        tabId,
        startX: event.clientX,
        startY: event.clientY,
        startRect: box,
        offsetX: event.clientX - box.x,
        offsetY: event.clientY - box.y,
        moved: false,
        origin: { x: areaBox.x, y: areaBox.y },
        areaRect: areaBox,
        savedStyle: null,
        ghostId: null,
      };
      sessionRef.current = session;
      attach();
    },
    [attach],
  );

  const beginDivider = useCallback(
    (
      splitId: string,
      index: number,
      axisSize: number,
      direction: SplitDirection,
      event: ReactPointerEvent,
    ) => {
      if (event.button !== 0) return;
      const split = findSplit(latest.current.state.layout.root, splitId);
      if (!split) return;
      event.preventDefault();
      event.stopPropagation();

      const area = areaElement.current;
      const areaRect = area ? rectOf(area) : { x: 0, y: 0, width: 0, height: 0 };
      const session: DividerSession = {
        kind: "divider",
        splitId,
        index,
        axisSize,
        direction,
        sizesAtStart: [...split.sizes],
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        origin: { x: areaRect.x, y: areaRect.y },
        areaRect,
        savedStyle: null,
        ghostId: null,
      };
      sessionRef.current = session;
      attach();
      area?.classList.add("is-dragging");
    },
    [attach],
  );

  const registerCell = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) cellEls.current.set(id, element);
    else cellEls.current.delete(id);
  }, []);

  const registerWindow = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) windowEls.current.set(id, element);
    else windowEls.current.delete(id);
  }, []);

  const reportSize = useCallback(
    (size: { x: number; y: number; width: number; height: number }) => {
      setAreaBox((current) =>
        current.x === size.x &&
        current.y === size.y &&
        current.width === size.width &&
        current.height === size.height
          ? current
          : size,
      );
    },
    [],
  );

  /* --------------------------------- api -------------------------------- */

  const layoutValue = useMemo<DockLayoutValue>(
    () => ({ layout: state.layout, focusId: state.focusId }),
    [state.layout, state.focusId],
  );

  const optionsValue = useMemo<DockOptionsValue>(
    () => ({ options, metrics }),
    [options, metrics],
  );

  const actions = useMemo<DockActions>(
    () => ({
      open: (tab, target) => dispatch({ type: "open-tab", tab, target }),
      openFloating: (tab, rect) =>
        dispatch({ type: "open-tab", tab, rect, metrics: latest.current.metrics }),
      close: (tabId) => dispatch({ type: "close-tab", tabId }),
      activate: (tabId, containerId) =>
        dispatch({ type: "activate-tab", tabId, containerId }),
      setWindowState: (windowId, windowState) =>
        dispatch({ type: "set-window-state", windowId, state: windowState }),
      setSplitSizes: (splitId, sizes) =>
        dispatch({ type: "set-split-sizes", splitId, sizes }),
      setLayout: (layout) => dispatch({ type: "set-layout", layout }),
      getLayout: () => latest.current.state.layout,
      serialize: () => serializeLayout(latest.current.state.layout),
    }),
    [],
  );

  const runtime = useMemo<DockRuntime>(
    () => ({
      areaRef: (element) => {
        areaElement.current = element;
      },
      overlayRef,
      registerCell,
      registerWindow,
      reportSize,
      beginMove,
      beginResize,
      beginTabPress,
      beginDivider,
    }),
    [
      registerCell,
      registerWindow,
      reportSize,
      beginMove,
      beginResize,
      beginTabPress,
      beginDivider,
    ],
  );

  return (
    <DockLayoutContext.Provider value={layoutValue}>
      <DockOptionsContext.Provider value={optionsValue}>
        <DockActionsContext.Provider value={actions}>
          <DockRuntimeContext.Provider value={runtime}>
            {children}
          </DockRuntimeContext.Provider>
        </DockActionsContext.Provider>
      </DockOptionsContext.Provider>
    </DockLayoutContext.Provider>
  );
}

/** Rebuilds a persisted layout; returns `null` for invalid input. */
export const loadLayout = (raw: string): DockLayout | null => parseLayout(raw);
