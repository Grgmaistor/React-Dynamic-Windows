import {
  memo,
  useCallback,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  useDockActions,
  useDockOptions,
  useDockRuntime,
} from "../context/DockContext";
import type { ResizeEdge } from "../core/rect";
import type { DockTab, FloatingWindow, LeafGroup } from "../types";
import { TabStrip } from "./TabStrip";

const RESIZE_EDGES: ResizeEdge[] = [
  "top",
  "right",
  "bottom",
  "left",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

export interface WindowFrameProps {
  windowId: string;
  /** Tabs, active tab and display state of this group. */
  container: LeafGroup | FloatingWindow;
  variant: "docked" | "floating";
  /** Position/size overrides (maximize, minimized header, cascade). */
  style?: CSSProperties;
  renderView: (tab: DockTab) => ReactNode;
}

/**
 * The window chrome: title bar, window controls, tab strip, body and — for
 * floating windows — the eight resize handles.
 *
 * The element registers itself under `windowId` so the drag runtime can
 * measure it and write its styles directly while a pointer session runs.
 */
export const WindowFrame = memo(function WindowFrame({
  windowId,
  container,
  variant,
  style,
  renderView,
}: WindowFrameProps) {
  const { setWindowState, close } = useDockActions();
  const { options } = useDockOptions();
  const { beginMove, beginResize, registerWindow } = useDockRuntime();

  const setRef = useCallback(
    (element: HTMLDivElement | null) => registerWindow(windowId, element),
    [registerWindow, windowId],
  );

  const state = container.state;
  const active: DockTab | null =
    container.tabs.find((tab) => tab.id === container.activeTabId) ??
    container.tabs[container.tabs.length - 1] ??
    null;

  const headerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    beginMove(windowId, event);
  };

  const toggleMaximize = () => {
    setWindowState(windowId, state === "maximized" ? "open" : "maximized");
  };

  const className = [
    "rdw-window",
    `rdw-window--${variant}`,
    state === "minimized" ? "is-minimized" : "",
    state === "maximized" ? "is-maximized" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const resizable = variant === "floating" && state === "open";

  return (
    <div
      ref={setRef}
      className={className}
      data-window-id={windowId}
      data-state={state}
      style={style}
    >
      <div
        className="rdw-header"
        onPointerDown={headerPointerDown}
        onDoubleClick={toggleMaximize}
      >
        <span className="rdw-title">{active?.title ?? ""}</span>
        <div className="rdw-controls">
          <button
            type="button"
            className="rdw-control"
            aria-label={state === "minimized" ? options.labels.restore : options.labels.minimize}
            title={state === "minimized" ? options.labels.restore : options.labels.minimize}
            onClick={() => setWindowState(windowId, state === "minimized" ? "open" : "minimized")}
          >
            {state === "minimized" ? "▲" : "−"}
          </button>
          <button
            type="button"
            className="rdw-control"
            aria-label={state === "maximized" ? options.labels.restore : options.labels.maximize}
            title={state === "maximized" ? options.labels.restore : options.labels.maximize}
            onClick={toggleMaximize}
          >
            {state === "maximized" ? "❐" : "☐"}
          </button>
          <button
            type="button"
            className="rdw-control rdw-control--close"
            aria-label={options.labels.close}
            title={options.labels.close}
            onClick={() => active && close(active.id)}
          >
            ✕
          </button>
        </div>
      </div>

      {container.tabs.length > 0 ? (
        <TabStrip
          containerId={windowId}
          tabs={container.tabs}
          activeTabId={container.activeTabId}
        />
      ) : null}

      {state !== "minimized" && active ? (
        <div className="rdw-body">{renderView(active)}</div>
      ) : null}

      {resizable
        ? RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className={`rdw-resize rdw-resize--${edge}`}
              data-edge={edge}
              onPointerDown={(event) => beginResize(windowId, edge, event)}
            />
          ))
        : null}
    </div>
  );
});
