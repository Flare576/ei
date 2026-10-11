// jsdom has no layout engine, so the virtualized chat list renders zero rows (or throws on
// the missing ResizeObserver) unless the browser APIs it measures with are stubbed. These
// stubs give every element an 800x600 box and make ResizeObserver report that size as soon
// as an element is observed.
import { vi } from "vitest";

const WIDTH = 800;
const HEIGHT = 600;

function boxRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: WIDTH,
    bottom: HEIGHT,
    width: WIDTH,
    height: HEIGHT,
    toJSON: () => ({}),
  };
}

export function installVirtualListStubs(): () => void {
  class StubResizeObserver implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const size: ResizeObserverSize = { inlineSize: WIDTH, blockSize: HEIGHT };
      const entry: ResizeObserverEntry = {
        target,
        contentRect: boxRect(),
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
      };
      this.callback([entry], this);
    }
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal("ResizeObserver", StubResizeObserver);

  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => HEIGHT });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => WIDTH });
  Element.prototype.getBoundingClientRect = boxRect;

  return () => {
    vi.unstubAllGlobals();
    if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  };
}
