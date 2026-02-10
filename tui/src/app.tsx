import { EiProvider } from "./context/ei";
import { KeyboardProvider } from "./context/keyboard";
import { Layout } from "./components/Layout";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { PromptInput } from "./components/PromptInput";
import { StatusBar } from "./components/StatusBar";

export function App() {
  return (
    <EiProvider>
      <KeyboardProvider>
        <box flexDirection="column" width="100%" height="100%">
          <Layout
            sidebar={<Sidebar />}
            messages={<MessageList />}
            input={<PromptInput />}
          />
          <StatusBar />
        </box>
      </KeyboardProvider>
    </EiProvider>
  );
}
