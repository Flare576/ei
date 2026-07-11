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
import { OnboardingOverlay } from "./components/OnboardingOverlay";
import { ConfirmOverlay } from "./components/ConfirmOverlay";
import { useRenderer } from "@opentui/solid";

function AppContent() {
  const { overlayRenderer, showOverlay } = useOverlay();
  const {
    showOnboarding,
    dismissOnboarding,
    isFirstBoot,
    dataPath,
    activeRoomId,
    detectedProviders,
    showUpgradePrompt,
    confirmUpgradeInstall,
    dismissUpgradePrompt,
  } = useEi();
  const renderer = useRenderer();
  createEffect(() => {
    if (showOnboarding()) {
      showOverlay((onDismiss, _hideForEditor) => (
        <OnboardingOverlay
          onDismiss={() => {
            dismissOnboarding();
            onDismiss();
          }}
          detectedProviders={detectedProviders()}
          isFirstBoot={isFirstBoot()}
          dataPath={dataPath()}
        />
      ), renderer);
    }
  });

  createEffect(() => {
    if (showUpgradePrompt()) {
      showOverlay((onDismiss, _hideForEditor) => (
        <ConfirmOverlay
          message="A new Ei harness version is available. Install the latest skills, hooks, and integrations now?"
          onConfirm={() => {
            void confirmUpgradeInstall();
            onDismiss();
          }}
          onCancel={() => {
            void dismissUpgradePrompt();
            onDismiss();
          }}
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
