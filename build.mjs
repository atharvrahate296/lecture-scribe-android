/* ============================================================
   Shruti — bundler
   ------------------------------------------------------------
   Inlines every stylesheet and script into one file so the
   prototype can be opened from a USB stick with no server, no
   package install and no network. That constraint is the point
   of the product, so the build honours it too.

     node build.mjs

   Writes:
     dist/shruti.html    complete standalone page (double-click)
     dist/artifact.html  body-only fragment for hosted publishing
   ============================================================ */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const html = read('index.html');

const cssFiles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
const jsFiles = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

if (!cssFiles.length || !jsFiles.length) {
  throw new Error('index.html has no linked assets — did the markup change?');
}

const css = cssFiles.map((f) => `/* ===== ${f} ===== */\n${read(f)}`).join('\n\n');
const js = jsFiles.map((f) => `/* ===== ${f} ===== */\n${read(f)}`).join('\n\n');

// Guard against a script that would close its own tag early.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

// The replacement MUST be a function. The source contains `$&` and `$1`
// (regex replacement patterns in the app's own code); passing it as a string
// would let String.replace interpret them and silently corrupt the bundle.
const swap = (subject, find, replacement) => subject.replace(find, () => replacement);

let out = html;
cssFiles.forEach((f, i) => {
  out = swap(out, `<link rel="stylesheet" href="${f}">`,
    i === 0 ? `<style>\n${css}\n</style>` : '');
});
jsFiles.forEach((f, i) => {
  out = swap(out, `<script src="${f}"></script>`,
    i === 0 ? `<script>\n${safeJs}\n</script>` : '');
});
out = out.replace(/\n{3,}/g, '\n\n');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/shruti.html'), out, 'utf8');

// Body-only fragment: the host supplies doctype, html, head and body.
const bodyOnly = out
  .replace(/^[\s\S]*?<body>/i, '')
  .replace(/<\/body>[\s\S]*$/i, '')
  .replace(/^\s*\n/, '');
const head =
  `<title>Shruti — Offline Lecture Transcriber</title>\n` +
  `<style>\n${css}\n</style>\n`;
writeFileSync(join(root, 'dist/artifact.html'), head + bodyOnly, 'utf8');

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log(`dist/shruti.html    ${kb(out)}   (${cssFiles.length} css + ${jsFiles.length} js inlined)`);
console.log(`dist/artifact.html  ${kb(head + bodyOnly)}`);
