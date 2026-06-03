import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

esbuild
  .build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    // Compile-time license dev-flag. Defined LITERALLY so esbuild can fold it:
    // prod → `false`, then `minify` (minifySyntax) strips the dead
    // `if (__GS_DEV__){}` branches and the dev pubkey/bypass with them. The
    // release-gate grep (scripts/release-gate.mjs) enforces the strip.
    define: { __GS_DEV__: prod ? "false" : "true" },
    external: [
      "obsidian",
      "electron",
      "@codemirror/autocomplete",
      "@codemirror/collab",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
      ...builtins,
    ],
    format: "cjs",
    // es2020 — @noble/ed25519 uses BigInt literals (1n), unavailable pre-ES2020.
    // Obsidian's Electron / mobile WebView all support BigInt.
    target: "es2020",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
    minify: prod,
  })
  .catch(() => process.exit(1));
