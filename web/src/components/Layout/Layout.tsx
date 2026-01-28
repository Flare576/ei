import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";

interface LayoutProps {
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  controlArea: ReactNode;
}

const STORAGE_KEY = "ei_layout_state";
const DEFAULT_LEFT_WIDTH = 280;
const MIN_LEFT_WIDTH = 200;
const MAX_LEFT_WIDTH = 400;

interface LayoutState {
  leftPanelWidth: number;
}

function loadLayoutState(): LayoutState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
  }
  return { leftPanelWidth: DEFAULT_LEFT_WIDTH };
}

function saveLayoutState(state: LayoutState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
  }
}

export function Layout({ leftPanel, centerPanel, controlArea }: LayoutProps) {
  const [leftWidth, setLeftWidth] = useState(() => loadLayoutState().leftPanelWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dividerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !layoutRef.current) return;
    
    const layoutRect = layoutRef.current.getBoundingClientRect();
    const newWidth = e.clientX - layoutRect.left;
    const clampedWidth = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, newWidth));
    
    setLeftWidth(clampedWidth);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      saveLayoutState({ leftPanelWidth: leftWidth });
    }
  }, [isDragging, leftWidth]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className="ei-app">
      <div className="ei-layout" ref={layoutRef}>
        <div 
          className="ei-panel-left" 
          style={{ width: `${leftWidth}px` }}
        >
          {controlArea}
          {leftPanel}
        </div>
        
        <div 
          ref={dividerRef}
          className={`ei-divider ${isDragging ? "dragging" : ""}`}
          onMouseDown={handleMouseDown}
        />
        
        <div className="ei-panel-center">
          {centerPanel}
        </div>
      </div>
    </div>
  );
}
