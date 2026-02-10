import {
  createContext,
  useContext,
  createSignal,
  type ParentComponent,
  type Accessor,
} from "solid-js";

export type Panel = "sidebar" | "messages" | "input";

interface KeyboardContextValue {
  focusedPanel: Accessor<Panel>;
  setFocusedPanel: (panel: Panel) => void;
}

const KeyboardContext = createContext<KeyboardContextValue>();

export const KeyboardProvider: ParentComponent = (props) => {
  const [focusedPanel, setFocusedPanel] = createSignal<Panel>("input");

  const value: KeyboardContextValue = {
    focusedPanel,
    setFocusedPanel,
  };

  return (
    <KeyboardContext.Provider value={value}>
      {props.children}
    </KeyboardContext.Provider>
  );
};

export const useKeyboardNav = () => {
  const ctx = useContext(KeyboardContext);
  if (!ctx) {
    throw new Error("useKeyboardNav must be used within KeyboardProvider");
  }
  return ctx;
};
