#!/usr/bin/env node
// Proves the mobile design-system preview (Sprint 12c) is left out of production bundles.
//
//   node scripts/check-mobile-preview-excluded.mjs apps/mobile/dist apps/mobile/dist-js
//       fails (exit 1) if any file contains the preview's marker
//   node scripts/check-mobile-preview-excluded.mjs --expect-present apps/mobile/dist-web
//       positive control on a development export: fails if the marker is NOT found,
//       so a renamed marker cannot make the check above pass silently
//
// The marker is read from the preview's source, so the two cannot drift apart. Binary
// bundles (Hermes bytecode) are searched byte for byte; the marker is plain ASCII.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(join(repoRoot, "apps/mobile/src/dev/design-system-preview.tsx"), "utf8");
const match = /DESIGN_SYSTEM_PREVIEW_MARKER = "([^"]+)"/.exec(source);
if (!match) {
  console.error("check-mobile-preview-excluded: marker constant not found in design-system-preview.tsx");
  process.exit(1);
}
const marker = Buffer.from(match[1], "utf8");

const args = process.argv.slice(2);
const expectPresent = args.includes("--expect-present");
const dirs = args.filter((a) => !a.startsWith("--"));
if (dirs.length === 0) {
  console.error("usage: check-mobile-preview-excluded.mjs [--expect-present] <dir|file> …");
  process.exit(1);
}

const hits = [];
let scanned = 0;
function visit(path) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) visit(join(path, name));
    return;
  }
  scanned++;
  if (readFileSync(path).includes(marker)) hits.push(path);
}
for (const dir of dirs) {
  if (!existsSync(dir)) {
    console.error(`check-mobile-preview-excluded: ${dir} does not exist (build it first)`);
    process.exit(1);
  }
  visit(dir);
}

if (expectPresent) {
  if (hits.length === 0) {
    console.error(`Marker not found in ${scanned} files: the check cannot see the preview. Fix the marker.`);
    process.exit(1);
  }
  console.log(`OK: marker found in the development export (${hits.length} of ${scanned} files).`);
} else {
  if (hits.length > 0) {
    console.error("The design-system preview is in a production bundle:");
    for (const h of hits) console.error(`  ${h}`);
    process.exit(1);
  }
  console.log(`OK: design-system preview not in ${scanned} production files.`);
}
