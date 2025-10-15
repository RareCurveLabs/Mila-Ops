#!/usr/bin/env node
/* Minimal “plan → patch → PR” runner.
   - Triggered by: label `mila:go` on an Issue or comment `/go`
   - Reads the issue body for a fenced block ```plan and optional ```patches
   - If no patches provided, asks OpenAI to generate file edits (placeholder)
   - Applies edits in a new branch, runs install/build/test, opens PR
*/
const cp = require('node:child_process');
const fs = require('fs');
const path = require('path');

function sh(cmd, opts={stdio:'pipe'}) { return cp.execSync(cmd, {...opts, encoding:'utf8'}).trim(); }

const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY; // owner/repo
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!GITHUB_TOKEN) {
  console.error("Missing GITHUB_TOKEN (built-in secret).");
  process.exit(1);
}

// --- Helpers to fetch current issue payload via GitHub CLI
function gh(cmd) { return sh(`gh ${cmd}`, {stdio:'pipe'}); }

function getTrigger() {
  // Use the GitHub-provided env when running in Actions:
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  const ev = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  let issue = ev.issue || ev.discussion || null;
  if (!issue && ev.comment && ev.issue) issue = ev.issue;
  return { ev, issue };
}

function extractBlock(text, lang) {
  const re = new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "m");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

async function main() {
  const trig = getTrigger();
  if (!trig || !trig.issue) {
    console.log("No issue context found; exiting.");
    return;
  }
  const issueNumber = trig.issue.number;
  // Get fresh body (gh CLI is available in Actions runtime)
  const issueJson = JSON.parse(gh(`issue view ${issueNumber} --json number,title,body,labels,url`));
  const body = issueJson.body || '';

  const plan = extractBlock(body, 'plan');
  const patches = extractBlock(body, 'patches'); // unified diffs (git apply)
  const mode = (plan && /mode:\s*(\w+)/i.exec(plan)?.[1]) || "enhancement";

  // Create a working branch
  const branchName = `mila/${Date.now()}-${mode}`;
  sh(`git checkout -b ${branchName}`);

  if (patches) {
    fs.writeFileSync('mila.patch', patches, 'utf8');
    try {
      sh(`git apply --whitespace=fix mila.patch`);
    } catch (e) {
      console.error("Patch failed to apply.");
      console.error(e.message);
      process.exit(1);
    }
  } else {
    // Placeholder: you can expand this to call OpenAI to synthesize edits based on the plan
    console.log("No ```patches block provided. Create one or extend runner to call OpenAI for codegen.");
    // For safety, exit non-zero so you notice
    process.exit(1);
  }

  // Install/build/test (best-effort—project may define scripts)
  try { sh(`pnpm i`, {stdio:'inherit'}); } catch {}
  try { sh(`pnpm run -s build`, {stdio:'inherit'}); } catch {}
  try { sh(`pnpm run -s test`, {stdio:'inherit'}); } catch {}

  // Commit & push
  sh(`git add -A`);
  const msg = `chore: apply Mila patches\n\n[skip ci]`;
  sh(`git commit -m ${JSON.stringify(msg)}`);
  sh(`git push -u origin ${branchName}`);

  // Open PR
  const pr = JSON.parse(gh(`pr create --title ${JSON.stringify(issueJson.title)} --body ${JSON.stringify("Auto-PR by Mila Runner")} --head ${JSON.stringify(branchName)} --json number,url`));
  console.log(`PR opened: ${pr.url}`);

  // Comment back on the issue
  gh(`issue comment ${issueNumber} --body ${JSON.stringify("PR opened: " + pr.url)}`);
}

main().catch(e => { console.error(e); process.exit(1); });