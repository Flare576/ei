import { useRef, useEffect, type ReactNode } from "react";

interface TabConfig {
  id: string;
  label: string;
  icon?: string;
}

interface TabContainerProps {
  title: string;
  tabs: TabConfig[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onClose: () => void;
  isDirty?: boolean;
  children: ReactNode;
}

export function TabContainer({
  title,
  tabs,
  activeTab,
  onTabChange,
  onClose,
  isDirty = false,
  children
}: TabContainerProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  const handleClose = () => {
    if (isDirty) {
      if (!confirm("You have unsaved changes. Close anyway?")) {
        return;
      }
    }
    onClose();
  };

  // Focus management - save and restore focus
  useEffect(() => {
    previousActiveElement.current = document.activeElement;
    modalRef.current?.focus();
    
    return () => {
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    };
  }, []);

  // Keyboard handling: Escape to close, Tab for focus trap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
        return;
      }
      
      // Focus trap
      if (e.key === "Tab") {
        const focusableElements = modalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements?.length) return;
        
        const first = focusableElements[0] as HTMLElement;
        const last = focusableElements[focusableElements.length - 1] as HTMLElement;
        
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, onClose]);

  return (
    <div className="ei-modal-overlay" onClick={handleClose}>
      <div 
        className="ei-tab-container"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tab-container-title"
      >
        <div className="ei-tab-container__header">
          <h2 id="tab-container-title" className="ei-tab-container__title">{title}</h2>
          <button 
            className="ei-btn ei-btn--icon"
            onClick={handleClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="ei-tab-container__tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`ei-tab-container__tab ${activeTab === tab.id ? 'ei-tab-container__tab--active' : ''}`}
              onClick={() => onTabChange(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`tabpanel-${tab.id}`}
            >
              {tab.icon && <span className="ei-tab-container__tab-icon">{tab.icon}</span>}
              {tab.label}
            </button>
          ))}
        </div>

        <div 
          className="ei-tab-container__content"
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
