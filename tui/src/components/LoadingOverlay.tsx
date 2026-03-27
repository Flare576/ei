import { useKeyboard } from "@opentui/solid";

interface LoadingOverlayProps {
  message: string;
  onCancel?: () => void;
}

export function LoadingOverlay(props: LoadingOverlayProps) {
  useKeyboard((event) => {
    if (event.name === "escape" && props.onCancel) {
      event.preventDefault();
      props.onCancel();
    }
  });

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      left={0}
      top={0}
      backgroundColor="#000000"
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={50}
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        padding={2}
        flexDirection="column"
      >
        <text fg="#eee8d5">
          {props.message}
        </text>
        <box visible={!!props.onCancel}>
          <text> </text>
          <text fg="#586e75">Esc: cancel</text>
        </box>
      </box>
    </box>
  );
}
