import { EiProvider } from "./context/ei";
import { KeyboardProvider } from "./context/keyboard";
import { OverlayProvider, useOverlay } from "./context/overlay";
import { Layout } from "./components/Layout";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { PromptInput } from "./components/PromptInput";
import { StatusBar } from "./components/StatusBar";
import { Show } from "solid-js";

function AppContent() {
  const { overlayRenderer, hideOverlay } = useOverlay();
  
  return (
    <box flexDirection="column" width="100%" height="100%">
      <Layout
        sidebar={<Sidebar />}
        messages={<MessageList />}
        input={<PromptInput />}
      />
      <StatusBar />
      <Show when={overlayRenderer()}>
        {overlayRenderer()!(hideOverlay)}
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
