import { render, Box, Text } from "@opentui/solid";

const App = () => {
  return (
    <Box>
      <Text>Hello TUI</Text>
    </Box>
  );
};

render(App, { exitOnCtrlC: true });
