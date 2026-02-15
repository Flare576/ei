import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { Layout } from "../src/components/Layout";
import { Sidebar } from "../src/components/Sidebar";
import { MessageList } from "../src/components/MessageList";
import { PromptInput } from "../src/components/PromptInput";
import { EiProvider } from "../src/context/ei";
import { KeyboardProvider } from "../src/context/keyboard";
import { OverlayProvider } from "../src/context/overlay";
import type { ParentComponent } from "solid-js";

const TestProviders: ParentComponent = (props) => (
  <EiProvider>
    <OverlayProvider>
      <KeyboardProvider>
        {props.children}
      </KeyboardProvider>
    </OverlayProvider>
  </EiProvider>
);

test("Layout renders without error", async () => {
  const { captureCharFrame } = await testRender(() => (
    <TestProviders>
      <Layout
        sidebar={<Sidebar />}
        messages={<MessageList />}
        input={<PromptInput />}
      />
    </TestProviders>
  ), { width: 80, height: 24 });

  const output = captureCharFrame();
  expect(output).toBeDefined();
  expect(output.length).toBeGreaterThan(0);
});

test("Sidebar renders without error", async () => {
  const { captureCharFrame } = await testRender(() => (
    <TestProviders>
      <Sidebar />
    </TestProviders>
  ), { width: 80, height: 24 });
  
  const output = captureCharFrame();
  expect(output).toBeDefined();
  expect(output.length).toBeGreaterThan(0);
});

test("MessageList renders without error", async () => {
  const { captureCharFrame } = await testRender(() => (
    <TestProviders>
      <MessageList />
    </TestProviders>
  ), { width: 80, height: 24 });
  
  const output = captureCharFrame();
  expect(output).toBeDefined();
  expect(output.length).toBeGreaterThan(0);
});

test("PromptInput renders without error", async () => {
  const { captureCharFrame } = await testRender(() => (
    <TestProviders>
      <PromptInput />
    </TestProviders>
  ), { width: 80, height: 24 });
  
  const output = captureCharFrame();
  expect(output).toBeDefined();
  expect(output.length).toBeGreaterThan(0);
});
