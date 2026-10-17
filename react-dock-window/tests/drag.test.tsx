// @vitest-environment happy-dom
/**
 * Regression tests for drag settling, tear-out and docking — the DOM half of
 * the window system. Geometry is stubbed (happy-dom has no layout), then the
 * pointer sessions run exactly like in a browser: pointerdown starts a session,
 * window-level pointermove/pointerup drive it, and the drop settles on release.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { DockArea } from "../src/components/DockArea";
import { DockProvider } from "../src/context/DockContext";
import type { DockLayout, DockTab, LeafGroup } from "../src/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/* --------------------------------------------------------------- geometry */

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const boxes = new Map<Element, Box>();
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

const zeroBox: Box = { left: 0, top: 0, width: 0, height: 0 };

Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  const box = boxes.get(this) ?? zeroBox;
  return {
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
    toJSON: () => box,
  } as DOMRect;
};

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

/* ----------------------------------------------------------------- harness */

const AREA: Box = { left: 0, top: 0, width: 1000, height: 800 };
const HALF_LEFT: Box = { left: 0, top: 0, width: 500, height: 800 };
const HALF_RIGHT: Box = { left: 500, top: 0, width: 500, height: 800 };

const tab = (id: string): DockTab => ({ id, title: id.toUpperCase() });

const leaf = (id: string, ...tabs: string[]): LeafGroup => ({
  kind: "leaf",
  id,
  tabs: tabs.map(tab),
  activeTabId: tabs[tabs.length - 1] ?? null,
  state: "open",
});

const splitRow = (sizes: number[] = [0.5, 0.5]): DockLayout => ({
  root: {
    kind: "split",
    id: "S1",
    direction: "row",
    sizes,
    children: [leaf("L1", "t1", "t2"), leaf("L2", "t3")],
  },
  floating: [],
});

const roots: Array<{ root: Root; container: HTMLElement }> = [];

afterEach(() => {
  while (roots.length > 0) {
    const entry = roots.pop()!;
    void act(() => entry.root.unmount());
    entry.container.remove();
  }
  boxes.clear();
});

interface Harness {
  container: HTMLElement;
  layout: () => DockLayout;
  setBox: (selector: string, box: Box) => void;
  el: (selector: string) => HTMLElement | null;
  windowEl: (id: string) => HTMLElement | null;
}

async function mount(initialLayout: DockLayout): Promise<Harness> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });

  let latest: DockLayout = initialLayout;
  await act(async () => {
    root.render(
      <DockProvider
        initialLayout={initialLayout}
        onLayoutChange={(next) => {
          latest = next;
        }}
      >
        <DockArea renderView={(active) => <div>{active.title}</div>} />
      </DockProvider>,
    );
  });

  const harness: Harness = {
    container,
    layout: () => latest,
    setBox: (selector, box) => {
      const element = container.querySelector(selector);
      if (element) boxes.set(element, box);
    },
    el: (selector) => container.querySelector<HTMLElement>(selector),
    windowEl: (id) =>
      container.querySelector<HTMLElement>(`.rdw-window[data-window-id="${id}"]`),
  };

  // Stub the area geometry, then re-trigger the measure so the provider's
  // metrics (used for clamping) match the stub instead of the fallback.
  harness.setBox(".rdw-area", AREA);
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });

  return harness;
}

const fire = (
  type: string,
  x: number,
  y: number,
  buttons: number,
  target: EventTarget = window,
  init: MouseEventInit = {},
) => {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
      ...init,
    }),
  );
};

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};

const headerOf = (harness: Harness, id: string) =>
  harness.el(`.rdw-window[data-window-id="${id}"] .rdw-header`);

