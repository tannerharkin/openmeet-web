// Re-fetches every external <script src integrity> in index.html and checks the bytes still match.
// SRI makes a changed CDN file fail closed (blank page); this catches that in CI before users do.
// Usage: node build/verify-sri.mjs [path/to/index.html]
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const file = process.argv[2] ?? new URL("../index.html", import.meta.url);
const html = await readFile(file, "utf8");
const attr = (attrs, name) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs)?.[1];

let checked = 0;
let failed = 0;
for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/gi)) {
  const src = attr(attrs, "src");
  if (!src || !/^https?:\/\//i.test(src)) continue;
  const integrity = attr(attrs, "integrity");
  if (!integrity) { console.error(`MISSING integrity: ${src}`); failed++; continue; }
  const response = await fetch(src);
  if (!response.ok) { console.error(`HTTP ${response.status}: ${src}`); failed++; continue; }
  const body = Buffer.from(await response.arrayBuffer());
  // Any listed hash matching is enough (SRI semantics); only sha256/384/512 are valid.
  const ok = integrity.split(/\s+/).filter(Boolean).some((entry) => {
    const [algorithm, expected] = entry.split(/-(.*)/s);
    return ["sha256", "sha384", "sha512"].includes(algorithm) && createHash(algorithm).update(body).digest("base64") === expected;
  });
  console.log(`${ok ? "ok      " : "MISMATCH"} ${src}`);
  checked++;
  if (!ok) failed++;
}
// exitCode, not process.exit(): exiting with fetch sockets still open aborts Node on Windows (libuv assertion).
if (checked === 0) console.error("no external scripts with integrity found");
process.exitCode = checked === 0 || failed ? 1 : 0;
