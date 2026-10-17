import type { AreaMetrics, DockOptions, Point, Rect, WindowState } from "../types";

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const rectsEqual = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const pointInRect = (point: Point, rect: Rect): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

/** Keeps a rect inside the area, honouring padding and minimum sizes. */
export const normalizeRect = (
  rect: Rect,
  metrics: AreaMetrics,
): Rect => {
  const width = clamp(
    rect.width,
    metrics.minWidth,
    Math.max(metrics.minWidth, metrics.width - metrics.padding * 2),
  );
  const height = clamp(
    rect.height,
    metrics.minHeight,
    Math.max(metrics.minHeight, metrics.height - metrics.padding * 2),
  );
  const x = clamp(
    rect.x,
    metrics.padding,
    Math.max(metrics.padding, metrics.width - metrics.padding - width),
  );
  const y = clamp(
    rect.y,
    metrics.padding,
    Math.max(metrics.padding, metrics.height - metrics.padding - height),
  );
  return { x, y, width, height };
};

/** Geometry a window renders at for the given display state. */
export const displayRect = (
  state: WindowState,
  rect: Rect,
  metrics: AreaMetrics,
  options: Pick<DockOptions, "headerHeight">,
): Rect => {
  if (state === "maximized") {
    return {
      x: metrics.padding,
      y: metrics.padding,
      width: Math.max(metrics.minWidth, metrics.width - metrics.padding * 2),
      height: Math.max(metrics.minHeight, metrics.height - metrics.padding * 2),
    };
  }

  if (state === "minimized") {
    return { ...rect, height: Math.min(options.headerHeight, rect.height) };
  }

  return rect;
};

/** Cascaded default rect for a newly opened floating window. */
export const createDefaultRect = (
  index: number,
  metrics: AreaMetrics,
  aspect = 0.62,
): Rect => {
  const width = clamp(metrics.width * 0.4, metrics.minWidth, 520);
  const height = clamp(
    width * aspect,
    metrics.minHeight,
    Math.max(metrics.minHeight, metrics.height * 0.6),
  );
  const step = 28;
  const x = metrics.padding + (index % 6) * step;
  const y = metrics.padding + (index % 6) * step;

  return normalizeRect({ x, y, width, height }, metrics);
};

/** Converts a viewport point into dock-area local coordinates. */
export const toAreaPoint = (client: Point, origin: Point): Point => ({
  x: client.x - origin.x,
  y: client.y - origin.y,
});

/** Converts an area-local rect into viewport coordinates. */
export const toClientRect = (rect: Rect, origin: Point): Rect => ({
  x: rect.x + origin.x,
  y: rect.y + origin.y,
  width: rect.width,
  height: rect.height,
});

/** Converts a viewport rect into dock-area local coordinates. */
export const toAreaRect = (rect: Rect, origin: Point): Rect => ({
  x: rect.x - origin.x,
  y: rect.y - origin.y,
  width: rect.width,
  height: rect.height,
});

/** Resizes a floating window from one of its eight edges/corners. */
export type ResizeEdge =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const resizeRect = (
  start: Rect,
  edge: ResizeEdge,
  deltaX: number,
  deltaY: number,
  metrics: AreaMetrics,
): Rect => {
  let { x, y, width, height } = start;

  const moveLeft = edge.includes("left");
  const moveRight = edge.includes("right");
  const moveTop = edge.includes("top");
  const moveBottom = edge.includes("bottom");

  if (moveLeft) {
    const nextX = clamp(
      x + deltaX,
      metrics.padding,
      x + width - metrics.minWidth,
    );
    width += x - nextX;
    x = nextX;
  }

  if (moveRight) {
    width = clamp(
      width + deltaX,
      metrics.minWidth,
      metrics.width - metrics.padding - x,
    );
  }

  if (moveTop) {
    const nextY = clamp(
      y + deltaY,
      metrics.padding,
      y + height - metrics.minHeight,
    );
    height += y - nextY;
    y = nextY;
  }

  if (moveBottom) {
    height = clamp(
      height + deltaY,
      metrics.minHeight,
      metrics.height - metrics.padding - y,
    );
  }

  return normalizeRect({ x, y, width, height }, metrics);
};

/** Default metrics when the area has not been measured yet. */
export const fallbackMetrics = (
  options: Pick<DockOptions, "padding" | "minWindowWidth" | "minWindowHeight">,
): AreaMetrics => ({
  width: typeof window === "undefined" ? 1280 : window.innerWidth || 1280,
  height: typeof window === "undefined" ? 760 : window.innerHeight || 760,
  padding: options.padding,
  minWidth: options.minWindowWidth,
  minHeight: options.minWindowHeight,
});
