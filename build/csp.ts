import type { Plugin } from "vite";
import { createHash } from "node:crypto";

// Injects a hash-based Content-Security-Policy <meta> into the built index.html. Must be registered after
// viteSingleFile: both hooks are enforce "post" + generateBundle order "post", so registration order decides
// and this runs once the bundle has been inlined (the hashed text is final).
//
// frame-ancestors, report-uri/report-to and sandbox are absent because they are ignored when delivered via
// <meta> (CSP3 §3.3); GitHub Pages cannot set response headers.
// style-src stays 'unsafe-inline' with no hashes: react-remove-scroll/react-style-singleton and sonner inject
// <style> elements at runtime, and any hash in style-src would disable 'unsafe-inline'.
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs)?.[1];

export function buildCsp(html: string): string {
  const sources: string[] = [];
  let module = false;
  for (const [, attrs, body] of html.matchAll(SCRIPT_RE)) {
    // Everything is inlined; an external script would break the "nothing from other origins" promise.
    const src = attr(attrs, "src");
    if (src) throw new Error(`external script not allowed: ${src}`);
    if (/\btype\s*=\s*"module"/i.test(attrs)) module = true;
    // The HTML parser turns CRLF/CR into LF before CSP hashes the text, so hash what the browser sees.
    const text = body.replace(/\r\n?/g, "\n");
    sources.push(`'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`);
  }
  if (!module) throw new Error("no inline module script found in index.html");
  return [
    "default-src 'none'",
    `script-src ${[...new Set(sources)].join(" ")}`,
    "style-src 'unsafe-inline'",
    "img-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function injectCsp(html: string): string {
  const charset = '<meta charset="UTF-8" />';
  const at = html.indexOf(charset);
  if (at < 0) throw new Error(`${charset} not found in index.html`);
  const meta = `\n    <meta http-equiv="Content-Security-Policy" content="${buildCsp(html)}" />`;
  const end = at + charset.length;
  const out = html.slice(0, end) + meta + html.slice(end);
  // The meta must precede every script and link or those load before the policy applies.
  const first = out.search(/<(script|link)\b/i);
  if (first >= 0 && first < out.indexOf(meta)) throw new Error("CSP meta would follow a script/link");
  return out;
}

export function cspMeta(): Plugin {
  return {
    name: "openmeet-csp-meta",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const asset = bundle["index.html"];
        if (!asset || asset.type !== "asset") return this.error("index.html asset not found; cannot add CSP");
        const html = typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source);
        try {
          asset.source = injectCsp(html);
        } catch (e) {
          this.error(`CSP: ${(e as Error).message}`);
        }
      },
    },
  };
}
