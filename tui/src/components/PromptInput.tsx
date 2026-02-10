import { createSignal, Show } from "solid-js";
import { useEi } from "../context/ei";

export function PromptInput() {
  const { sendMessage, activePersona, queueStatus } = useEi();
  const [inputValue, setInputValue] = createSignal("");

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !activePersona()) return;
    
    sendMessage(trimmed);
    setInputValue("");
  };

  const getPlaceholder = () => {
    if (!activePersona()) return "Select a persona...";
    return "Type your message here...";
  };

  const getStatusText = () => {
    const status = queueStatus();
    if (status.state === "busy") {
      return `⏳ Processing (${status.pending_count} pending)`;
    }
    if (status.state === "paused") {
      return "⏸ Paused";
    }
    return "";
  };

  return (
    <box 
      height={4} 
      border={["top"]}
      borderStyle="single" 
      backgroundColor="#0f3460"
      flexDirection="column"
    >
      <box paddingLeft={1} paddingRight={1} paddingTop={0.5} height={1}>
        <input
          focused={true}
          value={inputValue()}
          onInput={(val) => setInputValue(val)}
          onSubmit={handleSubmit as any}
          placeholder={getPlaceholder()}
          textColor="#eee8d5"
          backgroundColor="#0f3460"
          width="100%"
        />
      </box>
      
      <Show when={getStatusText()}>
        <box paddingLeft={1} paddingRight={1} height={1}>
          <text fg="#b58900">
            {getStatusText()}
          </text>
        </box>
      </Show>
    </box>
  );
}
