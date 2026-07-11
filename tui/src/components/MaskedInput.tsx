import { createSignal, onMount } from "solid-js";
import { useKeyboard, usePaste } from "@opentui/solid";
import type { KeyEvent, PasteEvent, TextareaRenderable } from "@opentui/core";

const MASK_CHAR = "•";

/**
 * Imperative handle exposed via the `ref` callback prop — mirrors the
 * callback-ref pattern PromptInput.tsx uses to grab its TextareaRenderable
 * (`ref={(r) => { textareaRef = r; }}`), just one level up: the host gets a
 * small API object instead of the raw renderable.
 */
export interface MaskedInputHandle {
  getValue: () => string;
  setValue: (value: string) => void;
}

export interface MaskedInputProps {
  ref?: (handle: MaskedInputHandle) => void;
  /** Whether this field currently owns keyboard input. Defaults to true;
   * the host (a form/overlay) is responsible for toggling this so only one
   * field reacts to keystrokes at a time. */
  focused?: boolean;
  placeholder?: string;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
  textColor?: string;
  backgroundColor?: string;
  cursorColor?: string;
}

/**
 * Password-style text field: renders `•` for every character typed while
 * keeping the real string only in an internal signal. The underlying
 * textarea's buffer NEVER holds the real characters — typed or pasted — so
 * plaintext can't leak into a rendered frame, even momentarily.
 *
 * Deliberately NOT an `*Overlay.tsx`: it does not call `setOverlayActive`
 * and does not register itself as the app's global textarea
 * (`registerTextarea`), so it can't fight whatever overlay/form hosts it —
 * the host owns focus and passes it down via `focused`.
 */
export function MaskedInput(props: MaskedInputProps) {
  let textareaRef: TextareaRenderable | undefined;
  const [realValue, setRealValue] = createSignal("");

  const isFocused = () => props.focused ?? true;

  const syncMask = (value: string) => {
    textareaRef?.setText(MASK_CHAR.repeat(value.length));
    textareaRef?.gotoBufferEnd();
  };

  const applyValue = (value: string) => {
    setRealValue(value);
    syncMask(value);
    props.onChange?.(value);
  };

  const handle: MaskedInputHandle = {
    getValue: () => realValue(),
    setValue: (value: string) => applyValue(value),
  };

  onMount(() => {
    props.ref?.(handle);
  });

  useKeyboard((event: KeyEvent) => {
    if (!isFocused()) return;

    if (event.name === "return") {
      event.preventDefault();
      props.onSubmit?.(realValue());
      return;
    }

    if (event.name === "backspace" || event.name === "delete") {
      event.preventDefault();
      if (realValue().length > 0) {
        applyValue(realValue().slice(0, -1));
      }
      return;
    }

    if (event.name === "space" && !event.ctrl && !event.meta) {
      event.preventDefault();
      applyValue(realValue() + " ");
      return;
    }

    // Single printable character. `event.name` is lowercased by the parser
    // (shift+z -> name "z"), so the actual (case-preserved) character comes
    // from `sequence` — matching PromptInput/ModelListOverlay's `key.length
    // === 1` detection, but reading the value from the field that keeps case.
    if (event.name.length === 1 && !event.ctrl && !event.meta) {
      event.preventDefault();
      applyValue(realValue() + event.sequence);
      return;
    }
  });

  usePaste((event: PasteEvent) => {
    if (!isFocused()) return;
    event.preventDefault();
    const pasted = event.text.replace(/[\r\n]+/g, "");
    if (pasted) applyValue(realValue() + pasted);
  });

  return (
    <textarea
      ref={(r: TextareaRenderable) => {
        textareaRef = r;
      }}
      focused={isFocused()}
      placeholder={props.placeholder}
      textColor={props.textColor ?? "#eee8d5"}
      backgroundColor={props.backgroundColor ?? "#0f3460"}
      cursorColor={props.cursorColor ?? "#eee8d5"}
      minHeight={1}
      maxHeight={1}
      keyBindings={[]}
    />
  );
}
