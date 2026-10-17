# react-dock-window

A docking window system for React: floating windows, tab groups, tear-out tabs
and **dynamic VS Code–style split docking**. Extracted from the BooleanTable
window manager and redesigned: fixed snap zones are gone, replaced by a
dock tree with pointer-driven splits, stacks and merges.

- **Zero re-renders during drags** — the dragged window follows the pointer
  through direct style writes; React state changes only when a drag settles.
- **Any layout, not four zones** — drops split any group on any edge, stack
  tabs into any group, or merge floating windows. The dock tree stays balanced
  (splits collapse when a side empties).
- **Tab groups everywhere** — every docked group and floating window is a tab
  strip; pull a tab out to tear it into a new window, drop it on another
  group to merge.
- **Persistence** — serialize the whole layout to JSON and restore it later;
  malformed saves degrade gracefully instead of crashing.
- **Themed with CSS variables** — every color, radius and size is a `--rdw-*`
  custom property.
- **Headless core** — the tree, drop resolution and reducer are plain
  TypeScript with no React dependency; the React layer is a thin shell.

## Quick start

```tsx
import { DockArea, DockProvider } from "react-dock-window";
import "react-dock-window/styles.css";

function App() {
  return (
    <DockProvider>
      <DockArea renderView={(tab) => <Editor tab={tab} />} />
    </DockProvider>
  );
}

// Open panels from anywhere inside the provider:
const { open, openFloating } = useDock();
open({ id: "inspector", title: "Inspector" });          // dock into the focused group
openFloating({ id: "notes", title: "Notes" });           // open as a floating window
```

Run the demo in this repository:

```bash
npm install
npm run dev        # demo app at http://localhost:5173
npm test           # 122 unit + DOM regression tests
npm run build      # library build: ESM + CJS + styles + .d.ts
```

## What you can do with it

| Interaction | Result |
| --- | --- |
| Drag a window header | Move the window; drop previews appear under the pointer |
| Drop on the outer band of a group | Split the group on that edge (left/right/top/bottom) |
| Drop in the core of a group | Stack the dragged tabs into that group |
| Drop in the ring between | Nothing — the window stays floating where you release it |
| Hold **Alt** while releasing | Force a floating drop, even over a dockable group |
| Pull a tab out of a multi-tab group | Tear it into a new floating window that follows the pointer |
| Drag a divider | Resize the two adjacent groups (weights clamp at a minimum share) |
| Double-click a header | Maximize / restore |
| Drop a group back onto itself | No-op — it returns to its dock slot |

## Documentation

| Document | Contents |
| --- | --- |
| [docs/01-feature-inventory.md](docs/01-feature-inventory.md) | Every window/layout feature of the source system this library preserves |
| [docs/02-architecture.md](docs/02-architecture.md) | Layers, modules, data flow, render strategy |
| [docs/03-dynamic-snapping.md](docs/03-dynamic-snapping.md) | The VS Code–style drop model (bands, tree edits, previews) |
| [docs/04-public-api.md](docs/04-public-api.md) | Components, hooks, options, types, imperative API |
| [docs/05-migration-from-booleantable.md](docs/05-migration-from-booleantable.md) | File/function mapping from the source project and what was stripped |
| [docs/06-test-plan.md](docs/06-test-plan.md) | Test suite layout, strategies and regressions covered |

## Requirements

- React ≥ 18 (tested with 19)
- Modern browsers with Pointer Events support

## License

MIT
