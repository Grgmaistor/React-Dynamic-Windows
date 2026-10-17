import { memo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import {
  useDockActions,
  useDockLayout,
  useDockOptions,
  useDockRuntime,
} from "../context/DockContext";
import { dragSplitSizes, findSplit } from "../core/tree";
import type { SplitDirection } from "../types";

export interface DividerProps {
  splitId: string;
  /** Divider between child `index - 1` and child `index`. */
  index: number;
  direction: SplitDirection;
}

const KEY_STEP = 0.04;

/**
 * Draggable divider between two split children.
 *
 * Dragging dispatches absolute sizes derived from the snapshot taken at press
 * time, so a long drag never accumulates rounding error. Arrow keys resize by
 * `KEY_STEP` for keyboard users.
 */
export const Divider = memo(function Divider({
  splitId,
  index,
  direction,
}: DividerProps) {
  const { beginDivider } = useDockRuntime();
  const { setSplitSizes } = useDockActions();
  const { options } = useDockOptions();
  const { layout } = useDockLayout();
  const hostRef = useRef<HTMLDivElement | null>(null);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = hostRef.current?.parentElement;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const axisSize = direction === "row" ? box.width : box.height;
    beginDivider(splitId, index, axisSize, direction, event);
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const split = findSplit(layout.root, splitId);
    if (!split) return;

    const decrease =
      direction === "row" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const increase =
      direction === "row" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!decrease && !increase) return;

    event.preventDefault();
    const delta = (decrease ? -KEY_STEP : KEY_STEP) * split.sizes[index];
    setSplitSizes(
      splitId,
      dragSplitSizes(split.sizes, index, delta, options.minSplitShare),
    );
  };

  return (
    <div
      ref={hostRef}
      className="rdw-divider"
      data-direction={direction}
      role="separator"
      tabIndex={0}
      aria-orientation={direction === "row" ? "vertical" : "horizontal"}
      aria-label="Resize panels"
      onPointerDown={pointerDown}
      onKeyDown={keyDown}
    />
  );
});
