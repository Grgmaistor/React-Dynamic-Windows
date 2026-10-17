# 05 — Migration from BooleanTable

How the source window system maps onto `react-dock-window`, and what a host
app must change. Project-specific code (panel registry, i18n, editor content)
stays in the host; everything mechanical is now the library's job.

## 1. File mapping

| BooleanTable source | react-dock-window | Notes |
| --- | --- | --- |
| `src/Components/Window.tsx` | `src/components/WindowFrame.tsx` + `src/context/DockContext.tsx` (sessions) | Chrome stayed; drag machinery moved into the provider (see §3) |
| `src/Components/PanelSnapLayout.tsx` | `src/core/drop.ts` + `src/components/Divider.tsx` | Fixed guide zones → band resolution; zone handles → split dividers |
| `src/panelManager.ts` | `src/core/tree.ts` + `src/core/reducer.ts` | Panel queue → dock tree; add/remove/select → reducer actions |
| `App.tsx` panel state (`useState<ManagedPanel[]>`) | `DockProvider` state | Host keeps only content + panel registry |
| `App.css` `.window`/`.tab-bar`/snap styles | `src/styles/react-dock-window.css` | Class names renamed `.window`→`.rdw-*`, themed by variables |
| `Documentation/Panel_Management_Spec.md` | `docs/01-feature-inventory.md` | Behavior contract in the new terms |
| `tests/windowDrag.test.tsx` | `tests/drag.test.tsx` | Same regressions, new harness |

## 2. Concept mapping

| BooleanTable | react-dock-window |
| --- | --- |
| `PanelKind` ("Inspector", "Workspace", …) | Just a `DockTab.id` (+ `data`) — the library has no taxonomy |
| `ManagedPanel { id, panel, label, state, rect, zone }` | `LeafGroup`/`FloatingWindow` + `DockTab` |
| `PanelState` `Open/Closed/Maximized/Minimized` | `WindowState` `open/maximized/minimized`; *Closed* = tab/group removed |
| `PanelSnapZone` `left/center/right/bottom/floating` | `DockZone` `left/right/top/bottom/center` on a *specific group*; floating = no target |
| `DEFAULT_PANEL_ZONES` | Gone — `open(tab, target?)` picks the focused group, or the host passes a target |
| `SINGLE_INSTANCE_PANELS` | Host policy: check `findLeafOfTab(layout.root, id)` before `open()` |
| `PANEL_LABELS` / `translate()` | `DockTab.title` (+ `icon`) supplied by the host |
| `SnapTargetMap` / `getSnapTargets()` | `DropSnapshot` measured internally at drag start |
| `DragRequest` + `onDragRequestConsumed` | Gone — tear-out is promoted inside one pointer session |
| `onDrop(rect, zone, point)` | `onLayoutChange(layout)` — the settled layout is the single source of truth |
| `setState(state, dragging)` | `setWindowState(id, state)`; dragging needs no callback (no React state during drags) |
| Viewport coordinates | Dock-area-local coordinates |

## 3. What changed mechanically

### 3.1 Windows live inside `<DockArea>`
Source panels were viewport-absolute; the library scopes all geometry to the
area element. Render the area where your workspace is:

```tsx
<DockProvider onLayoutChange={save}>
  <Toolbar />
  <DockArea renderView={(tab) => renderPanel(tab)} />
</DockProvider>
```

### 3.2 The host no longer owns drag callbacks
In BooleanTable, `Window` reported gestures (`onTabPull`, `onDrop`,
`onRaise`, `dragRequest`) and the owner mutated panel state. Now the provider
owns the whole pipeline; the host only supplies content and reacts to
`onLayoutChange`. Delete: `DragSession`/`TabSession` mirrors, the
`dragRequest` hand-off, `restoreRectRef` bookkeeping, snap-guide caching.

### 3.3 Tab pull lost its mount race
The `DragRequest` protocol existed because the torn-out window mounted *after*
the release in fast pulls (the `windowDrag.test.tsx` regressions). Since the
provider creates and promotes the window in the same handler, those races are
structurally impossible; the regressions are kept as tests
(`tests/drag.test.tsx` — “lost pointerup”, “released tab press cannot turn
into a pull”).

### 3.4 Zones became tree edits
`applySnapToPanel` moved a rect into a zone parent; `applyDrop` edits the
tree: stack (merge tabs), split (new sibling group), tear-out (leave the
tree), merge-into-floating. Zone occupancy no longer needs special handling —
a drop always targets the concrete group under the pointer.

## 4. Porting steps for a BooleanTable-like host

1. **Replace panel state with the provider.** Drop `ManagedPanel[]`,
   `panelGroups`, and the layout effects; keep a small registry
   `id → { title, icon, render }` for your panels.
2. **Map panels to tabs.** For each panel kind:
   ```ts
   const toTab = (kind: PanelKind): DockTab => ({
     id: kind, title: t(PANEL_LABELS[kind]), data: kind,
   });
   ```
3. **Port open logic.** `openPanel(kind)` becomes
   `isSingleInstance(kind) && findLeafOfTab(layout.root, kind)
     ? activate(kind)
     : open(toTab(kind))`.
4. **Port default zones** (if you still want them) by passing an explicit
   target, e.g. `{ kind: "leaf", leafId: leftGroupId, zone: "center" }` —
   or keep them as the *initial layout* instead (preferred: build a
   `DockLayout` with the tree you want on first run).
5. **Render bodies via `renderView`.** Look the panel component up by
   `tab.id`/`tab.data`.
6. **Theming.** Copy the palette into `--rdw-*` variables; map old class
   names per the table in the feature inventory.
7. **Persistence.** Replace ad-hoc saves with `serialize()`/`loadLayout()`.
8. **Delete** `PanelSnapLayout.tsx`, the snap parts of `panelManager.ts`,
   `SnapTargetMap` plumbing, and `TAB_PULL_THRESHOLD`-related effects — all
   covered by the library.

## 5. Behaviors intentionally not ported

- **Fixed default zones per panel kind** — replaced by tree-based initial
  layouts (strictly more general).
- **Single-instance enforcement** — policy, one line of host code.
- **Merging into an occupied fixed zone by zone id** — in the dynamic model
  the equivalent gesture (core drop) merges into the group that is actually
  there; there is no separate zone registry to collide with.
- **`Closed` rendered state** — closing removes the tab; a closed panel is
  re-opened with `open()`.
- **`vector2`/`BoundingBox` geometry exports** — shared with the circuit
  editor; unrelated to windows.
