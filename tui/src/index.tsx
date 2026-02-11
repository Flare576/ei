import { render } from "@opentui/solid";
import { App } from "./app";

render(App, {
  exitOnCtrlC: false,
  targetFps: 30,
});
