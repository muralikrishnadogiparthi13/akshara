import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const res = await build({
  entryPoints: ["site/bookmarklet.src.js"],
  bundle: true, minify: true, format: "iife", target: "es2022",
  write: false, legalComments: "none",
});
const code = res.outputFiles[0].text.trim();
const href = "javascript:" + encodeURIComponent(code);

writeFileSync("site/bookmarklet.min.js", code + "\n");

// Inject into the page. The placeholder is replaced on every build, and the
// previous href is matched by its javascript: prefix so rebuilds are idempotent.
const page = "site/index.html";
const html = readFileSync(page, "utf8");
const next = html.replace(/href="(BOOKMARKLET_HREF|javascript:[^"]*)"/, () => `href="${href}"`);
if (next === html && !html.includes(href)) {
  throw new Error("bookmarklet placeholder not found in " + page);
}
writeFileSync(page, next);
console.log("minified:", (code.length / 1024).toFixed(1) + "kB");
console.log("href:    ", (href.length / 1024).toFixed(1) + "kB");
