/**
 * Compile-time flag, replaced literally by esbuild `--define:__GS_DEV__=...`.
 *   dev build (`npm run dev`)      → true
 *   prod build (`npm run build`)   → false  → dead `if (__GS_DEV__){}` branches
 *                                     are stripped by esbuild minifySyntax (DCE),
 *                                     and the release-gate grep enforces it.
 * See esbuild.config.mjs + scripts/release-gate.mjs.
 */
declare const __GS_DEV__: boolean;
