import { memo, type PointerEvent as ReactPointerEvent } from "react";

import { useDockActions, useDockOptions, useDockRuntime } from "../context/DockContext";
import type { DockTab } from "../types";

export interface TabStripProps {
  /** Group whose tabs are shown; also the id the window chrome registers. */
  containerId: string;
  tabs: DockTab[];
  activeTabId: string | null;
}

/**
 * Tab bar of one window group.
 *
 * Pressing a tab activates it immediately (hand drift must never be mistaken
 * for a pull-out); dragging it further than `tabPullThreshold` tears it into
 * its own floating window, which keeps following the pointer.
 */
export const TabStrip = memo(function TabStrip({
  containerId,
  tabs,
  activeTabId,
}: TabStripProps) {
  const { close } = useDockActions();
  const { options } = useDockOptions();
  const { beginTabPress } = useDockRuntime();

  const press = (event: ReactPointerEvent, tabId: string) => {
    beginTabPress(containerId, tabId, event);
  };

  return (
    <div className="rdw-tabs" role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`rdw-tab${active ? " is-active" : ""}`}
            role="tab"
            aria-selected={active}
            title={tab.title}
            onPointerDown={(event) => press(event, tab.id)}
          >
            {tab.icon ? <span className="rdw-tab-icon">{tab.icon}</span> : null}
            <span className="rdw-tab-title">{tab.title}</span>
            {tab.closable !== false && tabs.length > 0 ? (
              <button
                type="button"
                className="rdw-tab-close"
                aria-label={`${options.labels.close} ${tab.title}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => close(tab.id)}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});
