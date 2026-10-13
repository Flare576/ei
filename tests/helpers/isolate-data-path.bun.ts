import { isolateDataPath } from "./isolated-data-dir.js";

// bun:test preload: one empty EI_DATA_PATH for the whole bun test process.
// See isolated-data-dir.ts for why.
const cleanup = isolateDataPath();
process.on("exit", cleanup);
