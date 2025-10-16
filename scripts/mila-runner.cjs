#!/usr/bin/env node
// Writes files from a ```files fenced block in the issue or triggering comment.
// No git apply. If no files given, exits 0 (PR step will no-op).

const fs = require("fs");

function getEvent() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function extractBlock(text = "", fence = "files") {
  const re = new RegExp("```" + fence + "\\r?\\n([\\s\\S]*?)\\n```", "i");
  const m = text.match(re);
  return m && m[1] ? m[1] : "";
}
function parseFilesBlock(block) {
  // Very simple splitter on lines of only '---'
  // Each section must contain `path:` then `content: |` with following lines as content.
  if (!block) return [];
  const sections = block.split(/\n---\s*\n/);
  const files = [];
  for (const sec of sections) {
    const pathMatch = sec.match(/^\s*path:\s*(.+)\s*$/m);
    const contentMatch = sec.match(/^\s*content:\s*\|\s*$/m);
    if (!pathMatch || !contentMatch) continue;
    const path = pathMatch[1].trim();
    const start = contentMatch.index + contentMatch[0].length;
    const content = sec.slice(start).replace(/^\n/, "");
    files.push({ path, content });
  }
  return files;
}

(async () => {
  const ev = getEvent();
  const issueBody = ev?.issue?.body || "";
  const commentBody = ev?.comment?.body || "";
  let block = extractBlock(issueBody, "files");
  if (!block) block = extractBlock(commentBody, "files");

  if (!block) {
    console.log("[mila-runner] No ```files block found. Nothing to write.");
    process.exit(0);
  }
  const files = parseFilesBlock(block);
  if (!files.length) {
    console.log("[mila-runner] Files block empty or malformed. Nothing to write.");
    process.exit(0);
  }

  for (const f of files) {
    // Ensure directories exist
    const dir = require("path").dirname(f.path);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f.path, f.content, "utf8");
    console.log(`[mila-runner] Wrote ${f.path} (${f.content.length} bytes)`);
  }
  process.exit(0);
})();
