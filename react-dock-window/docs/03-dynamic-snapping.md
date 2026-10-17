# 03 — Dynamic snapping (VS Code–style docking)

The source system had four fixed snap zones (`left | center | right | bottom`)
defined by guide elements, with per-panel default zones. This library replaces
that with a **dynamic drop model**: the landing is resolved against whatever
group happens to be under the pointer, on any edge, using three concentric
bands per target — the same interaction model as Visual Studio Code.

## 1. The three-band model

Every potential drop target (a docked group, or the area itself when the
layout is empty) is divided into bands by normalized distance from its
border:

```
┌──────────────────────────────────────┐
│  edge band (outer `edgeRatio`)       │   ← release splits the group
│  ┌────────────────────────────────┐  │
│  │  ring (`edgeRatio` … `stackInset`) │  ← release keeps it floating
│  │  ┌──────────────────────────┐  │  │
│  │  │                          │  │  │
│  │  │  core (`stackInset`+)    │  │  │   ← release stacks (merges tabs)
│  │  │                          │  │  │
│  │  └──────────────────────────┘  │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

- **Edge band** — within `edgeRatio` (default 0.25) of any border. The
  nearer axis and side pick the zone: `left | right | top | bottom`. Release
  **splits**: a new group is created beside the target on that edge.
- **Core** — at least `stackInset` (default 0.4) from every border. Release
  **stacks**: the dragged tabs join the target group (dock-to-dock), or the
  floating window merges with the one under the pointer (float-to-float).
- **Ring** — everything between. Release is a **no-op**: the window stays
  floating exactly where you dropped it. The ring is what makes "just put it
  down" possible without accidentally docking.

Distances are normalized per axis, so a 200 px-wide column and a 2000 px-wide
editor area get the same proportions. The edge band is additionally clamped
to `stackInset − ε`, so the bands can never overlap even if the options are
configured carelessly.

`bandOf(rect, point, options)` implements this and is a pure function of the
target rect, the point and two numbers — hence trivially testable.

## 2. Target resolution

`resolveDropTarget(point, snapshot, sourceId, options)` walks targets in
order and returns the first hit (or `null` = stay floating):

1. **Outside the area** → `null`. Windows live inside the dock area; a
   release outside it has nowhere to dock.
2. **Floating windows, topmost first** → `{ kind: "floating", windowId }`.
   The dragged window itself is skipped (never a target for itself).
3. **Docked group under the pointer** → its three bands resolve to
   `{ kind: "leaf", leafId, zone }` with `zone: left|right|top|bottom|center`
   (`center` = stack). **A drop back onto the source group resolves to its
   own center**, which `applyDrop` treats as a no-op restore — the window
   returns to its slot without a layout change.
4. **No group under the pointer** (empty layout, or empty space in a partial
   one) → the *area itself* is the target: its core resolves to
   `{ kind: "empty" }` (the drop creates/fills the root group), its edge
   bands and ring resolve to `null`.

### Alt forces float
If `forceFloatAltKey` (default on) and Alt is held at release, the target is
forced to `null` regardless of geometry — the universal escape hatch for
"drop here but keep it floating", exactly like VS Code.

### Snapshot semantics
All rects in the snapshot are measured **once at drag start**, in area-local
coordinates. The layout cannot change while a pointer session is in flight,
so the snapshot stays exact, and the preview the user saw during the drag is
by construction the place the window lands — there is no second measurement
at release that could disagree with the preview.

## 3. Applying a drop

`applyDrop(layout, { sourceId, rect, target, metrics })` covers every
source × target combination:

| Source | Target | Result |
| --- | --- | --- |
| floating | `null` | Stays floating; rect normalized (clamped, min size) |
| docked group | `null` | **Tear-out**: group leaves the tree, becomes floating |
| any | floating window | Tabs merge into that window; source disappears |
| floating | group `center` | Tabs stack into the group |
| docked group | another group `center` | The whole group moves (tabs join the target; split collapses if it empties) |
| any | group `edge` | Split: new group beside the target on that edge |
| floating | `empty` | Creates the root group |
| any | own group / own window | No-op restore |

### Split insertion rules
`splitLeaf` keeps the tree shallow:

- If the target's **parent split already runs along the needed axis**
  (edge = left/right → row; top/bottom → column), the new group **joins that
  parent** at the right index — one divider, no nesting. The target's weight
  is halved and shared.
- Otherwise a **fresh nested split** is created around the target, with the
  new group before it (left/top) or after it (right/bottom), 50/50.
- `left`/`top` insert *before* the target; `right`/`bottom` insert *after*,
  matching visual expectations.

### Collapse rules
- Removing a leaf redistributes its weight to siblings (normalized).
- A split left with one child collapses into that child.
- A leaf left with no tabs is removed (and its ancestors collapse in turn).
The tree can therefore never accumulate empty groups through user actions.

## 4. Previews

`previewFor(target, snapshot)` turns a resolved target into the rectangle
painted by the overlay (`.rdw-overlay`, styled by `data-zone`):

- `edge` zone → the **half** of the target rect on that side (VS Code shows
  the half-split, not the whole group);
- `center` → the whole target rect;
- `empty` → an inset rectangle of the area;
- `floating` merge → the target window's rect;
- `null` → no overlay (free drop).

The dragged window additionally gets `is-snap-preview` (accent border/shadow)
whenever a dockable target is under it, so both the landing place and the
dragged object react.

## 5. What changed vs. the source system

| Aspect | Source (fixed zones) | Library (dynamic) |
| --- | --- | --- |
| Zones | 4, defined by guide elements | Unlimited — any group, any of 4 edges + stack |
| Target lookup | Overlap of the dragged rect with guides | Pointer point vs. snapshot rects (bands) |
| Zone occupancy | A drop merges into an occupied zone | A drop splits *that group*, so occupancy is always well-defined |
| Top edge | Not a zone | First-class (`top` split) |
| Empty area | Guides still present | Area acts as one big target (core → dock, edge → float) |
| Keep floating | Only by missing all guides | Deliberate ring band + Alt override |
| Zone weights | `PANEL_SIZE_FACTORS` constants | Emerge from splits; adjustable by dividers |
| Preview | Zone parent rect (portal) | Half/whole rects per band (overlay layer) |

The one behavior intentionally *not* preserved: dropping onto a fixed zone of
an occupied group silently merging two panels into it. In the dynamic model
that gesture (drop in the core) still merges — but into the group that is
actually there, and the surrounding splits keep their weights, so the rest of
the layout never jumps.
