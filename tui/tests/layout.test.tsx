import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import { Layout } from "../src/components/Layout";
import { Sidebar } from "../src/components/Sidebar";
import { MessageList } from "../src/components/MessageList";
import { PromptInput } from "../src/components/PromptInput";

test("Layout renders 3-panel structure", async () => {
  const { captureCharFrame } = await testRender(() => (
    <Layout
      sidebar={<Sidebar />}
      messages={<MessageList />}
      input={<PromptInput />}
    />
  ), { width: 80, height: 24 });

  const output = captureCharFrame();
  expect(output).toBeDefined();
  expect(output.length).toBeGreaterThan(0);
});

test("Sidebar renders with placeholder text", async () => {
  const { captureCharFrame } = await testRender(() => <Sidebar />, { width: 80, height: 24 });
  
  const output = captureCharFrame();
  expect(output).toContain("[Sidebar]");
});

test("MessageList renders with placeholder text", async () => {
  const { captureCharFrame } = await testRender(() => <MessageList />, { width: 80, height: 24 });
  
  const output = captureCharFrame();
  expect(output).toContain("[Messages]");
});

test("PromptInput renders with placeholder text", async () => {
  const { captureCharFrame } = await testRender(() => <PromptInput />, { width: 80, height: 24 });
  
  const output = captureCharFrame();
  expect(output).toContain("[Input]");
});
