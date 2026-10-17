import { useCallback, useMemo, useRef, useState } from "react";

import {
  DockArea,
  DockProvider,
  collectLeaves,
  loadLayout,
  useDock,
  type DockLayout,
  type DockTab,
} from "../src";

/* --------------------------------------------------------------- demo data */

const COLORS = ["#4f9cff", "#7bd88f", "#f0c674", "#e88fd0", "#8fd3ff", "#ff9e64"];

interface DemoViewProps {
  tab: DockTab;
}

/** Body content for one tab: a small editable-looking placeholder. */
function DemoView({ tab }: DemoViewProps) {
  const hue = useMemo(() => {
    let sum = 0;
    for (const char of tab.id) sum += char.charCodeAt(0);
    return COLORS[sum % COLORS.length];
  }, [tab.id]);

  return (
    <div className="demo-view" style={{ borderColor: hue }}>
      <span className="demo-view-badge" style={{ background: hue }}>
        {tab.title}
      </span>
      <p>
        Drag this window by its header, pull its tab out to tear it into a
        floating window, or drop it onto the edge of another group to split the
        dock.
      </p>
      <p className="demo-view-meta">
        tab id: <code>{tab.id}</code>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- app */

const STORAGE_KEY = "rdw-demo-layout";

const initialTabs: DockTab[] = [
  { id: "explorer", title: "Explorer" },
  { id: "search", title: "Search" },
  { id: "source-control", title: "Source Control" },
  { id: "editor-1", title: "App.tsx" },
  { id: "editor-2", title: "types.ts" },
  { id: "terminal", title: "Terminal" },
  { id: "problems", title: "Problems" },
  { id: "output", title: "Output" },
];

const initialLayout = (): DockLayout => ({
  root: {
    kind: "split",
    id: "root-split",
    direction: "row",
    sizes: [0.25, 0.75],
    children: [
      {
        kind: "leaf",
        id: "sidebar",
        tabs: initialTabs.slice(0, 3),
        activeTabId: "source-control",
        state: "open",
      },
      {
        kind: "split",
        id: "main-split",
        direction: "column",
        sizes: [0.7, 0.3],
        children: [
          {
            kind: "leaf",
            id: "editors",
            tabs: initialTabs.slice(3, 5),
            activeTabId: "editor-2",
            state: "open",
          },
          {
            kind: "leaf",
            id: "bottom",
            tabs: initialTabs.slice(5),
            activeTabId: "output",
            state: "open",
          },
        ],
      },
    ],
  },
  floating: [],
});

/** Toolbar + dock surface. Lives inside the provider so it can use `useDock`. */
function DemoSurface({ tabPool }: { tabPool: DockTab[] }) {
  const { open, openFloating, serialize, getLayout, setLayout, layout } = useDock();
  const [status, setStatus] = useState("Ready.");
  const nextTab = useRef(6);

  const dockedCount = useMemo(
    () => collectLeaves(layout.root).reduce((sum, leaf) => sum + leaf.tabs.length, 0),
    [layout.root],
  );
  const floatingCount = layout.floating.reduce(
    (sum, window) => sum + window.tabs.length,
    0,
  );

  const openDocked = () => {
    const tab = tabPool[nextTab.current % tabPool.length];
    nextTab.current += 1;
    open({ ...tab, id: `${tab.id}-${nextTab.current}` });
    setStatus(`Opened "${tab.title}" in the focused group.`);
  };

  const openFloat = () => {
    const tab = tabPool[nextTab.current % tabPool.length];
    nextTab.current += 1;
    openFloating({ ...tab, id: `${tab.id}-${nextTab.current}` });
    setStatus(`Opened "${tab.title}" as a floating window.`);
  };

  const save = () => {
    localStorage.setItem(STORAGE_KEY, serialize());
    setStatus("Layout saved to localStorage.");
  };

  const restore = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const restored = raw ? loadLayout(raw) : null;
    if (restored) {
      setLayout(restored);
      setStatus("Layout restored from localStorage.");
    } else {
      setStatus("Nothing saved yet — press Save first.");
    }
  };

  const reset = () => {
    setLayout(initialLayout());
    setStatus("Layout reset to the default demo.");
  };

  const dump = () => {
    console.log(JSON.stringify(getLayout(), null, 2));
    setStatus("Current layout printed to the devtools console.");
  };

  return (
    <div className="demo-shell">
      <header className="demo-toolbar">
        <span className="demo-brand">react-dock-window</span>
        <div className="demo-actions">
          <button type="button" onClick={openDocked}>
            + Docked tab
          </button>
          <button type="button" onClick={openFloat}>
            + Floating window
          </button>
          <button type="button" onClick={save}>
            Save
          </button>
          <button type="button" onClick={restore}>
            Restore
          </button>
          <button type="button" onClick={reset}>
            Reset
          </button>
          <button type="button" onClick={dump}>
            Log layout
          </button>
        </div>
        <span className="demo-stats">
          {dockedCount} docked · {floatingCount} floating
        </span>
      </header>

      <DockArea
        className="demo-dock"
        renderView={(tab) => <DemoView tab={tab} />}
        empty={<p className="demo-empty">Drop a window here to start docking.</p>}
      />

      <footer className="demo-status">{status}</footer>
    </div>
  );
}

export function App() {
  const [options] = useState(() => ({ padding: 12 }));

  const initial = useMemo(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (raw ? loadLayout(raw) : null) ?? initialLayout();
  }, []);

  const handleLayoutChange = useCallback((layout: DockLayout) => {
    // Host apps typically persist here; the demo only keeps the latest value
    // in memory (Save writes it to localStorage explicitly).
    void layout;
  }, []);

  return (
    <DockProvider initialLayout={initial} options={options} onLayoutChange={handleLayoutChange}>
      <DemoSurface tabPool={initialTabs} />
    </DockProvider>
  );
}
