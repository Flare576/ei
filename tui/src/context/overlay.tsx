import {
  createContext,
  useContext,
  createSignal,
  type ParentComponent,
  type JSX,
  type Accessor,
} from "solid-js";

// Overlay render function - called within reactive context to create JSX
export type OverlayRenderer = (hideOverlay: () => void) => JSX.Element;

interface OverlayContextValue {
  overlayRenderer: Accessor<OverlayRenderer | null>;
  showOverlay: (renderer: OverlayRenderer) => void;
  hideOverlay: () => void;
}

const OverlayContext = createContext<OverlayContextValue>();

export const OverlayProvider: ParentComponent = (props) => {
  const [overlayRenderer, setOverlayRenderer] = createSignal<OverlayRenderer | null>(null);

  const showOverlay = (renderer: OverlayRenderer) => {
    setOverlayRenderer(() => renderer);
  };

  const hideOverlay = () => {
    setOverlayRenderer(null);
  };

  const value: OverlayContextValue = {
    overlayRenderer,
    showOverlay,
    hideOverlay,
  };

  return (
    <OverlayContext.Provider value={value}>
      {props.children}
    </OverlayContext.Provider>
  );
};

export const useOverlay = () => {
  const ctx = useContext(OverlayContext);
  if (!ctx) {
    throw new Error("useOverlay must be used within OverlayProvider");
  }
  return ctx;
};
