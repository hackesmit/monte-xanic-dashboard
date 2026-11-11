// eval-receipt.mjs: the receipt contract from references/evals.md, for an
// eval harness written in JavaScript. Import it at the end of the eval:
//
//   import { promptHash, writeReceipt } from "./eval-receipt.mjs";
//   if (fails === 0) writeReceipt({ repoRoot, dir: process.env.EVAL_RECEIPT_DIR, bot: "vini", cases, provider, model });
//
// dir is THIS repo's receipt directory; the receipt lands at dir/<H>.json,
// exactly where templates/eval-gate.sh looks ($EVAL_RECEIPT_DIR/<H>.json).
//
// The hash must equal the bash one-liner in references/evals.md and what
// templates/eval-gate.sh computes from git blobs; tests/contract.test.sh checks it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function listedPaths(repoRoot, list = "evals/prompt-files.txt") {
  const text = readFileSync(join(repoRoot, list), "utf8");
  if (text.charCodeAt(0) === 0xfeff) throw new Error(list + " starts with a UTF-8 BOM; save it without one");
  return text
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim().replace(/^\.\//, ""))
    .filter((l) => l && !l.startsWith("#"));
}

export function promptHash(repoRoot, list) {
  let out = "";
  for (const p of listedPaths(repoRoot, list)) {
    const f = join(repoRoot, p);
    const s = existsSync(f) && statSync(f).isFile() ? sha256(readFileSync(f)) : "missing";
    out += p + " " + s + "\n";
  }
  return sha256(out);
}

export function writeReceipt({ repoRoot, dir, bot, cases, provider, model, list }) {
  if (!dir) throw new Error("writeReceipt: no receipt dir (set EVAL_RECEIPT_DIR)");
  const hash = promptHash(repoRoot, list);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, hash + ".json");
  writeFileSync(file, JSON.stringify({ bot, hash, pass: true, cases, fails: 0, provider, model, at: new Date().toISOString() }, null, 2) + "\n");
  return file;
}

// CLI: node eval-receipt.mjs hash [repoRoot]
if (process.argv[2] === "hash") console.log(promptHash(process.argv[3] || "."));
