import { createEffect } from "solid-js";
import { EiProvider } from "./context/ei";
import { KeyboardProvider } from "./context/keyboard";
import { OverlayProvider, useOverlay } from "./context/overlay";
import { Layout } from "./components/Layout";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { RoomMessageList } from "./components/RoomMessageList";
import { PromptInput } from "./components/PromptInput";
import { StatusBar } from "./components/StatusBar";
import { Show } from "solid-js";
import { useEi } from "./context/ei";
import { WelcomeOverlay } from "./components/WelcomeOverlay";
import { useRenderer } from "@opentui/solid";

function AppContent() {
  const { overlayRenderer, showOverlay } = useOverlay();
  const { showWelcomeOverlay, dismissWelcomeOverlay, activeRoomId, detectedProviders, firstBootDefaultModel } = useEi();
  const renderer = useRenderer();
  createEffect(() => {
    if (showWelcomeOverlay()) {
      showOverlay((onDismiss, _hideForEditor) => (
        <WelcomeOverlay
          onDismiss={() => {
            dismissWelcomeOverlay();
            onDismiss();
          }}
          detectedProviders={detectedProviders()}
          defaultModel={firstBootDefaultModel()}
        />
      ), renderer);
    }
  });

  
  return (
    <box flexDirection="column" width="100%" height="100%">
      <Layout
        sidebar={<Sidebar />}
        messages={<Show when={activeRoomId()} fallback={<MessageList />}><RoomMessageList /></Show>}
        input={<PromptInput />}
      />
      <StatusBar />
      <Show when={overlayRenderer()}>
        {overlayRenderer()!()}
      </Show>
    </box>
  );
}

export function App() {
  return (
    <EiProvider>
      <OverlayProvider>
        <KeyboardProvider>
          <AppContent />
        </KeyboardProvider>
      </OverlayProvider>
    </EiProvider>
  );
}
