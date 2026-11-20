/**
 * Artifact smoke test: the built browser half must execute inside the shell's
 * module-loader contract and expose the plugin object the client Loader
 * expects. The platform modules are stubbed; component rendering is not
 * exercised here.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** The plugin object one registration factory returns. */
interface PluginLike {
  readonly inject: readonly string[];
  apply(ctx: unknown): void;
}

interface Registration {
  readonly id: string;
  readonly factory: (require: (id: string) => unknown) => unknown;
}

/** Minimal stand-ins for the platform modules the artifact requires. */
const platform: Record<string, unknown> = {
  react: {
    createElement: () => null,
    useState: <T>(value: T | (() => T)) => [
      typeof value === "function" ? (value as () => T)() : value,
      () => {},
    ],
    useRef: (value: unknown) => ({ current: value }),
    useEffect: () => {},
    useMemo: (factory: () => unknown) => factory(),
  },
  "@deepseek-ai/dsh-client-ui-primitives": new Proxy(
    {},
    {
      get: () =>
        function Primitive() {
          return null;
        },
    },
  ),
};

/**
 * Evaluate the artifact with the loader global installed.
 * @returns the registrations the artifact published.
 */
function load(): Registration[] {
  const registrations: Registration[] = [];
  const holder = globalThis as { window?: unknown };
  const previous = holder.window;
  holder.window = {
    __ModuleLoader__: { load: (registration: Registration) => registrations.push(registration) },
  };
  try {
    new Function(source)();
  } finally {
    holder.window = previous;
  }
  return registrations;
}

describe("client artifact", () => {
  it("registers one module under the package id", () => {
    const registrations = load();
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.id).toBe("@dynastxu/dsh-session-control");
    expect(typeof registrations[0]?.factory).toBe("function");
  });

  it("exposes the plugin object and requires only platform modules", () => {
    const [registration] = load();
    const required: string[] = [];
    const plugin = registration?.factory((specifier) => {
      required.push(specifier);
      const module = platform[specifier];
      if (module === undefined) throw new Error(`unexpected platform module: ${specifier}`);
      return module;
    }) as PluginLike;
    expect(typeof plugin.apply).toBe("function");
    expect([...plugin.inject].sort()).toEqual([
      "locale",
      "remote",
      "remote.commands",
      "slots",
      "uiWorkspace",
    ]);
    expect([...required].sort()).toEqual(["@deepseek-ai/dsh-client-ui-primitives", "react"]);
  });
});
