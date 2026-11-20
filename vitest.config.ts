import { defineConfig } from "vitest/config";

/**
 * Unit and composition tests run in worker threads: the DSH file sandbox
 * blocks piped child processes, which the default fork pool would spawn.
 */
export default defineConfig({
  test: {
    environment: "node",
    pool: "threads",
    include: ["test/**/*.test.ts"],
    reporters: ["default"],
  },
});
