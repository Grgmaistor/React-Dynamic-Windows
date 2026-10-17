# 02 — Architecture

```
src/
├── types.ts                 All model types (Rect, DockTab, DockNode, ...)
├── core/                    Pure TypeScript — no React imports
│   ├── ids.ts               Unique id generation
│   ├── rect.ts              Geometry: clamp, normalize, display, resize, coords
│   ├── tree.ts              Dock tree: traversal + structural edits
│   ├── drop.ts              Drop resolution: bands, previews, applying drops
│   ├── reducer.ts           dockReducer: state transitions for every action
│   └── serialize.ts         Versioned JSON round-trip with validation
├── context/
│   └── DockContext.tsx      Provider: options, metrics, drag sessions, API
├── components/
│   ├── DockArea.tsx         Layout surface: dock tree + floating layer + overlay
│   ├── WindowFrame.tsx      Window chrome: header, controls, tabs, body, resize
│   ├── TabStrip.tsx         Tab bar of one group
│   └── Divider.tsx          Draggable splitter between two groups
└── styles/
    └── react-dock-window.css   All visuals, themed via --rdw-* variables
```

The design rule: **everything that can be a unit test lives in `core/`**.
The React layer only measures DOM, paints drag feedback, and dispatches.

## 1. The dock tree

A layout is a `DockLayout`:

```ts
interface DockLayout {
  root: DockNode | null;        // the docked tree; null = nothing docked
  floating: FloatingWindow[];   // paint order: last renders on top
}

type DockNode = LeafGroup | SplitGroup;

interface LeafGroup {           // one window group: tabs + active tab + state
  kind: "leaf"; id: string; tabs: DockTab[];
  activeTabId: string | null; state: WindowState;
}

interface SplitGroup {          // two+ children along one axis
  kind: "split"; id: string; direction: "row" | "column";
  sizes: number[];              // weights, sum = 1
  children: DockNode[];
}
```

Key properties:

- **Groups own tabs** — a tab lives in exactly one leaf or floating window.
  Closing the last tab removes the group; `removeLeaf` collapses splits with
  a single survivor, so the tree never holds empty shells.
- **Sizes are weights, not pixels** — the DOM lays out with flexbox from the
  weights, so a viewport resize reflows every descendant for free. Divider
  drags mutate only the pair of weights being dragged (`dragSplitSizes`).
- **Structural edits return new trees** — but bail out with the *same*
  reference when nothing changes, so no-op interactions never re-render.
- **Splits join when axes match** — dropping on the right edge of a group
  whose parent is already a row split inserts into that parent (one divider)
  instead of nesting a new split. The tree stays shallow.

## 2. State: reducer + provider

`DockState = { layout, focusId }` transitions through `dockReducer` with these
actions:

| Action | Effect |
| --- | --- |
| `open-tab` | Stack into a group / split / open floating / create root |
| `close-tab` | Remove a tab; empty containers disappear; stale focus cleared |
| `activate-tab` | Move tab to the active position; focus the container |
| `set-window-state` | open / minimized / maximized (rect never overwritten) |
| `raise` | Move a floating window to the top of the paint order |
| `float-tab` | Tear one tab out into a new floating window |
| `drop` | Apply a settled drag (the §3 pipeline) |
| `set-rect` | Settle a floating window's rect (normalizes, reopens minimized) |
| `set-split-sizes` | Divider drag result |
| `set-layout` | Replace the whole layout (restore from storage) |
| `reflow` | Clamp floating windows after an area resize |

Every case is pure and returns the same state object when the action is a
no-op — the provider's `useReducer` then skips the render entirely.

## 3. The drag pipeline

```
pointerdown ─► session (ref) ─► pointermove ×N ─► pointerup ─► settle ─► dispatch
                │                  │                                │
                │                  ├─ ghost: direct style writes    ├─ resolve target
                │                  └─ overlay: direct style writes  └─ reducer "drop"
                └─ zero React state
```

1. **Press** (`beginMove`/`beginTabPress`/`beginResize`/`beginDivider`) —
   records start geometry, grab offsets, area rect; attaches window-level
   `pointermove`/`pointerup`/`pointercancel` listeners. The session lives in
   a `useRef`, never in state.
2. **Move** — below `dragThreshold` nothing happens (a click is a click).
   Past it: the ghost element (the window itself, `is-dragging`) is styled
   directly — `left/top/width/height` writes, no React. For moves, a
   `DropSnapshot` taken at drag start feeds `resolveDropTarget`, whose result
   paints the overlay (also direct writes).
3. **Lost-pointerup safety net** — any move event with
   `buttons & 1 === 0` settles immediately; a session can never dangle.
4. **Settle** (`pointerup`) — one dispatch: `drop` (moves) or `set-rect`
   (resizes). The reducer applies the layout change; React re-renders once.
   Ghost styles are restored from the saved snapshot before the dispatch, so
   the settled state always comes from React, not from stale inline styles.

Tab tear-out rides the same pipeline: past `tabPullThreshold`, the provider
dispatches `float-tab` and **promotes the tab session into a move session in
the same handler** — the fresh window follows the pointer with no hand-off
protocol (the source project's `DragRequest` existed only to bridge this gap
and is gone).

## 4. Contexts and render budget

Four contexts, split so memoized windows don't re-render on layout churn:

| Context | Value | Changes when |
| --- | --- | --- |
| `DockLayoutContext` | `{ layout, focusId }` | A dispatch lands |
| `DockOptionsContext` | `{ options, metrics }` | Options or area size change |
| `DockActionsContext` | imperative API | Never (stable identity) |
| `DockRuntimeContext` | DOM plumbing for chrome | Never (stable identity) |

`useDock()` composes them for hosts; the internal components use the narrow
hooks (`useDockOptions`, `useDockRuntime`) so a size change doesn't re-render
windows that only need actions. `DockArea` renders the tree with
`memo`-protected `LeafCell`/`FloatingWindowView`, and the body renderer is
wrapped in a ref so passing a new inline `renderView` function doesn't
re-render every window.

## 5. Coordinates

All model geometry is **dock-area local**: origin at the area's top-left,
`{ x, y, width, height }` in CSS pixels. The provider converts at the edges:

- `rectOf(element)` → client rect (viewport coords) for measuring;
- `toAreaPoint` / `toAreaRect` / `toClientRect` — conversions around the
  area origin captured at drag start.

Floating windows are positioned inside the area's relative layer
(`.rdw-layer`), clamped to the area minus `padding`. Because the origin is
captured per session, moving the whole app (a scrolling host, say) doesn't
break an in-flight drag.

## 6. Measurement

`DockArea` measures itself with a `ResizeObserver` (+ window resize) and
reports `{ x, y, width, height }` to the provider, which derives
`AreaMetrics` (size, padding, minimum window size). Group rects for the drop
snapshot come from registered cell elements (`registerCell`), measured once
per drag — the layout cannot change mid-drag, so one measurement is enough.
