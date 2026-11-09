import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireCjs = createRequire(import.meta.url);
const publicReleaseAssets = requireCjs("../../../scripts/selfhost-release-assets.cjs");
const TEMP_REPO_TEST_TIMEOUT_MS = 15_000;
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

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

function writeText(root: string, filePath: string, text: string): void {
  const absolute = join(root, filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text, "utf8");
}

function expectExecutable(filePath: string): void {
  if (process.platform === "win32") return;
  expect(statSync(filePath).mode & 0o111).not.toBe(0);
}

function withTempVersionRepo(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "subboost-public-release-assets-"));
  try {
    writeText(root, "public/package.json", JSON.stringify({ version: "9.8.7" }));
    writeText(
      root,
      "public/local/docker-compose.image.yml",
      "services:\n  app:\n    image: ${SUBBOOST_IMAGE:?set SUBBOOST_IMAGE}\n",
    );
    writeText(
      root,
      "public/local/scripts/install.sh",
      [
        "#!/usr/bin/env bash",
        'DEFAULT_RELEASE_URL="https://github.com/SubBoost/subboost/releases/latest/download/release.json"',
        'DEFAULT_UPDATE_RELEASE_URL="https://github.com/SubBoost/subboost/releases/latest/download/release.json"',
        'DEFAULT_COMPOSE_URL="https://github.com/SubBoost/subboost/releases/latest/download/docker-compose.image.yml"',
        'DEFAULT_MANAGER_URL="https://github.com/SubBoost/subboost/releases/latest/download/subboost-manager"',
        'DEFAULT_IMAGE="ghcr.io/subboost/subboost:latest"',
        "echo install",
        "",
      ].join("\r\n"),
    );
    writeText(root, "public/local/scripts/subboost.sh", "#!/usr/bin/env bash\r\necho subboost\r\n");
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("public selfhost release assets script", () => {
  it("builds immutable image metadata and fixed GitHub Release asset URLs", () => {
    withTempVersionRepo((root) => {
      const publicRoot = join(root, "public");
      const args = publicReleaseAssets.parseArgs([
        "--output",
        "dist/assets",
        "--image",
        "ghcr.io/subboost/subboost@sha256:abc123",
        "--image-repository",
        "ghcr.io/subboost/subboost",
        "--release-tag",
        "v9.8.7",
        "--build-sha",
        "abcdef1234567890",
        "--base-url",
        "https://github.com/SubBoost/subboost/releases/download/v9.8.7/",
      ]);

      const manifest = publicReleaseAssets.buildManifest(publicRoot, args);
      expect(manifest).toMatchObject({
        buildSha: "abcdef1234567890",
        buildVersion: "9.8.7+sha.abcdef123456",
        composeUrl: "https://github.com/SubBoost/subboost/releases/download/v9.8.7/docker-compose.image.yml",
        image: "ghcr.io/subboost/subboost@sha256:abc123",
        imageTag: "ghcr.io/subboost/subboost:v9.8.7",
        installerUrl: "https://github.com/SubBoost/subboost/releases/download/v9.8.7/install.sh",
        managerUrl: "https://github.com/SubBoost/subboost/releases/download/v9.8.7/subboost-manager",
        version: "9.8.7",
        versionToken: "9.8.7+sha.abcdef123456",
      });

      const bundle = publicReleaseAssets.createBundle(publicRoot, args);
      expect(bundle.output).toBe(join(publicRoot, "dist", "assets"));
      expect(existsSync(join(bundle.output, "release.json"))).toBe(true);
      expect(existsSync(join(bundle.output, "install.sh"))).toBe(true);
      expect(existsSync(join(bundle.output, "docker-compose.image.yml"))).toBe(true);
      expect(existsSync(join(bundle.output, "subboost-manager"))).toBe(true);
      expect(existsSync(join(bundle.output, "subboost"))).toBe(false);
      const installScript = readFileSync(join(bundle.output, "install.sh"), "utf8");
      expect(installScript).not.toContain("\r");
      expect(installScript).toContain(
        'DEFAULT_RELEASE_URL="https://github.com/SubBoost/subboost/releases/download/v9.8.7/release.json"'
      );
      expect(installScript).toContain(
        'DEFAULT_UPDATE_RELEASE_URL="https://github.com/SubBoost/subboost/releases/latest/download/release.json"'
      );
      expect(installScript).toContain(
        'DEFAULT_COMPOSE_URL="https://github.com/SubBoost/subboost/releases/download/v9.8.7/docker-compose.image.yml"'
      );
      expect(installScript).toContain(
        'DEFAULT_MANAGER_URL="https://github.com/SubBoost/subboost/releases/download/v9.8.7/subboost-manager"'
      );
      expect(installScript).toContain('DEFAULT_IMAGE="ghcr.io/subboost/subboost:v9.8.7"');
      expect(installScript).not.toContain(
        'DEFAULT_COMPOSE_URL="https://github.com/SubBoost/subboost/releases/latest/download/docker-compose.image.yml"'
      );
      expect(readFileSync(join(bundle.output, "subboost-manager"), "utf8")).not.toContain("\r");
      const releaseCompose = readFileSync(join(bundle.output, "docker-compose.image.yml"), "utf8");
      expect(releaseCompose).toContain(
        "image: ${SUBBOOST_CANDIDATE_IMAGE:-ghcr.io/subboost/subboost@sha256:abc123}",
      );
      expect(releaseCompose).not.toContain("${SUBBOOST_IMAGE:?set SUBBOOST_IMAGE}");
      expectExecutable(join(bundle.output, "install.sh"));
      expectExecutable(join(bundle.output, "subboost-manager"));
      expect(JSON.parse(readFileSync(join(bundle.output, "release.json"), "utf8"))).toMatchObject(manifest);

      writeText(publicRoot, "local/docker-compose.image.yml", "services: {}\n");
      expect(() => publicReleaseAssets.createBundle(publicRoot, args)).toThrow(
        "Expected exactly one SubBoost image marker in docker-compose.image.yml, found 0.",
      );
    });
  }, 10_000);

  it("honors GitHub workflow environment defaults and validates empty explicit release args", () => {
    process.env.SUBBOOST_RELEASE_ASSET_BASE_URL = "https://github.com/SubBoost/subboost/releases/download/v9.8.7";
    process.env.SUBBOOST_RELEASE_ASSET_OUTPUT = "dist/from-env";
    process.env.SUBBOOST_IMAGE = "ghcr.io/subboost/subboost@sha256:envdigest";
    process.env.SUBBOOST_IMAGE_REPOSITORY = "ghcr.io/env/subboost";
    process.env.SUBBOOST_RELEASE_IMAGE_TAG = "ghcr.io/env/subboost:v9.8.7";
    process.env.SUBBOOST_BUILD_SHA = "fedcba9876543210";
    process.env.GITHUB_REF_NAME = "v9.8.7";
    process.env.SUBBOOST_INSTALLER_RELEASE_URL = "https://github.com/SubBoost/subboost/releases/download/dev/release.json";
    process.env.SUBBOOST_INSTALLER_UPDATE_RELEASE_URL =
      "https://github.com/SubBoost/subboost/releases/download/dev/release.json";
    process.env.SUBBOOST_INSTALLER_COMPOSE_URL =
      "https://github.com/SubBoost/subboost/releases/download/dev/docker-compose.image.yml";
    process.env.SUBBOOST_INSTALLER_MANAGER_URL =
      "https://github.com/SubBoost/subboost/releases/download/dev/subboost-manager";
    process.env.SUBBOOST_INSTALLER_IMAGE = "ghcr.io/subboost/subboost:dev";

    expect(publicReleaseAssets.parseArgs([])).toMatchObject({
      baseUrl: "https://github.com/SubBoost/subboost/releases/download/v9.8.7",
      buildSha: "fedcba9876543210",
      image: "ghcr.io/subboost/subboost@sha256:envdigest",
      imageRepository: "ghcr.io/env/subboost",
      imageTag: "ghcr.io/env/subboost:v9.8.7",
      installerComposeUrl: "https://github.com/SubBoost/subboost/releases/download/dev/docker-compose.image.yml",
      installerImage: "ghcr.io/subboost/subboost:dev",
      installerManagerUrl: "https://github.com/SubBoost/subboost/releases/download/dev/subboost-manager",
      installerReleaseUrl: "https://github.com/SubBoost/subboost/releases/download/dev/release.json",
      installerUpdateReleaseUrl: "https://github.com/SubBoost/subboost/releases/download/dev/release.json",
      output: "dist/from-env",
      releaseTag: "v9.8.7",
    });
    expect(publicReleaseAssets.parseArgs(["-h"])).toMatchObject({ help: true });
    expect(publicReleaseAssets.usage()).toContain("GitHub Release assets");
    expect(() => publicReleaseAssets.parseArgs(["--image-repository", ""])).toThrow("--image-repository cannot be empty");
    expect(() => publicReleaseAssets.parseArgs(["--image-tag", ""])).toThrow("--image-tag cannot be empty");
    expect(() => publicReleaseAssets.parseArgs(["--tag", ""])).toThrow("--tag cannot be empty");
    expect(() => publicReleaseAssets.parseArgs(["--build-sha", ""])).toThrow("--build-sha cannot be empty");
    expect(() => publicReleaseAssets.parseArgs(["--installer-image", ""])).toThrow(
      "--installer-image cannot be empty"
    );
    expect(publicReleaseAssets.parseArgs(["--base-url"])).toMatchObject({ baseUrl: "" });
  });

  it("rewrites installer defaults for the dev channel and rejects drifted constants", () => {
    withTempVersionRepo((root) => {
      const publicRoot = join(root, "public");
      const args = publicReleaseAssets.parseArgs([
        "--output",
        "dist/dev-assets",
        "--image",
        "ghcr.io/subboost/subboost@sha256:devdigest",
        "--image-tag",
        "ghcr.io/subboost/subboost:dev",
        "--release-tag",
        "dev",
        "--build-sha",
        "abcdef1234567890",
        "--base-url",
        "https://github.com/SubBoost/subboost/releases/download/dev",
        "--installer-release-url",
        "https://github.com/SubBoost/subboost/releases/download/dev/release.json",
        "--installer-update-release-url",
        "https://github.com/SubBoost/subboost/releases/download/dev/release.json",
        "--installer-compose-url",
        "https://github.com/SubBoost/subboost/releases/download/dev/docker-compose.image.yml",
        "--installer-manager-url",
        "https://github.com/SubBoost/subboost/releases/download/dev/subboost-manager",
        "--installer-image",
        "ghcr.io/subboost/subboost:dev",
      ]);

      const bundle = publicReleaseAssets.createBundle(publicRoot, args);
      const installScript = readFileSync(join(bundle.output, "install.sh"), "utf8");
      expect(installScript).toContain(
        'DEFAULT_RELEASE_URL="https://github.com/SubBoost/subboost/releases/download/dev/release.json"'
      );
      expect(installScript).toContain(
        'DEFAULT_UPDATE_RELEASE_URL="https://github.com/SubBoost/subboost/releases/download/dev/release.json"'
      );
      expect(installScript).toContain(
        'DEFAULT_COMPOSE_URL="https://github.com/SubBoost/subboost/releases/download/dev/docker-compose.image.yml"'
      );
      expect(installScript).toContain(
        'DEFAULT_MANAGER_URL="https://github.com/SubBoost/subboost/releases/download/dev/subboost-manager"'
      );
      expect(installScript).toContain('DEFAULT_IMAGE="ghcr.io/subboost/subboost:dev"');
      expect(installScript).not.toContain("releases/latest/download");
      expect(JSON.parse(readFileSync(join(bundle.output, "release.json"), "utf8"))).toMatchObject({
        image: "ghcr.io/subboost/subboost@sha256:devdigest",
        imageTag: "ghcr.io/subboost/subboost:dev",
        installerUrl: "https://github.com/SubBoost/subboost/releases/download/dev/install.sh",
      });

      expect(() => publicReleaseAssets.rewriteInstallerDefaults('DEFAULT_IMAGE="changed"\n', args)).toThrow(
        "Expected exactly one DEFAULT_RELEASE_URL assignment in install.sh, found 0"
      );
      expect(() =>
        publicReleaseAssets.rewriteInstallerDefaults(
          [
            'DEFAULT_RELEASE_URL="https://github.com/SubBoost/subboost/releases/latest/download/release.json"',
            'DEFAULT_RELEASE_URL="https://github.com/SubBoost/subboost/releases/latest/download/release.json"',
          ].join("\n"),
          args
        )
      ).toThrow("Expected exactly one DEFAULT_RELEASE_URL assignment in install.sh, found 2");
    });
  }, TEMP_REPO_TEST_TIMEOUT_MS);

  it("prints public CLI help and dry-run output without writing files", () => {
    withTempVersionRepo((root) => {
      const publicRoot = join(root, "public");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      publicReleaseAssets.main(["--help"], { root: publicRoot });
      publicReleaseAssets.main(
        [
          "--dry-run",
          "--build-sha",
          "abcdef1234567890",
          "--image",
          "ghcr.io/subboost/subboost@sha256:abc123",
          "--image-tag",
          "ghcr.io/subboost/subboost:v9.8.7",
          "--output",
          "dist/dry-run",
          "--tag",
          "v9.8.7",
        ],
        { root: publicRoot }
      );

      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Usage:");
      expect(output).toContain("[selfhost-release-assets] output=");
      expect(output).toContain("ghcr.io/subboost/subboost@sha256:abc123");
      expect(output).toContain('"managerUrl": "subboost-manager"');
      expect(existsSync(join(publicRoot, "dist", "dry-run"))).toBe(false);
    });
  }, TEMP_REPO_TEST_TIMEOUT_MS);

  it("reports invalid public release asset metadata and uses default CLI dependencies", () => {
    withTempVersionRepo((root) => {
      const publicRoot = join(root, "public");
      writeFileSync(join(publicRoot, "package.json"), JSON.stringify({ name: "subboost" }), "utf8");
      expect(() =>
        publicReleaseAssets.buildManifest(publicRoot, publicReleaseAssets.parseArgs(["--build-sha", "abcdef"]))
      ).toThrow("package.json is missing version");
    });

    const root = mkdtempSync(join(tmpdir(), "subboost-release-assets-nogit-"));
    const previousCwd = process.cwd();
    try {
      writeText(root, "package.json", JSON.stringify({ version: "1.2.3" }));
      writeText(root, "local/Dockerfile", "FROM node:24-alpine\n");
      writeText(
        root,
        "local/docker-compose.image.yml",
        "services:\n  app:\n    image: ${SUBBOOST_IMAGE:?set SUBBOOST_IMAGE}\n",
      );
      writeText(root, "local/scripts/install.sh", "#!/usr/bin/env bash\necho install\n");
      writeText(root, "local/scripts/subboost.sh", "#!/usr/bin/env bash\necho subboost\n");

      expect(() => publicReleaseAssets.buildManifest(root, publicReleaseAssets.parseArgs([]))).toThrow(
        "git rev-parse HEAD failed"
      );

      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      process.chdir(root);
      publicReleaseAssets.main(["--help"]);
      publicReleaseAssets.main([
        "--dry-run",
        "--build-sha",
        "abcdef1234567890",
        "--image-tag",
        "ghcr.io/subboost/subboost:v1.2.3",
      ]);
      publicReleaseAssets.main([
        "--build-sha",
        "abcdef1234567890",
        "--image-tag",
        "ghcr.io/subboost/subboost:v1.2.3",
        "--output",
        "dist/real",
      ]);

      const output = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(output).toContain("Usage:");
      expect(output).toContain("[selfhost-release-assets] image=ghcr.io/subboost/subboost:v1.2.3");
      expect(existsSync(join(root, "dist", "real", "release.json"))).toBe(true);
      log.mockRestore();
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  }, TEMP_REPO_TEST_TIMEOUT_MS);
});
