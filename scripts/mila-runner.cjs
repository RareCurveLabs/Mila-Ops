const cp = require('node:child_process');
const fs = require('fs');

function sh(cmd, opts={stdio:'pipe'}) {
  return cp.execSync(cmd, {...opts, encoding:'utf8'}).trim();
}

function extractBlock(text, lang) {
  const re = new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "m");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function getTrigger() {
  const p = process.env.GITHUB_EVENT_PATH;
  if (!p || !fs.existsSync(p)) return null;
  const ev = JSON.parse(fs.readFileSync(p, 'utf8'));
  // prefer issue; fall back to comment.issue
  const issue = ev.issue || (ev.comment && ev.issue) || null;
  return { ev, issue };
}

async function main() {
  const trig = getTrigger();
  const body = trig?.issue?.body || '';
  const patches = extractBlock(body, 'patches');

  if (!patches) {
    console.log("No ```patches block found. Nothing to apply.");
    process.exit(0); // let create-pull-request still run (no changes → no PR)
  }

  fs.writeFileSync('mila.patch', patches, 'utf8');
  try {
    sh(`git apply --whitespace=fix mila.patch`, {stdio:'inherit'});
    console.log("Patch applied.");
  } catch (e) {
    console.error("Patch failed to apply:", e.message);
    process.exit(1);
  }
  // Do not commit/push here. The next workflow step will open the PR.
}

main().catch(e => { console.error(e); process.exit(1); });
