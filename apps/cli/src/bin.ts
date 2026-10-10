#!/usr/bin/env node
import { isSupportedNode, unsupportedNodeMessage } from './runtime/node-version.js';

// Check the runtime first. Only afterwards is the rest of the program loaded, so an old Node gets a
// message it can act on rather than a syntax error or "No such built-in module: node:sqlite".
if (!isSupportedNode(process.versions.node)) {
  process.stderr.write(`${unsupportedNodeMessage(process.versions.node, process.platform)}\n`);
  process.exitCode = 2;
} else {
  const { runMain } = await import('./main.js');
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
}
