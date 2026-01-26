#!/usr/bin/env node

import { EIApp } from "./blessed/app.js";

// Start the Blessed-based application
const app = new EIApp();
app.init().catch((error) => {
  console.error('Failed to initialize EI application:', error);
  process.exit(1);
});
