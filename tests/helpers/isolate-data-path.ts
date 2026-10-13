import { afterAll } from "vitest";
import { isolateDataPath } from "./isolated-data-dir.js";

// Vitest setup file: every test file gets its own empty EI_DATA_PATH.
// See isolated-data-dir.ts for why.
afterAll(isolateDataPath());
