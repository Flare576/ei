import {
  createContext,
  useContext,
  createSignal,
  type ParentComponent,
  type JSX,
  type Accessor,
} from "solid-js";
import { type CliRenderer } from "@opentui/core";
import { logger } from "../util/logger";

export type OverlayRenderer = (hideOverlay: () => void, hideForEditor: () => void) => JSX.Element;

interface OverlayContextValue {
  overlayRenderer: Accessor<(() => JSX.Element) | null>;
  showOverlay: (renderer: OverlayRenderer, cliRenderer?: CliRenderer) => void;
  hideOverlay: () => void;
}

const OverlayContext = createContext<OverlayContextValue>();

export const OverlayProvider: ParentComponent = (props) => {
  const [overlayRenderer, setOverlayRenderer] = createSignal<(() => JSX.Element) | null>(null);

  const showOverlay = (renderer: OverlayRenderer, cliRenderer?: CliRenderer) => {
    logger.debug("[overlay] showOverlay called");
    const hideForEditor = () => {
      if (cliRenderer) {
        cliRenderer.currentRenderBuffer.clear();
      }
      setOverlayRenderer(null);
    };
    const hideOverlay = () => {
      logger.debug("[overlay] hideOverlay called");
      setOverlayRenderer(null);
      cliRenderer?.requestRender();
    };
    setOverlayRenderer(() => () => renderer(hideOverlay, hideForEditor));
    queueMicrotask(() => cliRenderer?.requestRender());
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
