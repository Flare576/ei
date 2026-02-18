import { useState, useEffect, useRef, useCallback } from "react";

export interface HamburgerMenuProps {
  onMyDataClick: () => void;
  onSettingsClick: () => void;
  onHelpClick: () => void;
  onSyncAndExit?: () => void;
}

export function HamburgerMenu({
  onMyDataClick,
  onSettingsClick,
  onHelpClick,
  onSyncAndExit,
}: HamburgerMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleMenuItemClick = useCallback((action: () => void) => {
    action();
    handleClose();
  }, [handleClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        buttonRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, handleClose]);

  return (
    <div className="ei-hamburger-menu">
      <button
        ref={buttonRef}
        className="ei-btn ei-btn--icon ei-hamburger-menu__toggle"
        onClick={handleToggle}
        title="Menu"
        aria-label="Menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        ☰
      </button>

      {isOpen && (
        <div ref={menuRef} className="ei-hamburger-menu__dropdown" role="menu">
          <button
            className="ei-hamburger-menu__item"
            onClick={() => handleMenuItemClick(onMyDataClick)}
            role="menuitem"
          >
            <span className="ei-hamburger-menu__icon">📊</span>
            <span>My Data</span>
          </button>

          <button
            className="ei-hamburger-menu__item"
            onClick={() => handleMenuItemClick(onSettingsClick)}
            role="menuitem"
          >
            <span className="ei-hamburger-menu__icon">⚙️</span>
            <span>Settings</span>
          </button>

          <button
            className="ei-hamburger-menu__item"
            onClick={() => handleMenuItemClick(onHelpClick)}
            role="menuitem"
          >
            <span className="ei-hamburger-menu__icon">?</span>
            <span>Help</span>
          </button>

          {onSyncAndExit && (
            <>
              <div className="ei-hamburger-menu__divider" />
              <button
                className="ei-hamburger-menu__item"
                onClick={() => handleMenuItemClick(onSyncAndExit)}
                role="menuitem"
              >
                <span className="ei-hamburger-menu__icon">🚪</span>
                <span>Sync & Exit</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
