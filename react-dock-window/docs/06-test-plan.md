# 06 — Test plan

Vitest, two layers: pure-function suites for the `core/` modules (node
environment) and a DOM regression suite for the pointer pipeline
(happy-dom). Run with `npm test`.

```
tests/
├── rect.test.ts        Geometry primitives
├── tree.test.ts        Dock tree traversal and edits
├── drop.test.ts        Band resolution, previews, applying drops
├── reducer.test.ts     Every dockReducer action
├── serialize.test.ts   JSON round-trip and hostile input
└── drag.test.tsx       DOM: drag settle, tear-out, docking (happy-dom)
```

**122 tests, all green** as of the initial release.

## 1. Strategy

- **Purity first.** Everything a drag can do is a pure function of
  `(state, input)`; the DOM suite only exercises the *wiring* (thresholds,
  session lifetime, style writes, dispatch). When a DOM test fails, the bug
  is almost always in `DockContext`, never in the model.
- **No-op identity as a feature.** Many tests assert `result === input`
  (same reference) for no-op interactions — that is what prevents pointless
  re-renders, so it is treated as behavior, not implementation detail.
- **Regression parity.** The drag suite ports the source project's
  `windowDrag.test.tsx` regressions (lost pointerup, tab-pull hand-off,
  released press) so the known failure modes stay fixed.

## 2. Coverage by module

### `rect.test.ts` (14 tests)
`normalizeRect` clamping (outside area, min size, oversized);
`displayRect` per state (open passthrough, maximized fills area, minimized
collapses to header) and the invariant that **the model rect is never
mutated**; `resizeRect` per edge/corner, min-size clamp, area clamp;
`pointInRect`/`rectsEqual`; cascaded `createDefaultRect`.

### `tree.test.ts` (22 tests)
`collectLeaves` reading order, `findLeaf`/`findLeafOfTab`;
`splitLeaf` — nested split on axis change, joining a same-axis parent with
correct weight halving, before/after insertion per zone, missing target
no-op; `removeLeaf` — collapse with weight redistribution, whole-tree
removal; tab ops — activate-by-reappend, append, no-op identity;
`dragSplitSizes` — pair-local movement, minimum-share clamp, invalid
indexes; `normalizeSizes`; `setSplitSizes` tree update + bail-outs;
`findParentSplit`.

### `drop.test.ts` (35 tests)
`bandOf` — every edge band, core, ring, out-of-rect ring, normalized
distances on non-square rects, edge/core clamp when options overlap.
`resolveDropTarget` — outside-area null, edge→split, core→stack, ring→free,
floating-precedence, never-target-self, self→center (no-op restore), empty
layout core→`empty` / edge→free, floating merge with empty layout.
`previewFor` — whole/half/inset/floating rects and the null case.
`applyDrop` — floating settle with clamping, docked tear-out, float→float
merge, float→group stack, group→group move with split collapse, edge split
with id suffix, self no-op (identity), empty-layout root creation, unknown
source no-op.

### `reducer.test.ts` (30 tests)
`open-tab` — root creation, stack into focus, stale-focus fallback,
open-floating via rect+metrics, explicit edge target split. `close-tab` —
tab removal, active-tab fallback, group removal with collapse, floating
window removal, **focus cleared when the focused container disappears**
(this suite caught a real focus-staleness bug during development).
`activate-tab` leaf/floating/unknown. `set-window-state` round-trips, rect
invariance on minimize. `raise` — order and identity. `float-tab` — tear-out
and only-tab removal. `set-rect` — normalize + reopen minimized, no-op
identity. `set-split-sizes` update/bail. `set-layout`/`reflow`.
`drop` focus selection. Id uniqueness across opens.

### `serialize.test.ts` (16 tests)
Round-trip of nested splits with per-window states; tab `data`/`closable`
payloads; non-JSON and wrong-version rejection; hostile input — duplicate
window ids, duplicate tab ids, empty groups, all-empty splits, stale
`activeTabId`, malformed floating rects, un-normalized sizes, unknown
window states. Invariant: **invalid input degrades, never throws**.

### `drag.test.tsx` (13 tests, happy-dom)
Geometry stubbed via `getBoundingClientRect` override + a re-triggered area
measure, so provider metrics are real. Covers:
- header drag follows via direct style writes, self-drop restores (ghost
  styles reverted, no layout change), overlay zone correct;
- sub-threshold press is a click (no drag starts);
- drag out of the area tears the group into a floating window (split
  collapses, tabs carried, rect clamped);
- **lost pointerup** — next buttonless move settles instead of following,
  later moves ignored;
- double-click maximize/restore; control buttons minimize/restore/close;
- tab pull — tear-out mid-session, window follows while held, settle as
  floating; press-without-travel only activates; **lost pointerup cannot
  turn a released press into a pull**;
- floating→group core drop stacks tabs (with overlay assertion);
- Alt+release keeps the window floating over a dockable group;
- edge drop previews and applies a split.

## 3. Gaps / future work

- **Keyboard accessibility** — dividers are focusable but there are no
  keyboard move/dock gestures yet; plan: ARIA arrow-key resizing on dividers
  and a "move tab to group" menu.
- **Multi-pointer (touch)** — sessions assume a single primary pointer.
- **Virtualized bodies** — large `renderView` trees are the host's concern;
  a recipe (keep-alive per tab id) belongs in the docs.
- **Visual regression** — overlay geometry is asserted via `data-zone` and
  styles; screenshot tests would catch CSS drift.
- **Bundle-level test** — `dist` output is built in CI but not yet
  smoke-imported by a consumer project.
