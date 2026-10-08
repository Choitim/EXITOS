#!/usr/bin/env node
import { runMain } from './main.js';

runMain(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // runMain never rejects in practice; this is a last-resort guard that still avoids printing secrets.
    process.stderr.write(`Fatal: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  },
);
