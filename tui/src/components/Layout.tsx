import { JSX } from "solid-js";

interface LayoutProps {
  sidebar: JSX.Element;
  messages: JSX.Element;
  input: JSX.Element;
}

export function Layout(props: LayoutProps) {
  return (
    <box flexDirection="row" width="100%" height="100%">
      {props.sidebar}
      <box flexDirection="column" flexGrow={1}>
        {props.messages}
        {props.input}
      </box>
    </box>
  );
}
