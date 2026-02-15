import { JSX, Show } from "solid-js";
import { useKeyboardNav } from "../context/keyboard";

interface LayoutProps {
  sidebar: JSX.Element;
  messages: JSX.Element;
  input: JSX.Element;
}

export function Layout(props: LayoutProps) {
  const { sidebarVisible } = useKeyboardNav();

  return (
    <box flexDirection="row" width="100%" height="100%">
      <Show when={sidebarVisible()}>
        {props.sidebar}
      </Show>
      <box flexDirection="column" flexGrow={1}>
        {props.messages}
        {props.input}
      </box>
    </box>
  );
}
