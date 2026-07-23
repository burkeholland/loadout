#!/usr/bin/env node
// Link (default) or copy loadout canvases into ~/.copilot/extensions.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CANVASES_DIR = join(REPO_ROOT, "canvases");
const EXTENSIONS_DIR = join(homedir(), ".copilot", "extensions");

function parseArgs(argv) {
  const opts = { copy: false, force: false, only: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--copy") opts.copy = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--only") {
      opts.only = argv[++i];
      if (!opts.only) throw new Error("--only requires a canvas name");
    } else if (a.startsWith("--only=")) {
      opts.only = a.slice("--only=".length);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/install-canvases.mjs [options]

Install loadout canvases into ~/.copilot/extensions so Copilot can discover them.

Options:
  --only <name>   Install a single canvas (folder name under canvases/)
  --copy          Copy files instead of linking (detached promote)
  --force         Replace an existing extension directory/link
  -h, --help      Show help

Default mode creates a directory junction (Windows) or symlink (POSIX)
from ~/.copilot/extensions/<name> -> <repo>/canvases/<name> for live edits.
`);
}

function listCanvases() {
  if (!existsSync(CANVASES_DIR)) return [];
  return readdirSync(CANVASES_DIR)
    .filter((name) => {
      const dir = join(CANVASES_DIR, name);
      return statSync(dir).isDirectory() && existsSync(join(dir, "extension.mjs"));
    })
    .sort();
}

function isLinkLike(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function removeTarget(target, force) {
  if (!existsSync(target) && !isLinkLike(target)) return;
  if (!force) {
    throw new Error(
      `Target already exists: ${target}\nRe-run with --force to replace it.`,
    );
  }
  rmSync(target, { recursive: true, force: true });
}

function linkCanvas(name, force) {
  const source = join(CANVASES_DIR, name);
  const target = join(EXTENSIONS_DIR, name);
  removeTarget(target, force);

  if (process.platform === "win32") {
    // Directory junction — no admin required on Windows.
    symlinkSync(source, target, "junction");
  } else {
    symlinkSync(source, target, "dir");
  }
  return { name, mode: "link", source, target };
}

function copyCanvas(name, force) {
  const source = join(CANVASES_DIR, name);
  const target = join(EXTENSIONS_DIR, name);
  removeTarget(target, force);
  cpSync(source, target, { recursive: true });
  return { name, mode: "copy", source, target };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  mkdirSync(EXTENSIONS_DIR, { recursive: true });
  let names = listCanvases();
  if (opts.only) {
    if (!names.includes(opts.only)) {
      throw new Error(
        `Canvas "${opts.only}" not found under ${CANVASES_DIR}. Available: ${names.join(", ") || "(none)"}`,
      );
    }
    names = [opts.only];
  }
  if (!names.length) {
    console.log("No canvases found.");
    return;
  }

  const results = [];
  for (const name of names) {
    const result = opts.copy ? copyCanvas(name, opts.force) : linkCanvas(name, opts.force);
    results.push(result);
    console.log(`${result.mode === "copy" ? "Copied" : "Linked"} ${name}`);
    console.log(`  ${result.target}`);
    console.log(`  -> ${result.source}`);
  }

  console.log("");
  console.log(`Installed ${results.length} canvas(es) into ${EXTENSIONS_DIR}`);
  console.log("Reload Copilot extensions (or restart the session) to pick them up.");
}

try {
  main();
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
}
