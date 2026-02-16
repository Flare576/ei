import {
  createContext,
  useContext,
  createSignal,
  type ParentComponent,
  type JSX,
  type Accessor,
} from "solid-js";
import { logger } from "../util/logger";

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
    logger.debug("[overlay] showOverlay called");
    setOverlayRenderer(() => renderer);
  };

  const hideOverlay = () => {
    logger.debug("[overlay] hideOverlay called");
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
