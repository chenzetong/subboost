import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCjs = createRequire(import.meta.url);
const releaseAssets = requireCjs("../../../scripts/selfhost-release-assets.cjs") as {
  buildManifest(root: string, args: Record<string, unknown>): Record<string, unknown>;
  main(argv?: string[], dependencies?: { root?: string }): void;
  parseArgs(argv: string[]): Record<string, unknown>;
};

const ENV_KEYS = [
  "SUBBOOST_RELEASE_ASSET_BASE_URL",
  "SUBBOOST_ONECLICK_BASE_URL",
  "SUBBOOST_BUILD_SHA",
  "SUBBOOST_IMAGE",
  "SUBBOOST_IMAGE_REPOSITORY",
  "SUBBOOST_RELEASE_IMAGE_TAG",
  "SUBBOOST_RELEASE_ASSET_OUTPUT",
  "SUBBOOST_ONECLICK_OUTPUT",
  "GITHUB_REF_NAME",
  "SUBBOOST_INSTALLER_RELEASE_URL",
  "SUBBOOST_INSTALLER_UPDATE_RELEASE_URL",
  "SUBBOOST_INSTALLER_COMPOSE_URL",
  "SUBBOOST_INSTALLER_MANAGER_URL",
  "SUBBOOST_INSTALLER_IMAGE",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

function withVersionDirectory(version: unknown, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "subboost-public-assets-coverage-"));
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ version }), "utf8");
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("selfhost release asset argument regressions", () => {
  it.each([
    [["--output"], "--output cannot be empty."],
    [["--image-repository"], "--image-repository cannot be empty."],
    [["--image"], "--image cannot be empty."],
    [["--image-tag"], "--image-tag cannot be empty."],
    [["--tag"], "--tag cannot be empty."],
    [["--release-tag"], "--tag cannot be empty."],
    [["--build-sha"], "--build-sha cannot be empty."],
    [["--installer-release-url"], "--installer-release-url cannot be empty."],
    [["--installer-update-release-url"], "--installer-update-release-url cannot be empty."],
    [["--installer-compose-url"], "--installer-compose-url cannot be empty."],
    [["--installer-manager-url"], "--installer-manager-url cannot be empty."],
    [["--installer-image"], "--installer-image cannot be empty."],
  ] as const)("rejects an explicit option without a value: %j", (argv, message) => {
    expect(() => releaseAssets.parseArgs([...argv])).toThrow(message);
  });

  it("lets both help aliases bypass ordinary required-value validation", () => {
    expect(releaseAssets.parseArgs(["--help", "--output"])).toMatchObject({ help: true, output: "" });

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    releaseAssets.main(["-h"], { root: "unused-for-help" });
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0][0])).toContain("Usage:");
  });

  it("rejects unknown options", () => {
    expect(() => releaseAssets.parseArgs(["--not-a-release-option"])).toThrow(
      "Unknown argument: --not-a-release-option",
    );
  });

  it("uses documented environment precedence and installer defaults", () => {
    process.env.SUBBOOST_RELEASE_ASSET_BASE_URL = "https://primary.example.invalid/assets";
    process.env.SUBBOOST_ONECLICK_BASE_URL = "https://fallback.example.invalid/assets";
    process.env.SUBBOOST_RELEASE_ASSET_OUTPUT = "dist/primary";
    process.env.SUBBOOST_ONECLICK_OUTPUT = "dist/fallback";
    process.env.SUBBOOST_BUILD_SHA = "abcdef1234567890";
    process.env.SUBBOOST_IMAGE = "example.invalid/subboost@sha256:abc";
    process.env.SUBBOOST_IMAGE_REPOSITORY = "example.invalid/subboost";
    process.env.SUBBOOST_RELEASE_IMAGE_TAG = "example.invalid/subboost:v2.7.0";
    process.env.GITHUB_REF_NAME = "v2.7.0";
    process.env.SUBBOOST_INSTALLER_IMAGE = "example.invalid/subboost:v2.7.0";

    expect(releaseAssets.parseArgs([])).toMatchObject({
      baseUrl: "https://primary.example.invalid/assets",
      buildSha: "abcdef1234567890",
      image: "example.invalid/subboost@sha256:abc",
      imageRepository: "example.invalid/subboost",
      imageTag: "example.invalid/subboost:v2.7.0",
      installerImage: "example.invalid/subboost:v2.7.0",
      output: "dist/primary",
      releaseTag: "v2.7.0",
    });
  });

  it("derives default release metadata without an explicit image", () => {
    withVersionDirectory("2.7.0", (root) => {
      const args = releaseAssets.parseArgs(["--build-sha", "abcdef1234567890"]);
      expect(releaseAssets.buildManifest(root, args)).toMatchObject({
        buildSha: "abcdef1234567890",
        buildVersion: "2.7.0+sha.abcdef123456",
        image: "ghcr.io/subboost/subboost:v2.7.0",
        imageTag: "ghcr.io/subboost/subboost:v2.7.0",
        version: "2.7.0",
      });
    });
  });

  it("reports missing versions and unavailable git metadata", () => {
    withVersionDirectory("", (root) => {
      expect(() => releaseAssets.buildManifest(root, releaseAssets.parseArgs(["--build-sha", "abc"]))).toThrow(
        "package.json is missing version.",
      );
    });
    withVersionDirectory("2.7.0", (root) => {
      expect(() => releaseAssets.buildManifest(root, releaseAssets.parseArgs([]))).toThrow(
        /git rev-parse HEAD failed:/,
      );
    });
  });

  it("uses the current Git commit when no build SHA is supplied", () => {
    withVersionDirectory("2.7.0", (root) => {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["add", "package.json"], { cwd: root, stdio: "ignore" });
      execFileSync(
        "git",
        [
          "-c",
          "user.name=SubBoost Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-m",
          "test fixture",
        ],
        { cwd: root, stdio: "ignore" },
      );
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

      expect(releaseAssets.buildManifest(root, releaseAssets.parseArgs([]))).toMatchObject({
        buildSha: head,
        buildVersion: `2.7.0+sha.${head.slice(0, 12)}`,
      });
    });
  });
});
