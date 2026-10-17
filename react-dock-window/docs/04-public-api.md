# 04 — Public API

Everything below is exported from the package root (`react-dock-window`).
Styles ship as `react-dock-window/styles.css` — import them once.

---

## Components

### `<DockProvider>`

Owns layout state and the drag runtime. Put it above everything that should
be able to call `useDock()`.

```tsx
<DockProvider
  initialLayout={layout ?? null}   // DockLayout | null — omit for empty
  options={{ edgeRatio: 0.25 }}    // Partial<DockOptions> — see Options
  onLayoutChange={(layout) => …}   // fires after every settled change
>
  {children}
</DockProvider>
```

### `<DockArea>`

The layout surface: dock tree, floating layer and drop overlay.

```tsx
<DockArea
  className="my-dock"                       // extra class on the area root
  renderView={(tab) => <Panel tab={tab} />} // body of the active tab
  empty={<p>Drop a window here</p>}         // shown when nothing is docked
/>
```

### `<WindowFrame>`, `<TabStrip>`, `<Divider>`

Exported for advanced customization (custom shells, headless reuse). In
normal use `DockArea` renders them for you. `WindowFrame` takes
`{ windowId, container, variant, style, renderView }`; `TabStrip`
`{ containerId, tabs, activeTabId }`; `Divider` `{ splitId, index, direction }`.

---

## Hooks

### `useDock(): DockApi`

Composes everything below; use it in host components.

```ts
interface DockApi {
  layout: DockLayout;          // current layout (identity changes on edits)
  focusId: string | null;      // last-interacted group/window id
  options: DockOptions;        // resolved options (defaults + overrides)
  metrics: AreaMetrics;        // live area size, padding, minimums
  open(tab, target?): void;    // dock a tab (focused group by default)
  openFloating(tab, rect?): void;
  close(tabId): void;
  activate(tabId, containerId?): void;
  setWindowState(windowId, state): void;
  setSplitSizes(splitId, sizes): void;
  setLayout(layout): void;
  getLayout(): DockLayout;     // latest without re-rendering
  serialize(): string;         // JSON snapshot of the layout
}
```

### Narrow hooks

- `useDockLayout()` → `{ layout, focusId }` — subscribe only to layout.
- `useDockOptions()` → `{ options, metrics }`.
- `useDockActions()` → the imperative half of the API (stable identity —
  safe as a dependency).
- `useDockRuntime()` → internal DOM plumbing (`beginMove`, `registerCell`,
  …). Only useful when building custom chrome.

### `loadLayout(raw: string): DockLayout | null`

Parses a serialized layout; returns `null` for invalid input. Malformed
parts (duplicate ids, empty groups, bad rects) are dropped, never thrown.

### `DEFAULT_OPTIONS`

The resolved defaults (below), useful as a spread base.

---

## Options

All optional on `<DockProvider options={…}>`; defaults in brackets.

| Option | Meaning |
| --- | --- |
| `edgeRatio: number` `[0.25]` | Share of a group (0..1) that is the split band |
| `stackInset: number` `[0.4]` | Distance from the border for a stack (must exceed `edgeRatio`) |
| `minWindowWidth / minWindowHeight: number` `[180 / 120]` | Minimum floating window size (px) |
| `padding: number` `[0]` | Space kept between floating windows and the area border |
| `tabPullThreshold: number` `[12]` | Travel (px) before a pressed tab tears out |
| `dragThreshold: number` `[5]` | Travel (px) before a press counts as a drag |
| `headerHeight: number` `[40]` | Header height (px); keep in sync with `--rdw-header-height` |
| `minSplitShare: number` `[0.1]` | Smallest weight a divider can leave on either side |
| `forceFloatAltKey: boolean` `[true]` | Alt+release forces a floating drop |
| `labels: DockLabels` | `{ minimize, maximize, restore, close }` for control tooltips/aria |

---

## Model types

```ts
type Rect = { x: number; y: number; width: number; height: number }; // area-local
type Point = { x: number; y: number };
type WindowState = "open" | "minimized" | "maximized";
type SplitDirection = "row" | "column";
type DockZone = "left" | "right" | "top" | "bottom" | "center";

interface DockTab {
  id: string;
  title: string;
  icon?: ReactNode;      // rendered left of the title
  closable?: boolean;    // default true
  data?: unknown;        // your payload; renderView looks content up by id
}

interface DockLayout { root: DockNode | null; floating: FloatingWindow[]; }
type DockNode = LeafGroup | SplitGroup;

interface LeafGroup  { kind: "leaf";  id; tabs: DockTab[]; activeTabId; state }
interface SplitGroup { kind: "split"; id; direction; sizes: number[]; children: DockNode[] }

interface FloatingWindow {
  id: string; rect: Rect;      // rect always stores windowed geometry
  tabs: DockTab[]; activeTabId: string | null; state: WindowState;
}

type DropTarget =
  | { kind: "leaf"; leafId: string; zone: DockZone }   // split (edge) or stack (center)
  | { kind: "floating"; windowId: string }             // merge tab stacks
  | { kind: "empty" };                                 // layout is empty

interface AreaMetrics { width; height; padding; minWidth; minHeight }
```

---

## Core helpers (headless)

The `core/` modules are exported so you can build your own UI on the same
model, or unit-test host logic against it.

**Tree** (`collectLeaves`, `findLeaf`, `findLeafOfTab`, `findSplit`,
`findParentSplit`, `isSplit`, `splitLeaf`, `removeLeaf`, `replaceNode`,
`replaceNodeById`, `addTabToLeaf`, `activateTabInLeaf`, `setLeafState`,
`setSplitSizes`, `withAddedTab`, `withActivatedTab`, `withFloatingRect`,
`raiseFloating`, `activeTab`, `normalizeSizes`, `dragSplitSizes`,
`createFloatingWindow`, `findFloating`) — pure traversal/edit functions
returning new trees (same reference when unchanged).

**Drop** (`bandOf`, `resolveDropTarget`, `previewFor`, `applyDrop`,
`stackIntoLeaf`, `defaultTarget`, `openTabInto`, `reflowFloating`; types
`DropInput`, `DropSnapshot`, `LeafBox`) — the dynamic snapping pipeline from
[03](03-dynamic-snapping.md).

**Rect** (`clamp`, `normalizeRect`, `displayRect`, `resizeRect`,
`createDefaultRect`, `pointInRect`, `rectsEqual`, `intersects`,
`fallbackMetrics`, `toAreaPoint`, `toAreaRect`, `toClientRect`).

**State** (`dockReducer` + `DockAction` union) — use it with `useReducer` to
host the model outside `DockProvider`.

**Serialization** (`serializeLayout`, `parseLayout`).

**Ids** (`createId`).

---

## Theming

Override any custom property on the area (or an ancestor):

```css
.my-dock {
  --rdw-bg: #1e1e1e;
  --rdw-surface: #252526;
  --rdw-surface-2: #2d2d30;
  --rdw-border: #3c3c3c;
  --rdw-text: #cccccc;
  --rdw-text-muted: #858585;
  --rdw-accent: #0e639c;
  --rdw-accent-soft: rgba(14, 99, 156, 0.35);
  --rdw-danger: #a1260d;
  --rdw-radius: 4px;
  --rdw-header-height: 40px;    /* keep equal to options.headerHeight */
  --rdw-divider-width: 6px;
  --rdw-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
}
```

Class hooks for restyling: `.rdw-window--docked|--floating`, `.is-dragging`,
`.is-snap-preview`, `.is-minimized`, `.is-maximized`, `.is-active` (tab),
`.rdw-overlay[data-zone]`.
