import { useEffect, useId, useRef } from "react";
import type { Message, ToolCallRecord } from "../../../../src/core/types";
import { useOverlayClose } from "../../hooks/useOverlayClose";

interface ToolCallsModalProps {
  message: Message | null;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function formatArgumentValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

function ToolCall({ call }: { call: ToolCallRecord }) {
  // A provider can return the JSON `null` (or omit the field), and it is persisted as-is.
  const args = call.arguments ?? {};
  const argumentNames = Object.keys(args);
  const action = args.action;
  const noArguments =
    call.arguments === null ? "(none: arguments were null)"
    : call.arguments === undefined ? "(none: arguments were absent)"
    : "(none)";

  return (
    <li className="ei-tool-call">
      <h3 className="ei-tool-call__name">{call.name}</h3>
      {typeof action === "string" && (
        <div className="ei-tool-call__action">{`action: ${action}`}</div>
      )}
      <div className="ei-tool-call__label">Arguments</div>
      {argumentNames.length === 0 ? (
        <div className="ei-tool-call__empty">{noArguments}</div>
      ) : (
        <dl className="ei-tool-call__arguments">
          {argumentNames.map((argumentName) => (
            <div key={argumentName} className="ei-tool-call__argument">
              <dt>{argumentName}</dt>
              <dd>
                <pre>{formatArgumentValue(args[argumentName])}</pre>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="ei-tool-call__label">Result</div>
      <pre className="ei-tool-call__result">{call.result}</pre>
      <div className="ei-tool-call__error">{`error: ${call.error}`}</div>
    </li>
  );
}

export function ToolCallsModal({ message, onClose }: ToolCallsModalProps) {
  const isOpen = message !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const overlayProps = useOverlayClose(onClose);

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [isOpen]);

  if (!message) return null;
  const toolCalls = message.tool_calls ?? [];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Escape is consumed here so the app-wide Escape shortcut (queue pause/resume
    // and abort) never sees a keypress that was only meant to close this dialog.
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;

    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (!focusable?.length) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && (e.target === first || e.target === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && e.target === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="ei-modal-overlay ei-tool-calls-overlay" {...overlayProps}>
      <div
        className="ei-tool-calls-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={handleKeyDown}
      >
        <div className="ei-tool-calls-modal__header">
          <h2 id={titleId} className="ei-tool-calls-modal__title">
            {`Tool calls (${toolCalls.length})`}
          </h2>
          <button
            type="button"
            className="ei-tool-calls-modal__close"
            onClick={onClose}
            aria-label="Close tool calls"
          >
            ✕
          </button>
        </div>
        <ol className="ei-tool-calls-modal__list">
          {toolCalls.map((call, index) => (
            <ToolCall key={index} call={call} />
          ))}
        </ol>
      </div>
    </div>
  );
}
