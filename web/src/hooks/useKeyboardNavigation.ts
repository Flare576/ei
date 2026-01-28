import { useEffect, useCallback, useRef } from "react";

interface KeyboardNavigationProps {
  onFocusPersonaPanel: () => void;
  onFocusInput: () => void;
  onScrollChat: (direction: "up" | "down") => void;
}

export function useKeyboardNavigation({
  onFocusPersonaPanel,
  onFocusInput,
  onScrollChat,
}: KeyboardNavigationProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      onFocusPersonaPanel();
    }
    
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      onFocusInput();
    }
    
    if (e.key === "PageUp") {
      e.preventDefault();
      onScrollChat("up");
    }
    
    if (e.key === "PageDown") {
      e.preventDefault();
      onScrollChat("down");
    }
  }, [onFocusPersonaPanel, onFocusInput, onScrollChat]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

export function usePersonaPanelNavigation(
  personas: { name: string }[],
  activePersona: string | null,
  onSelectPersona: (name: string) => void,
  onFocusInput: () => void
) {
  const focusedIndex = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusedIndex.current = Math.min(focusedIndex.current + 1, personas.length - 1);
      focusPill(focusedIndex.current);
    }
    
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusedIndex.current = Math.max(focusedIndex.current - 1, 0);
      focusPill(focusedIndex.current);
    }
    
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const persona = personas[focusedIndex.current];
      if (persona) {
        onSelectPersona(persona.name);
        onFocusInput();
      }
    }
  }, [personas, onSelectPersona, onFocusInput]);

  const focusPill = (index: number) => {
    const pills = containerRef.current?.querySelectorAll(".ei-persona-pill");
    const pill = pills?.[index] as HTMLElement | undefined;
    pill?.focus();
  };

  const focusPanel = useCallback(() => {
    const currentIndex = personas.findIndex(p => p.name === activePersona);
    focusedIndex.current = currentIndex >= 0 ? currentIndex : 0;
    focusPill(focusedIndex.current);
  }, [personas, activePersona]);

  return { containerRef, handleKeyDown, focusPanel };
}
