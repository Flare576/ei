import { useKeyboard } from "@opentui/solid";

interface ConfirmOverlayProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmOverlay(props: ConfirmOverlayProps) {
  useKeyboard((event) => {
    event.preventDefault();
    
    const key = event.name.toLowerCase();
    
    if (key === 'y') {
      props.onConfirm();
    } else if (key === 'n' || key === 'escape') {
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
        <text> </text>
        <text fg="#586e75">
          (y/N)
        </text>
      </box>
    </box>
  );
}
