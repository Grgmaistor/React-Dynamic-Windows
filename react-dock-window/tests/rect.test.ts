import { describe, expect, it } from "vitest";

import {
  createDefaultRect,
  displayRect,
  normalizeRect,
  pointInRect,
  rectsEqual,
  resizeRect,
} from "../src/core/rect";
import type { AreaMetrics, DockOptions } from "../src/types";

const metrics: AreaMetrics = {
  width: 1200,
  height: 800,
  padding: 0,
  minWidth: 180,
  minHeight: 120,
};

const options: Pick<DockOptions, "headerHeight"> = { headerHeight: 40 };

describe("normalizeRect", () => {
  it("clamps a rect back inside the area", () => {
    const rect = normalizeRect({ x: -50, y: -20, width: 400, height: 300 }, metrics);

    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(metrics.width);
  });

  it("never shrinks a window below the minimum size", () => {
    const rect = normalizeRect({ x: 0, y: 0, width: 10, height: 5 }, metrics);

    expect(rect.width).toBe(metrics.minWidth);
    expect(rect.height).toBe(metrics.minHeight);
  });

  it("keeps an oversized window inside the area", () => {
    const rect = normalizeRect({ x: 0, y: 0, width: 5000, height: 5000 }, metrics);

    expect(rect.width).toBe(metrics.width);
    expect(rect.height).toBe(metrics.height);
  });
});

describe("displayRect", () => {
  const rect = { x: 100, y: 80, width: 400, height: 300 };

  it("returns the model rect for an open window", () => {
    expect(displayRect("open", rect, metrics, options)).toEqual(rect);
  });

  it("fills the area when maximized", () => {
    const max = displayRect("maximized", rect, metrics, options);

    expect(max).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  });

  it("collapses to the header when minimized, keeping x/y/width", () => {
    const min = displayRect("minimized", rect, metrics, options);

    expect(min.x).toBe(rect.x);
    expect(min.width).toBe(rect.width);
    expect(min.height).toBe(options.headerHeight);
  });

  it("never overwrites the windowed rect", () => {
    const before = { ...rect };
    displayRect("maximized", rect, metrics, options);
    displayRect("minimized", rect, metrics, options);

    expect(rect).toEqual(before);
  });
});

describe("resizeRect", () => {
  const start = { x: 200, y: 200, width: 400, height: 300 };

  it("grows from the right edge without moving the left edge", () => {
    const next = resizeRect(start, "right", 60, 0, metrics);

    expect(next.x).toBe(start.x);
    expect(next.width).toBe(start.width + 60);
  });

  it("moves the left edge and compensates the width", () => {
    const next = resizeRect(start, "left", -50, 0, metrics);

    expect(next.x).toBe(start.x - 50);
    expect(next.width).toBe(start.width + 50);
    expect(next.x + next.width).toBe(start.x + start.width);
  });

  it("adjusts both axes from a corner", () => {
    const next = resizeRect(start, "bottom-right", 40, 30, metrics);

    expect(next.width).toBe(start.width + 40);
    expect(next.height).toBe(start.height + 30);
  });

  it("clamps to the minimum size instead of going negative", () => {
    const next = resizeRect(start, "right", -10_000, 0, metrics);

    expect(next.width).toBe(metrics.minWidth);
  });

  it("keeps the result inside the area", () => {
    const next = resizeRect(start, "right", 10_000, 10_000, metrics);

    expect(next.x + next.width).toBeLessThanOrEqual(metrics.width);
    expect(next.y + next.height).toBeLessThanOrEqual(metrics.height);
  });
});

describe("helpers", () => {
  it("detects points inside a rect", () => {
    const rect = { x: 10, y: 10, width: 100, height: 100 };

    expect(pointInRect({ x: 10, y: 10 }, rect)).toBe(true);
    expect(pointInRect({ x: 111, y: 50 }, rect)).toBe(false);
  });

  it("compares rects field by field", () => {
    expect(rectsEqual({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true);
    expect(rectsEqual({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 })).toBe(false);
  });

  it("cascades default rects inside the area", () => {
    const rect = createDefaultRect(3, metrics);

    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(metrics.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(metrics.height);
  });
});
