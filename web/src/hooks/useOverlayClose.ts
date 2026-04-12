import { useRef, useCallback } from "react";

/**
 * Returns props to spread on a modal overlay div that correctly handles
 * the text-selection drag-out-of-modal case.
 *
 * Problem: onClick fires on mouseup. If the user starts a click/drag inside
 * the modal content and releases outside (e.g. dragging to select text in an
 * input), the mouseup lands on the overlay and triggers close — even though
 * the interaction started inside the modal.
 *
 * Fix: record whether mousedown started on the overlay itself. Only close on
 * click if that mousedown also started on the overlay.
 *
 * Usage:
 *   const overlayProps = useOverlayClose(onClose);
 *   <div className="ei-modal-overlay" {...overlayProps}>
 *     <div onClick={e => e.stopPropagation()}>...modal content...</div>
 *   </div>
 */
export function useOverlayClose(onClose: () => void) {
  const mouseDownOnOverlay = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    mouseDownOnOverlay.current = e.target === e.currentTarget;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && mouseDownOnOverlay.current) {
      onClose();
    }
    mouseDownOnOverlay.current = false;
  }, [onClose]);

  return { onMouseDown: handleMouseDown, onClick: handleClick };
}