const leafTabs = (layout: DockLayout, leafId: string) => {
  const find = (node: DockLayout["root"]): DockLayout["root"] => {
    if (!node || node.kind === "leaf") return node?.id === leafId ? node : null;
    for (const child of node.children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  return find(layout.root)?.kind === "leaf"
    ? (find(layout.root) as { tabs: DockTab[]; activeTabId: string | null })
    : null;
};

/* ------------------------------------------------------------------- tests */

describe("window drag settle", () => {
  it("header drag follows the pointer, then stops after pointerup", async () => {
    const harness = await mount(splitRow());
    harness.setBox('.rdw-cell[data-leaf-id="L1"]', HALF_LEFT);
    harness.setBox('.rdw-cell[data-leaf-id="L2"]', HALF_RIGHT);
    harness.setBox('.rdw-window[data-window-id="L1"]', HALF_LEFT);
    harness.setBox('.rdw-window[data-window-id="L2"]', HALF_RIGHT);

    const header = headerOf(harness, "L1")!;
    await act(async () => fire("pointerdown", 100, 100, 1, header));
    await flush();

    await act(async () => fire("pointermove", 250, 180, 1));
    await flush();
    // Ghost follows via direct style writes: x = 250 - 100, y clamped to 0.
    expect(harness.windowEl("L1")!.style.left).toBe("150px");
    expect(harness.windowEl("L1")!.style.top).toBe("0px");
    // Dropping back onto the source group previews as a stack.
    expect(harness.el(".rdw-overlay")!.getAttribute("data-zone")).toBe("center");

    await act(async () => fire("pointerup", 250, 180, 0));
    await flush();

    // Self drop is a no-op: the layout is untouched and the ghost styles are
    // restored, so the docked window snaps back into its cell.
    const layout = harness.layout();
    expect(layout.floating).toHaveLength(0);
    expect(leafTabs(layout, "L1")?.tabs.map((entry) => entry.id)).toEqual(["t1", "t2"]);
    expect(harness.windowEl("L1")!.style.left).toBe("");
    expect(harness.el(".rdw-overlay")!.style.display).toBe("none");

    // A move with no button held must not drag the window again.
    await act(async () => fire("pointermove", 400, 400, 0));
    await flush();
    expect(harness.windowEl("L1")!.style.left).toBe("");
  });

  it("a plain click on the header never starts a drag", async () => {
    const harness = await mount(splitRow());
    harness.setBox('.rdw-window[data-window-id="L1"]', HALF_LEFT);

    const header = headerOf(harness, "L1")!;
    await act(async () => fire("pointerdown", 100, 100, 1, header));
    await flush();
    // 2px of hand drift stays under the drag threshold.
    await act(async () => fire("pointermove", 102, 101, 1));
    await flush();
    expect(harness.windowEl("L1")!.style.left).toBe("");

    await act(async () => fire("pointerup", 102, 101, 0));
    await flush();
    expect(harness.layout().floating).toHaveLength(0);
  });

  it("dragging a group out of the area tears it into a floating window", async () => {
    const harness = await mount(splitRow());
    harness.setBox('.rdw-cell[data-leaf-id="L1"]', HALF_LEFT);
    harness.setBox('.rdw-cell[data-leaf-id="L2"]', HALF_RIGHT);
    harness.setBox('.rdw-window[data-window-id="L1"]', HALF_LEFT);
    harness.setBox('.rdw-window[data-window-id="L2"]', HALF_RIGHT);

    const header = headerOf(harness, "L1")!;
    await act(async () => fire("pointerdown", 100, 100, 1, header));
    await flush();
    await act(async () => fire("pointermove", 1200, 300, 1));
    await flush();
    // Outside the area there is no dock target: no overlay is painted.
    expect(harness.el(".rdw-overlay")!.style.display).toBe("none");

    await act(async () => fire("pointerup", 1200, 300, 0));
    await flush();

    const layout = harness.layout();
    // The split collapsed into the remaining group.
    expect(layout.root?.kind).toBe("leaf");
    expect(layout.root?.id).toBe("L2");
    // L1 became a floating window with its tabs, settled at the clamped rect.
    expect(layout.floating).toHaveLength(1);
    expect(layout.floating[0].id).toBe("L1");
    expect(layout.floating[0].tabs.map((entry) => entry.id)).toEqual(["t1", "t2"]);
    expect(layout.floating[0].rect).toEqual({ x: 500, y: 0, width: 500, height: 800 });
    expect(layout.floating[0].state).toBe("open");
  });

  it("lost pointerup: the next move settles the drag instead of following", async () => {
    const harness = await mount(splitRow());
    harness.setBox('.rdw-cell[data-leaf-id="L1"]', HALF_LEFT);
    harness.setBox('.rdw-cell[data-leaf-id="L2"]', HALF_RIGHT);
    harness.setBox('.rdw-window[data-window-id="L1"]', HALF_LEFT);
    harness.setBox('.rdw-window[data-window-id="L2"]', HALF_RIGHT);

    const header = headerOf(harness, "L1")!;
    await act(async () => fire("pointerdown", 100, 100, 1, header));
    await flush();
    await act(async () => fire("pointermove", 250, 180, 1));
    await flush();
    expect(harness.windowEl("L1")!.style.left).toBe("150px");

    // The pointerup was lost; the first move without the button settles.
    await act(async () => fire("pointermove", 400, 400, 0));
    await flush();
    expect(harness.windowEl("L1")!.style.left).toBe("");

    // Later moves are ignored: no session is alive.
    await act(async () => fire("pointermove", 700, 700, 0));
    await flush();
    expect(harness.windowEl("L1")!.style.left).toBe("");
    expect(harness.layout().floating).toHaveLength(0);
  });

  it("double-clicking the header toggles maximize", async () => {
    const harness = await mount(splitRow());
    harness.setBox('.rdw-window[data-window-id="L1"]', HALF_LEFT);

    const header = headerOf(harness, "L1")!;
    await act(async () => fire("dblclick", 100, 20, 0, header));
    await flush();
    expect(harness.windowEl("L1")!.getAttribute("data-state")).toBe("maximized");
    expect(harness.windowEl("L1")!.style.position).toBe("fixed");

    await act(async () => fire("dblclick", 100, 20, 0, header));
    await flush();
    expect(harness.windowEl("L1")!.getAttribute("data-state")).toBe("open");
    expect(harness.windowEl("L1")!.style.position).toBe("");
  });

  it("window controls minimize, restore and close", async () => {
    const harness = await mount(splitRow());
    harness.setBox('.rdw-window[data-window-id="L1"]', HALF_LEFT);
    const frame = () => harness.windowEl("L1")!;
    const control = (index: number) =>
      frame().querySelectorAll<HTMLElement>(".rdw-header .rdw-control")[index];

    await act(async () => fire("click", 0, 0, 0, control(0)));
    await flush();
    expect(frame().getAttribute("data-state")).toBe("minimized");
    expect(frame().style.height).toBe("40px");

    await act(async () => fire("click", 0, 0, 0, control(0)));
    await flush();
    expect(frame().getAttribute("data-state")).toBe("open");

    await act(async () => fire("click", 0, 0, 0, control(2)));
    await flush();
    // The active tab (t2) closed; t1 remains.
    expect(leafTabs(harness.layout(), "L1")?.tabs.map((entry) => entry.id)).toEqual(["t1"]);
    expect(leafTabs(harness.layout(), "L1")?.activeTabId).toBe("t1");
  });
});

describe("tab pull", () => {
  it("tears a tab out of a multi-tab group and settles it as floating", async () => {
    const harness = await mount({ root: leaf("L1", "t1", "t2"), floating: [] });
    harness.setBox('.rdw-cell[data-leaf-id="L1"]', AREA);
    harness.setBox('.rdw-window[data-window-id="L1"]', AREA);

    const secondTab = harness.el('.rdw-window[data-window-id="L1"] .rdw-tab:nth-child(2)')!;
    await act(async () => fire("pointerdown", 60, 50, 1, secondTab));
    await flush();

    // Beyond the pull threshold the tab detaches into its own window.
    await act(async () => fire("pointermove", 400, 300, 1));
    await flush();
    const torn = harness.layout().floating[0];
    expect(torn.tabs.map((entry) => entry.id)).toEqual(["t2"]);
    expect(leafTabs(harness.layout(), "L1")?.tabs.map((entry) => entry.id)).toEqual(["t1"]);

    // The detached window keeps following the pointer while held.
    await act(async () => fire("pointermove", 1200, 400, 1));
    await flush();
    expect(harness.windowEl(torn.id)!.style.left).toBe("0px");

    await act(async () => fire("pointerup", 1200, 400, 0));
    await flush();

    const layout = harness.layout();
    expect(layout.floating).toHaveLength(1);
    expect(layout.floating[0].tabs.map((entry) => entry.id)).toEqual(["t2"]);
    expect(layout.floating[0].rect).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    expect(leafTabs(layout, "L1")?.tabs.map((entry) => entry.id)).toEqual(["t1"]);
  });

  it("a tab press without travel only activates the tab", async () => {
    const harness = await mount({ root: leaf("L1", "t1", "t2"), floating: [] });
    harness.setBox('.rdw-window[data-window-id="L1"]', AREA);

    const firstTab = harness.el('.rdw-window[data-window-id="L1"] .rdw-tab:nth-child(1)')!;
    await act(async () => fire("pointerdown", 60, 50, 1, firstTab));
    await flush();
    await act(async () => fire("pointerup", 60, 50, 0));
    await flush();

    const group = leafTabs(harness.layout(), "L1")!;
    expect(group.activeTabId).toBe("t1");
    // Activating moves the tab to the back of the stack.
    expect(group.tabs.map((entry) => entry.id)).toEqual(["t2", "t1"]);
    expect(harness.layout().floating).toHaveLength(0);
  });

  it("lost pointerup: a released tab press cannot turn into a pull", async () => {
    const harness = await mount({ root: leaf("L1", "t1", "t2"), floating: [] });
    harness.setBox('.rdw-window[data-window-id="L1"]', AREA);

    const firstTab = harness.el('.rdw-window[data-window-id="L1"] .rdw-tab:nth-child(1)')!;
    await act(async () => fire("pointerdown", 60, 50, 1, firstTab));
    await flush();
    // The release was never delivered; this move has no button held.
    await act(async () => fire("pointermove", 400, 300, 0));
    await flush();

    expect(harness.layout().floating).toHaveLength(0);
    expect(leafTabs(harness.layout(), "L1")?.tabs.map((entry) => entry.id)).toEqual(["t2", "t1"]);
  });
});

describe("docking drops", () => {
  const floatingLayout = (): DockLayout => ({
    root: leaf("L1", "t1"),
    floating: [
      {
        id: "F1",
        rect: { x: 600, y: 100, width: 300, height: 200 },
        tabs: [tab("t2")],
        activeTabId: "t2",
        state: "open",
      },
    ],
  });

  it("dropping a floating window on a group stacks its tabs", async () => {
    const harness = await mount(floatingLayout());
    harness.setBox('.rdw-cell[data-leaf-id="L1"]', AREA);
    harness.setBox('.rdw-window[data-window-id="L1"]', AREA);
    harness.setBox('.rdw-window[data-window-id="F1"]', {
      left: 600,
      top: 100,
      width: 300,
      height: 200,
    });

    const header = headerOf(harness, "F1")!;
    await act(async () => fire("pointerdown", 700, 120, 1, header));
    await flush();
    // Drag into the core of L1: the overlay previews a stack.
    await act(async () => fire("pointermove", 500, 400, 1));
    await flush();
    expect(harness.el(".rdw-overlay")!.getAttribute("data-zone")).toBe("center");
    expect(harness.windowEl("F1")!.style.left).toBe("400px");

    await act(async () => fire("pointerup", 500, 400, 0));
    await flush();

    const layout = harness.layout();
    expect(layout.floating).toHaveLength(0);
    const group = leafTabs(layout, "L1")!;
    expect(group.tabs.map((entry) => entry.id)).toEqual(["t1", "t2"]);
    expect(group.activeTabId).toBe("t2");
  });

  it("releasing with Alt keeps the window floating over a dockable group", async () => {
    const harness = await mount(floatingLayout());
    harness.setBox('.rdw-cell[data-leaf-id="L1"]', AREA);
    harness.setBox('.rdw-window[data-window-id="L1"]', AREA);
    harness.setBox('.rdw-window[data-window-id="F1"]', {
      left: 600,
      top: 100,
      width: 300,
      height: 200,
    });

    const header = headerOf(harness, "F1")!;
    await act(async () => fire("pointerdown", 700, 120, 1, header));
    await flush();
    await act(async () => fire("pointermove", 500, 400, 1));
    await flush();
    await act(async () => fire("pointerup", 500, 400, 0, window, { altKey: true }));
    await flush();

    const layout = harness.layout();
    expect(layout.floating).toHaveLength(1);
    expect(layout.floating[0].rect).toEqual({ x: 400, y: 380, width: 300, height: 200 });
    expect(leafTabs(layout, "L1")?.tabs.map((entry) => entry.id)).toEqual(["t1"]);
  });

  it("splitting: dropping on a group edge previews and applies a split", async () => {
    const harness = await mount(floatingLayout());
    harness.setBox('.rdw-cell[data-leaf-id="L1"]', AREA);
    harness.setBox('.rdw-window[data-window-id="L1"]', AREA);
    harness.setBox('.rdw-window[data-window-id="F1"]', {
      left: 600,
      top: 100,
      width: 300,
      height: 200,
    });

    const header = headerOf(harness, "F1")!;
    await act(async () => fire("pointerdown", 700, 120, 1, header));
    await flush();
    // Near the left edge of L1: left split band.
    await act(async () => fire("pointermove", 40, 400, 1));
    await flush();
    expect(harness.el(".rdw-overlay")!.getAttribute("data-zone")).toBe("left");

    await act(async () => fire("pointerup", 40, 400, 0));
    await flush();

    const layout = harness.layout();
    expect(layout.floating).toHaveLength(0);
    expect(layout.root?.kind).toBe("split");
    if (layout.root?.kind === "split") {
      expect(layout.root.direction).toBe("row");
      expect(layout.root.children[0].kind).toBe("leaf");
      const first = layout.root.children[0];
      if (first.kind === "leaf") {
        expect(first.tabs.map((entry) => entry.id)).toEqual(["t2"]);
      }
    }
  });
});
