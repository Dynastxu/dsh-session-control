import { defineConfig } from "vite";

/**
 * Host half: one ESM entry for Node. Node builtins stay external; everything
 * the plugin owns is bundled into `lib/index.js`, the package entry the
 * installed Loader resolves.
 */
export default defineConfig({
  build: {
    target: "node22",
    outDir: "lib",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [/^node:/u],
    },
  },
});
