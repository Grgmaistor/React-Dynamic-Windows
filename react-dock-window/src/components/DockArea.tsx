import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  useDockLayout,
  useDockOptions,
  useDockRuntime,
} from "../context/DockContext";
import type { DockNode, DockTab, FloatingWindow, LeafGroup, WindowState } from "../types";
import { Divider } from "./Divider";
import { WindowFrame } from "./WindowFrame";

export interface DockAreaProps {
  className?: string;
  /** Renders the body of the active tab in every window. */
  renderView?: (tab: DockTab) => ReactNode;
  /** Shown while the layout has no docked group. */
  empty?: ReactNode;
}

interface AreaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const cellStyle = (flex?: number): CSSProperties => ({
  flex: flex === undefined ? "1 1 0" : `${flex} 1 0`,
  minWidth: 0,
  minHeight: 0,
  position: "relative",
  display: "flex",
});

/** Inline geometry a docked window needs beyond `inset: 0`. */
const dockedStyle = (state: WindowState, box: AreaBox, headerHeight: number): CSSProperties | undefined => {
  if (state === "maximized") {
    return {
      position: "fixed",
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
    };
  }
  if (state === "minimized") return { height: headerHeight };
  return undefined;
};

const floatingStyle = (
  window: FloatingWindow,
  box: AreaBox,
  headerHeight: number,
): CSSProperties => {
  const base: CSSProperties = {
    left: window.rect.x,
    top: window.rect.y,
    width: window.rect.width,
    height: window.rect.height,
  };
  if (window.state === "maximized") {
    return { left: box.x, top: box.y, width: box.width, height: box.height };
  }
  if (window.state === "minimized") {
    return { ...base, height: headerHeight };
  }
  return base;
};

interface LeafCellProps {
  node: LeafGroup;
  flex: number | undefined;
  box: AreaBox;
  renderView: (tab: DockTab) => ReactNode;
}

const LeafCell = memo(function LeafCell({ node, flex, box, renderView }: LeafCellProps) {
  const { options } = useDockOptions();
  const { registerCell } = useDockRuntime();
  const setRef = useCallback(
    (element: HTMLDivElement | null) => registerCell(node.id, element),
    [node.id, registerCell],
  );

  return (
    <div className="rdw-cell" style={cellStyle(flex)} ref={setRef} data-leaf-id={node.id}>
      <WindowFrame
        windowId={node.id}
        container={node}
        variant="docked"
        style={dockedStyle(node.state, box, options.headerHeight)}
        renderView={renderView}
      />
    </div>
  );
});

interface FloatingWindowProps {
  window: FloatingWindow;
  box: AreaBox;
  renderView: (tab: DockTab) => ReactNode;
}

const FloatingWindowView = memo(function FloatingWindowView({
  window,
  box,
  renderView,
}: FloatingWindowProps) {
  const { options } = useDockOptions();
  return (
    <WindowFrame
      windowId={window.id}
      container={window}
      variant="floating"
      style={floatingStyle(window, box, options.headerHeight)}
      renderView={renderView}
    />
  );
});

/**
 * The layout surface.
 *
 * Renders the dock tree (cells + dividers), the floating window layer and the
 * drop preview overlay, and reports the area geometry back to the provider so
 * drops and clamping use real coordinates.
 */
export function DockArea({ className, renderView, empty }: DockAreaProps) {
  const { layout } = useDockLayout();
  const { reportSize, areaRef, overlayRef } = useDockRuntime();
  const [box, setBox] = useState<AreaBox>({ x: 0, y: 0, width: 0, height: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);

  const renderViewRef = useRef(renderView);
  useEffect(() => {
    renderViewRef.current = renderView;
  });
  const renderStable = useCallback(
    (tab: DockTab) => renderViewRef.current?.(tab),
    [],
  );

  const measure = useCallback(() => {
    const element = rootRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const next: AreaBox = {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    setBox((current) =>
      current.x === next.x &&
      current.y === next.y &&
      current.width === next.width &&
      current.height === next.height
        ? current
        : next,
    );
    reportSize(next);
  }, [reportSize]);

  const setRoot = useCallback(
    (element: HTMLDivElement | null) => {
      rootRef.current = element;
      areaRef(element);
      if (element) measure();
    },
    [areaRef, measure],
  );

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const renderNode = (node: DockNode, flex?: number): ReactNode => {
    if (node.kind === "leaf") {
      return (
        <LeafCell
          key={node.id}
          node={node}
          flex={flex}
          box={box}
          renderView={renderStable}
        />
      );
    }

    return (
      <div
        key={node.id}
        className="rdw-split"
        data-direction={node.direction}
        style={{
          ...cellStyle(flex),
          flexDirection: node.direction === "row" ? "row" : "column",
        }}
      >
        {node.children.map((child, index) => (
          <Fragment key={child.id}>
            {index > 0 ? (
              <Divider
                splitId={node.id}
                index={index}
                direction={node.direction}
              />
            ) : null}
            {renderNode(child, node.sizes[index])}
          </Fragment>
        ))}
      </div>
    );
  };

  const hasDock = layout.root !== null;
  const classes = ["rdw-area", className ?? ""].filter(Boolean).join(" ");

  return (
    <div className={classes} ref={setRoot} data-testid="rdw-area">
      <div className="rdw-dock">
        {hasDock ? (
          renderNode(layout.root!)
        ) : (
          <div className="rdw-empty">{empty}</div>
        )}
      </div>

      <div className="rdw-layer">
        {layout.floating.map((window) => (
          <FloatingWindowView
            key={window.id}
            window={window}
            box={box}
            renderView={renderStable}
          />
        ))}
      </div>

      <div ref={overlayRef} className="rdw-overlay" aria-hidden="true" />
    </div>
  );
}
