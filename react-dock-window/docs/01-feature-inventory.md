# 01 — Feature inventory

Every window and window-layout feature of the source system (BooleanTable's
`Window.tsx`, `PanelSnapLayout.tsx` and `panelManager.ts`), what it does, and
where it lives in `react-dock-window`. This is the preservation contract: if
a behavior is listed here and marked **kept**, it has a test in the new
library.

Project-specific concerns (panel kinds, translation keys, the circuit editor)
are deliberately **not** part of the library; they are listed under
[Stripped](#stripped-from-the-library) with their replacement for host apps.

---

## 1. Window chrome

### 1.1 Title bar
- **Source**: `.window-header` with a label, always visible.
- **Behavior**: draggable to move the window; a press on a button inside it
  never starts a drag (`closest("button")` guard).
- **Kept**: `.rdw-header` — drag to move, buttons excluded, double-click
  toggles maximize.

### 1.2 Window controls
- **Source**: minimize (−), maximize (□), close (✕) buttons.
- **Behavior**: minimize collapses to a header-height strip; maximize fills
  the viewport; close removes the panel. During a drag the buttons still
  work and report the in-flight state.
- **Kept**: `.rdw-control` trio with `aria-label`/`title` from
  `options.labels`; minimize/restore, maximize/restore, close the active tab.

### 1.3 Display states
- **Source**: `PanelState = Open | Closed | Maximized | Minimized`.
  - *Maximized* renders at the viewport rect; the windowed rect is parked in
    `restoreRectRef` and comes back on restore.
  - *Minimized* renders at header height at its last x/y; a **drop while
    minimized settles the full-size rect** so docking/restore stays coherent
    (the restored window lands where you dropped the strip).
  - A viewport resize while maximized re-measures the display rect.
- **Kept**: `WindowState = open | closed | maximized | minimized` where
  `rect` *always* stores the windowed geometry and the display rect is
  derived (`displayRect`), so no restore-rect bookkeeping is needed; reflow
  clamps floating windows back into the area on resize.

### 1.4 Raising / z-order
- **Source**: `onRaise` fires on any press inside a window (capture phase);
  the owner re-appends the panel to its queue, and paint order follows queue
  order.
- **Kept**: pressing anywhere in a floating window dispatches `raise`,
  which moves it to the end of the `floating` array (paint order = array
  order). Docked groups raise through focus.

### 1.5 Drop preview overlay
- **Source**: a portal-rendered `.snap-preview-overlay` shows where a
  released drag lands (needed because `.window` clips overflow).
- **Kept**: `.rdw-overlay` painted by the provider with direct style writes;
  zone-dependent styling via `data-zone` (including a distinct *floating*
  merge style). No portal needed — it lives in the area's own layer.

---

## 2. Moving windows

### 2.1 Header drag
- **Source**: pointerdown on the header starts a move; the window is clamped
  to the viewport on every move; `pointerup`/`pointercancel` settle.
- **Kept**: identical gesture; clamp now uses the **dock area** rect (windows
  live inside the area, not the viewport) and padding.

### 2.2 Drag thresholds
- **Source**: no explicit move threshold — but the tab-pull threshold
  (`TAB_PULL_THRESHOLD = 12`) protects plain tab clicks from hand drift.
- **Kept and extended**: `dragThreshold` (default 5 px) — a press that moves
  less than this is a click, never a drag; `tabPullThreshold` (default 12 px)
  for tabs. Both configurable.

### 2.3 Settle-at-next-move safety net
- **Source**: a session whose `pointerup` was lost (tab-pull hand-off mounts
  the new window after the release; releasing outside the viewport or
  alt-tabbing mid-drag swallows it) would follow the pointer forever. The
  move handler checks `buttons & 1 === 0` and settles instead.
- **Kept**: same check in the shared move handler
  (`tests/drag.test.tsx` — “lost pointerup” cases for both window and tab
  sessions).

### 2.4 Resizing floating windows
- **Source**: five handles (left, right, bottom, bottom-left, bottom-right);
  resize clamps to viewport + minimum size; only while Open and not docked.
- **Kept and extended**: eight handles (four edges + four corners), minimum
  size and area clamp, only for open floating windows
  (`resizeRect` + `.rdw-resize--*`). Docked groups are resized by dividers
  instead (§4.2).

---

## 3. Tabs and groups

### 3.1 Tab strip
- **Source**: rendered only when a group has more than one tab; the active
  tab is marked and clicking selects.
- **Kept**: rendered whenever the group has tabs (`closable` flags and icons
  supported); the active tab moves to the back of the stack on select.

### 3.2 Select on press
- **Source**: pressing a tab activates it **immediately** (not on release),
  so hand drift is never mistaken for a pull.
- **Kept**: `beginTabPress` dispatches `activate-tab` on pointerdown.

### 3.3 Tab pull / tear-out
- **Source**: after `TAB_PULL_THRESHOLD` of travel, a pressed tab in a
  multi-tab group fires `onTabPull`; the owner creates a new window and hands
  a `DragRequest` back so the fresh window keeps following the pointer. Pulling
  the *only* tab drags the whole window instead.
- **Kept**, with the hand-off removed: the provider owns both sides, so the
  torn-out window is created and promoted to a move session in the same
  pointer session — no `DragRequest` round-trip, no mount-timing race. A
  single-tab pull also moves the whole window.

### 3.4 Group membership
- **Source**: one `Window` per group; tabs are group members; the owner
  (panelManager) keeps the queue.
- **Kept**: a `LeafGroup` (docked) or `FloatingWindow` owns its tabs; groups
  with no tabs are removed automatically; the dock tree replaces the owner's
  queue for docked groups.

---

## 4. Docking and layout

### 4.1 Fixed snap zones (source) → dynamic drop model (library)
- **Source**: exactly four zones (`left | center | right | bottom`) defined by
  guide elements in `PanelSnapLayout`; `getSnapZoneFromRect` picks a zone by
  overlap; `applySnapToPanel` snaps the rect into the zone's parent. Zones
  are per-app constants (`DEFAULT_PANEL_ZONES`), and a drop merges into the
  zone even if occupied.
- **Kept (behavior) / replaced (mechanism)**: the *feel* — drop near an edge
  to dock, drop in the middle to merge — is preserved, but resolved
  dynamically against whatever group is under the pointer, on any edge
  (top included), with live previews. See
  [03-dynamic-snapping.md](03-dynamic-snapping.md).

### 4.2 Zone dividers (source) → split dividers (library)
- **Source**: three draggable handles between zones (two vertical, one
  horizontal) resizing the fixed zone widths; `Panel_SIZE_FACTORS` mapped
  factors to pixel widths.
- **Kept**: every split renders a draggable divider; sizes are normalized
  weights that reflow all descendants; `minSplitShare` clamps how small a
  side can get. Zone factors are gone — weights emerge from user actions.

### 4.3 Reflow on viewport change
- **Source**: a `ResizeObserver` on the layout reports size changes; zones
  recompute from factors; floating panels are re-clamped.
- **Kept**: the area observes itself; split weights reflow automatically
  (flex layout); `reflow` clamps floating windows; maximized windows follow
  the area rect.

### 4.4 Snapping while dragging
- **Source**: cached snap targets/parents measured once per drag; a preview
  overlay shows the landing zone; the settle snaps to the same cached guides
  so preview == landing.
- **Kept**: a `DropSnapshot` (group rects, floating rects, area) measured at
  drag start; the preview overlay is painted every move; the settle resolves
  against the same snapshot.

---

## 5. Persistence and programmatic control

### 5.1 Layout serialization
- **Source**: the owner kept panels in `useState` with rects/zones; no
  serializer — persistence was the host's job.
- **Added**: `serialize()`/`loadLayout()` round-trip the full dock tree and
  floating windows to versioned JSON; the parser drops anything invalid
  (duplicate ids, empty groups, malformed rects) instead of throwing.

### 5.2 Imperative panel management
- **Source**: `panelManager` exposed add/remove/select/toggle per
  `PanelKind`, single-instance rules, default zones, translated labels.
- **Kept (generic)**: `open`, `openFloating`, `close`, `activate`,
  `setWindowState`, `setSplitSizes`, `setLayout`, `getLayout` — all keyed by
  tab/window id, no panel taxonomy.
- **Stripped**: `PanelKind`, `PANEL_LABELS`, `DEFAULT_PANEL_ZONES`,
  `SINGLE_INSTANCE_PANELS`, `translate`. Host apps implement their own panel
  registry on top (see migration guide).

---

## Stripped from the library

| Source concept | Why it left | Host replacement |
| --- | --- | --- |
| `PanelKind` enum | Project taxonomy, not a window concern | Your own union type passed as `DockTab.id`/`data` |
| `PANEL_LABELS` + `translate()` | i18n is app policy | Pass `title`/`icon` on each `DockTab` |
| `DEFAULT_PANEL_ZONES` | Fixed zones no longer exist | `open(tab, target)` or let it land in the focused group |
| `SINGLE_INSTANCE_PANELS` | Policy, not mechanism | Check `findLeafOfTab`/`findFloating` before `open()` |
| Viewport-global coordinates | Windows now live inside `<DockArea>` | Render the area wherever your workspace is |
| `DragRequest` hand-off | Race-prone mount-time protocol | Nothing — tear-out is internal |
| `Closed` as a rendered state | Closing is removal now | `close(tabId)` |
| `vector2`/`BoundingBox` geometry | Shared with the circuit editor | Irrelevant to windows |
