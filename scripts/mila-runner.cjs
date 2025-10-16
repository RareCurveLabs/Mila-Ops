#!/usr/bin/env node
// Robust "apply patches" runner. Reads patches from issue body OR triggering comment.
// If no patches, exits 0 so the PR step can no-op gracefully.

const cp = require("node:child_process");
const fs = require("fs");

function sh(cmd, opts = { stdio: "pipe" }) {
  return cp.execSync(cmd, { ...opts, encoding: "utf8" }).trim();
}

function getEvent() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function extractFencedBlock(text = "", fence = "patches") {
  // Matches ```patches\n...``` or ```patches\r\n...```
  const re = new RegExp("```" + fence + "\\r?\\n([\\s\\S]*?)\\n```", "i");
  const m = text.match(re);
  return m && m[1] ? m[1] : "";
}

async function main() {
  const ev = getEvent();
  const issueBody = ev?.issue?.body || "";
  const commentBody = ev?.comment?.body || "";

  // Prefer patches in the issue body, else fall back to the triggering comment.
  let patches = extractFencedBlock(issueBody, "patches");
  if (!patches) patches = extractFencedBlock(commentBody, "patches");

  if (!patches) {
    console.log("[mila-runner] No ```patches block found in issue or comment. Nothing to apply.");
    // Exit 0 so downstream "create-pull-request" step just finds no changes and exits cleanly.
    process.exit(0);
  }

  // Write and apply
  fs.writeFileSync("mila.patch", patches, "utf8");
  try {
    // whitespace=fix tolerates trailing spaces/CRLF
    sh(`git apply --whitespace=fix mila.patch`, { stdio: "inherit" });
    console.log("[mila-runner] Patch applied.");
  } catch (e) {
    console.error("[mila-runner] Patch failed to apply.\n", e.message);
    // Dump first 200 chars for quick triage
    console.error("[mila-runner] First 200 chars of patch:\n", patches.slice(0, 200));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
