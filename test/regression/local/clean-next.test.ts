import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCjs = createRequire(import.meta.url);
const fs = requireCjs("node:fs") as typeof import("node:fs");
const localScriptPath = requireCjs.resolve("../../../local/scripts/clean-next.cjs");
const originalCwd = process.cwd();
const originalExit = process.exit;
let tempRoot = "";

function runLocalCleanNext() {
  delete (requireCjs as any).cache[localScriptPath];
  return requireCjs(localScriptPath);
}

describe("public local clean-next script", () => {
  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "subboost-public-clean-next-"));
    process.chdir(tempRoot);
  });

  afterEach(() => {
    process.exit = originalExit;
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(tempRoot, { recursive: true, force: true });
    delete (requireCjs as any).cache[localScriptPath];
  });

  it("removes local .next outputs and matching local backup directories", () => {
    mkdirSync(join(tempRoot, ".next"));
    mkdirSync(join(tempRoot, ".next.bak-20260606-123456"));
    mkdirSync(join(tempRoot, ".next.bak-20260606-bad"));

    runLocalCleanNext();

    expect(() => statSync(join(tempRoot, ".next"))).toThrow();
    expect(() => statSync(join(tempRoot, ".next.bak-20260606-123456"))).toThrow();
    expect(statSync(join(tempRoot, ".next.bak-20260606-bad")).isDirectory()).toBe(true);
  });

  it("covers injectable local clean helper run path", () => {
    const helpers = runLocalCleanNext();
    const warn = vi.fn();
    const removed: string[] = [];
    const fsMock = {
      existsSync: vi.fn((target: string) => target !== ".next.bak-20260606-123456"),
      readdirSync: vi.fn(() => [
        { name: ".next.bak-20260606-123456", isDirectory: () => true },
        { name: "keep", isDirectory: () => true },
      ]),
      renameSync: vi.fn(),
      rmSync: vi.fn((target: string) => {
        removed.push(target);
      }),
    };
    const lockedFsMock = {
      ...fsMock,
      renameSync: vi.fn(),
      rmSync: vi.fn((target: string) => {
        if (target === ".next") throw Object.assign(new Error("busy"), { code: "EBUSY" });
        if (target === ".next.bak-20260606-123456") throw Object.assign(new Error("locked backup"), { code: "EPERM" });
        if (target === "not-busy") throw Object.assign(new Error("not busy"), { code: "ENOENT" });
      }),
    };

    expect(helpers.getRemoveOptions("win32")).toMatchObject({ maxRetries: 30, retryDelay: 200 });
    expect(helpers.getRemoveOptions("darwin")).toMatchObject({ maxRetries: 3, retryDelay: 100 });
    expect(helpers.isBusyError({ code: "ENOTEMPTY" })).toBe(true);
    expect(helpers.isBusyError(null)).toBeNull();
    expect(helpers.isBusyError({ code: "ENOENT" })).toBe(false);
    expect(helpers.backupName(new Date(2026, 5, 6, 1, 2, 3))).toBe(".next.bak-20260606-010203");
    helpers.run({ fs: fsMock, cwd: "/tmp/repo", platform: "darwin" });
    expect(removed).toEqual([".next"]);

    helpers.removeDistDir(".next", { fs: lockedFsMock, platform: "win32", now: new Date(2026, 5, 6, 1, 2, 3), warn });
    expect(lockedFsMock.renameSync).toHaveBeenCalledWith(".next", ".next.bak-20260606-010203");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("moved locked .next"));

    helpers.removeDistDir(".next.bak-20260606-123456", { fs: lockedFsMock, platform: "win32", warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipped locked backup directory"));

    expect(() => helpers.removeDistDir("not-busy", { fs: lockedFsMock, platform: "win32", warn })).toThrow("not busy");
    expect(() => helpers.removeDistDir(".next", { fs: lockedFsMock, platform: "darwin", warn })).toThrow("busy");
  });

  it("renames locked local .next output on Windows", () => {
    if (process.platform !== "win32") return;
    mkdirSync(join(tempRoot, ".next"));
    const originalRmSync = fs.rmSync;
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (target === ".next") {
        const error = new Error("busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      return originalRmSync(target, options);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    runLocalCleanNext();

    expect(existsSync(join(tempRoot, ".next"))).toBe(false);
    expect(readdirSync(tempRoot).some((entry) => /^\.next\.bak-\d{8}-\d{6}$/.test(entry))).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("moved locked .next"));
  });

  it("skips locked timestamped local backup directories on Windows", () => {
    if (process.platform !== "win32") return;
    mkdirSync(join(tempRoot, ".next.bak-20260606-123456"));
    const originalRmSync = fs.rmSync;
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (target === ".next.bak-20260606-123456") {
        const error = new Error("busy") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return originalRmSync(target, options);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    runLocalCleanNext();

    expect(statSync(join(tempRoot, ".next.bak-20260606-123456")).isDirectory()).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipped locked backup directory"));
  });

  it("rethrows non-lock local cleanup errors on Windows", () => {
    if (process.platform !== "win32") return;
    mkdirSync(join(tempRoot, ".next"));
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (target === ".next") {
        const error = new Error("not a lock") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return rmSync(target, options);
    });

    expect(() => runLocalCleanNext()).toThrow("not a lock");
  });

  it("skips local clean-up when matching directories are absent", () => {
    mkdirSync(join(tempRoot, "keep"));

    expect(() => runLocalCleanNext()).not.toThrow();
    expect(statSync(join(tempRoot, "keep")).isDirectory()).toBe(true);
  });
});
