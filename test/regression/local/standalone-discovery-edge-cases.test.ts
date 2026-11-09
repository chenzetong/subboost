import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type StartStandalone = {
  assertBuilt(serverPath: string, exit?: (code: number) => never): void;
  findStandaloneServer(root?: string): string;
  getStandaloneContext(root?: string): {
    appDirectoryName: string;
    appRoot: string;
    standaloneBase: string;
  };
};

const requireCjs = createRequire(import.meta.url);
const standalone = requireCjs("../../../local/scripts/start-standalone.cjs") as StartStandalone;
const roots: string[] = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "subboost-runtime-regression-"));
  roots.push(root);
  return root;
}

describe("local standalone discovery edge behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("falls back to the conventional server path when recursive discovery finds nothing", () => {
    const root = makeRoot();
    const context = standalone.getStandaloneContext(root);
    mkdirSync(join(context.standaloneBase, "one", "two", "three", "four"), { recursive: true });

    expect(standalone.findStandaloneServer(root)).toBe(
      join(context.standaloneBase, "apps", context.appDirectoryName, "server.js"),
    );
  });

  it("accepts an existing fallback server without calling the exit boundary", () => {
    const root = makeRoot();
    const exit = vi.fn((_code: number) => {
      throw new Error("unexpected exit");
    });

    expect(() => standalone.assertBuilt(root, exit)).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });
});
