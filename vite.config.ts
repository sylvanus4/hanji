import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    // Every heavy engine is dynamically imported, so leaving chunking to Rollup
    // gives one chunk per engine automatically. Inlining assets is disabled so
    // the WASM binaries stay cacheable files rather than base64 in the bundle.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    headers: {
      // Mirror the production Cloudflare headers locally so a
      // cross-origin-isolation problem shows up in dev, not after deploy.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  worker: {
    format: "es",
  },
});
