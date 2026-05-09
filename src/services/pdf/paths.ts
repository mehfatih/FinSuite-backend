// ================================================================
// Asset path resolver for the PDF service.
// Works in both tsx (dev) and tsc-compiled (prod) modes:
//
//   tsx mode:  __dirname = .../src/services/pdf
//   tsc mode:  __dirname = .../dist/services/pdf
//
// Either way `path.resolve(__dirname, 'assets', ...parts)` lands at
// the correct location PROVIDED `npm run build` copies static assets
// from src/services/pdf/assets into dist/services/pdf/assets. That
// copy is wired into `scripts/copy-pdf-assets.js` and the build script.
// ================================================================
import path from 'path';

export function pdfAssetPath(...parts: string[]): string {
  return path.resolve(__dirname, 'assets', ...parts);
}

/** Convert a local file path to a `file://` URL safely for any OS. */
export function fileUrl(absolutePath: string): string {
  // Normalise Windows backslashes; ensure URL-safe encoding for spaces etc.
  const normalised = absolutePath.replace(/\\/g, '/');
  const prefix     = normalised.startsWith('/') ? 'file://' : 'file:///';
  return prefix + encodeURI(normalised);
}

export function fontUrl(filename: string): string {
  return fileUrl(pdfAssetPath('fonts', filename));
}
