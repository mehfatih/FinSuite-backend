// ================================================================
// copy-pdf-assets.js — invoked by `npm run build`.
// Copies static PDF assets (fonts, branding) from src/services/pdf/assets
// into dist/services/pdf/assets so the renderer's path resolver finds
// them in production. Cross-platform — uses Node's fs.cpSync.
// ================================================================
const fs   = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src  = path.join(root, 'src',  'services', 'pdf', 'assets');
const dst  = path.join(root, 'dist', 'services', 'pdf', 'assets');

if (!fs.existsSync(src)) {
  console.error(`[copy-pdf-assets] source missing: ${src}`);
  process.exit(1);
}

fs.mkdirSync(dst, { recursive: true });
fs.cpSync(src, dst, { recursive: true, force: true });

const files = fs.readdirSync(dst, { recursive: true })
  .filter((p) => typeof p === 'string')
  .filter((p) => !p.endsWith('.md'));
console.log(`[copy-pdf-assets] copied ${files.length} files into ${dst}`);
