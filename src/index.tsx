import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";

// Configure Ink to not exit on Ctrl+C - we'll handle it ourselves
const { unmount } = render(React.createElement(App), {
  exitOnCtrlC: false
});

// Handle process termination signals
process.on('SIGINT', () => {
  // Let the App component handle Ctrl+C through useInput
  // If we get here, it means the App didn't handle it, so exit
  unmount();
  process.exit(0);
});

process.on('SIGTERM', () => {
  unmount();
  process.exit(0);
});
