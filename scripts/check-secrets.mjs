#!/usr/bin/env node
// Fails (exit 1) if secrets are found in tracked files or in build output.
//
//   node scripts/check-secrets.mjs --repo                    tracked files (git ls-files)
//   node scripts/check-secrets.mjs apps/web/.next/static …   build output (directories or files)
//
// CHECK_SECRETS_CANARY: comma-separated values that must not appear (CI sets a fake
// server-only value at build time and checks it never reaches the client bundle).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findSecrets, isForbiddenEnvFile, printableText } from "./secret-scan.mjs";

const args = process.argv.slice(2);
const canaries = (process.env.CHECK_SECRETS_CANARY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const problems = [];
let scanned = 0;

function scanFile(path) {
  const buffer = readFileSync(path);
  const isBinary = buffer.subarray(0, 8000).includes(0);
  const text = isBinary ? printableText(buffer) : buffer.toString("utf8");
  scanned++;
  for (const f of findSecrets(text, { canaries })) {
    const line = isBinary ? "bin" : text.slice(0, f.index).split("\n").length;
    problems.push(`${path}:${line}  ${f.kind}  ${f.preview}`);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else scanFile(path);
  }
}

if (args.length === 0) {
  console.error("Usage: check-secrets.mjs [--repo] [<dir or file>...]");
  process.exit(2);
}

for (const arg of args) {
  if (arg === "--repo") {
    const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
    for (const file of files) {
      if (isForbiddenEnvFile(file)) problems.push(`${file}  Tracked env file (only .env.example may be committed)`);
      if (existsSync(file) && statSync(file).isFile()) scanFile(file);
    }
  } else {
    if (!existsSync(arg)) {
      console.error(`Not found: ${arg} (build it first)`);
      process.exit(2);
    }
    if (statSync(arg).isDirectory()) walk(arg);
    else scanFile(arg);
  }
}

if (problems.length) {
  console.error(`Secret check FAILED: ${problems.length} finding(s) in ${scanned} files`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.warn(`Secret check passed: ${scanned} files, no secrets found${canaries.length ? `, ${canaries.length} canary value(s) absent` : ""}.`);
