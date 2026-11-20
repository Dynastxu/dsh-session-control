import { defineConfig } from "vite";

/**
 * Client half: one standalone ES file that calls the Web shell's module
 * loader. React and the client primitives are requested through the loader's
 * `require`, so nothing is imported or externalized here. The classic JSX
 * runtime keeps that contract too: `React.createElement` resolves from the
 * factory's own `require("react")`, not from a module-level import. Emitted
 * next to the Host entry as `lib/client.js`, the package's Client export.
 */
export default defineConfig({
  oxc: {
    jsx: { runtime: "classic" },
  },
  build: {
    target: "es2022",
    outDir: "lib",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: "src/client/index.tsx",
      formats: ["es"],
      fileName: () => "client.js",
    },
  },
});
