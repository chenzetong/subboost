import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedNode } from "../../../packages/core/src/types/node";
import { SOURCE_IDS_KEY } from "../../../packages/core/src/subscription/node-source-state";
import { refreshNodeSnapshot } from "../../../packages/server-core/src/subscription/refresh-node-snapshot";

type RefreshNodeSnapshotOptions = Parameters<typeof refreshNodeSnapshot>[0];
type FetchUrlNodes = RefreshNodeSnapshotOptions["fetchUrlNodes"];
type FetchUrlUserInfo = NonNullable<RefreshNodeSnapshotOptions["fetchUrlUserInfo"]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

const baseNode: ParsedNode = {
  name: "Node",
  type: "trojan",
  server: "node.example.com",
  port: 443,
  password: "secret",
};

describe("public server-core rules extra branch coverage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@subboost/core/rules-database");
    vi.doUnmock("@subboost/core/generator/proxy-group-modules");
    vi.resetModules();
  });

  it("builds catalog diffs with unusual curated and module rule records", async () => {
    vi.doMock("@subboost/core/rules-database", () => ({
      ALL_RULES: [
        {
          id: "dup",
          name: "Duplicate",
          nameZh: "Duplicate",
          category: "missing-category",
          behavior: "domain",
          format: "mrs",
          url: "https://rules.example.com/not-a-rule.txt",
        },
        {
          id: "dup",
          name: "Remote Missing",
          nameZh: "Remote Missing",
          category: "other",
          behavior: "domain",
          format: "mrs",
          url: "https://rules.example.com/geo/geosite/remote-missing.mrs",
        },
      ],
    }));
    vi.doMock("@subboost/core/generator/proxy-group-modules", () => ({
      PROXY_GROUP_MODULES: [
        {
          id: "module-a",
          rules: [
            { id: "bad", path: "plain.txt" },
            { id: "duplicate", path: "geosite/module-missing.mrs" },
            { id: "duplicate", path: "geosite/module-missing.mrs" },
          ],
        },
      ],
    }));

    const { buildRuleCatalogDiff } = await import("../../../packages/server-core/src/rules/index");

    const diff = buildRuleCatalogDiff({
      geosite: ["remote-only"],
      geoip: [],
      fetchedAt: 100,
      expiresAt: 200,
      source: "remote",
    });

    expect(diff.unknownCategories).toEqual([{ id: "dup", category: "missing-category" }]);
    expect(diff.duplicateCuratedRuleIds).toEqual(["dup"]);
    expect(diff.missingCuratedRules).toEqual([{ id: "dup", path: "geosite/remote-missing.mrs" }]);
    expect(diff.missingModuleRuleRefs).toEqual([
      { id: "duplicate", path: "geosite/module-missing.mrs", owner: "module-a" },
    ]);
  });

  it("uses global fetch fallback and reports non-Error unavailable failures", async () => {
    vi.doUnmock("@subboost/core/rules-database");
    vi.doUnmock("@subboost/core/generator/proxy-group-modules");
    vi.resetModules();

    let now = 1_000;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ sha: "meta", tree: [{ path: "geo", type: "tree", sha: "geo-sha" }] }))
      .mockResolvedValueOnce(jsonResponse({ sha: "geo-sha", tree: [{ path: "geosite/google.mrs", type: "blob", sha: "1" }] }))
      .mockRejectedValueOnce("string boom");

    const { createRuleCatalogService, RuleIndexUnavailableError } = await import(
      "../../../packages/server-core/src/rules/index"
    );
    const service = createRuleCatalogService({ now: () => now, cacheTtlMs: 1 });

    await expect(service.getRemoteRuleIndex()).resolves.toMatchObject({
      source: "remote",
      geosite: ["google"],
    });

    now = 2_000;
    await expect(service.getRemoteRuleIndex({ allowStale: false })).rejects.toMatchObject({
      name: "RuleIndexUnavailableError",
      message: "string boom",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new RuleIndexUnavailableError()).toHaveProperty("name", "RuleIndexUnavailableError");
  });

  it("returns non-Error stale refresh messages and fails CN discovery without stale cache", async () => {
    vi.doUnmock("@subboost/core/rules-database");
    vi.doUnmock("@subboost/core/generator/proxy-group-modules");
    vi.resetModules();

    let fail = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (fail) throw "refresh string failure";
      if (url.includes("/git/trees/meta") && !url.includes("recursive=1")) {
        return jsonResponse({ sha: "meta", tree: [{ path: "geo", type: "tree", sha: "geo-sha" }] });
      }
      if (url.includes("/git/trees/geo-sha")) {
        return jsonResponse({
          sha: "geo-sha",
          tree: [
            { path: "geosite/google.mrs", type: "blob", sha: "1" },
            { path: "geosite/google-cn.mrs", type: "blob", sha: "2" },
          ],
        });
      }
      if (url.endsWith("/geosite/google-cn.list")) throw "list string failure";
      return textResponse("", 404);
    }) as unknown as typeof fetch;
    const { createRuleCatalogService, RuleIndexUnavailableError } = await import(
      "../../../packages/server-core/src/rules/index"
    );
    const service = createRuleCatalogService({ fetchImpl, now: () => 1_000, cacheTtlMs: 1 });

    await expect(service.refreshRuleIndex({ force: true })).resolves.toMatchObject({ status: "refreshed" });
    fail = true;
    await expect(service.refreshRuleIndex({ force: true })).resolves.toMatchObject({
      status: "stale",
      error: "refresh string failure",
    });

    const failingDiscovery = createRuleCatalogService({ fetchImpl });
    fail = false;
    await expect(failingDiscovery.getCnRuleCandidateDiscovery({ moduleIds: ["google"] })).rejects.toBeInstanceOf(
      RuleIndexUnavailableError,
    );
  });
});

describe("public refreshNodeSnapshot extra branch coverage", () => {
  it("clears stale source userinfo and skips optional supplemental userinfo fetches", async () => {
    const fetchUrlNodes = vi.fn(async () => ({
      ok: true,
      nodes: [{ ...baseNode, name: "URL Node" }],
      headers: {},
    }));
    const result = await refreshNodeSnapshot({
      config: {
        sources: [
          {
            id: "url",
            type: "url",
            content: "https://url.example.com/sub",
            subscriptionUserInfo: { upload: 1, total: 2 },
          },
        ],
      },
      urls: [],
      storedNodes: [],
      fetchUrlNodes,
    });

    expect(result.usedUrlFetch).toBe(true);
    expect(result.savedSources[0]).not.toHaveProperty("subscriptionUserInfo");
  });

  it("uses provider-only supplemental metadata without detaching unrelated source nodes", async () => {
    const result = await refreshNodeSnapshot({
      config: {
        sources: [
          {
            id: "provider",
            type: "url",
            content: "https://provider.example.com/sub",
            useProxyProviders: true,
            userinfoUserAgent: "SubBoost Test",
          },
        ],
      },
      urls: [],
      storedNodes: [
        { ...baseNode, name: "Manual", server: "manual.example.com" },
      ],
      fetchUrlNodes: vi.fn(),
      fetchUrlUserInfo: vi.fn(async () => ({
        "profile-web-page-url": "https://profile.example.com/",
      })),
    });

    expect(result.nodes.map((node) => node.name)).toEqual(["Manual"]);
    expect(result.detachedSourceCount).toBe(0);
    expect(result.refreshedSourceCount).toBe(0);
    expect(result.subscriptionInfo).toEqual({ profileWebPageUrl: "https://profile.example.com/" });
  });

  it("records static parse errors and empty static sources through the persisted source path", async () => {
    const result = await refreshNodeSnapshot({
      config: {
        sources: [
          { id: "empty", type: "yaml", content: "proxies: []" },
          { id: "bad", type: "nodes", content: "ss://%%%%" },
        ],
      },
      urls: [],
      storedNodes: [],
      fetchUrlNodes: vi.fn(),
    });

    expect(result.refreshedStaticSourceCount).toBe(0);
    expect(result.failedSources).toEqual([
      expect.objectContaining({ id: "empty", errorMessage: "未解析到可用节点", errorCategory: "parse" }),
      expect.objectContaining({ id: "bad", errorCategory: "parse" }),
    ]);
  });

  it("merges URL userinfo while skipping unnecessary supplemental fetches and conflicting metadata", async () => {
    const fetchUrlNodes = vi.fn(async (source: Parameters<FetchUrlNodes>[0]): ReturnType<FetchUrlNodes> => {
      const headers: Record<string, string> =
        source.id === "url-a"
          ? {
              "subscription-userinfo": "upload=2048; download=4096; total=1048576",
              "profile-web-page-url": "https://profile-a.example.com/",
              "plan-name": "Plan A",
            }
          : source.id === "url-b"
            ? {
                "subscription-userinfo": "upload=8192; download=16384; total=2097152",
                "profile-web-page-url": "https://profile-b.example.com/",
                "plan-name": "Plan B",
              }
            : {};
      return {
        ok: true,
        nodes: [{ ...baseNode, name: `Node ${source.id}`, server: `${source.id}.example.com` }],
        headers,
      };
    });
    const fetchUrlUserInfo = vi.fn(async (source: Parameters<FetchUrlUserInfo>[0]): ReturnType<FetchUrlUserInfo> => {
      if (source.id === "provider") {
        return {
          "subscription-userinfo": "upload=32768; download=65536; total=4194304",
          "profile-web-page-url": "https://provider-profile.example.com/",
        };
      }
      if (source.id === "url-e") return undefined;
      return {
        "subscription-userinfo": "upload=131072; download=262144; total=8388608",
      };
    });

    const result = await refreshNodeSnapshot({
      config: {
        sources: [
          { id: "url-a", type: "url", content: "https://a.example.com/sub" },
          { id: "url-b", type: "url", content: "https://b.example.com/sub" },
          {
            id: "provider",
            type: "url",
            content: "https://provider.example.com/sub",
            useProxyProviders: true,
            userinfoUserAgent: "SubBoost Test",
          },
          { id: "url-d", type: "url", content: "https://d.example.com/sub" },
          {
            id: "url-e",
            type: "url",
            content: "https://e.example.com/sub",
            userinfoUrl: "https://e.example.com/userinfo",
          },
        ],
      },
      urls: [],
      storedNodes: [],
      fetchUrlNodes,
      fetchUrlUserInfo,
    });

    expect(fetchUrlNodes).toHaveBeenCalledTimes(4);
    expect(fetchUrlUserInfo).toHaveBeenCalledTimes(2);
    expect(fetchUrlUserInfo).toHaveBeenCalledWith(expect.objectContaining({ id: "provider" }));
    expect(fetchUrlUserInfo).toHaveBeenCalledWith(expect.objectContaining({ id: "url-e" }));
    expect(fetchUrlUserInfo).not.toHaveBeenCalledWith(expect.objectContaining({ id: "url-d" }));
    expect(result.subscriptionInfo.upload).toBeGreaterThan(0);
    expect(result.subscriptionInfo.download).toBeGreaterThan(0);
    expect(result.subscriptionInfo.total).toBeGreaterThan(0);
    expect(result.subscriptionInfo).not.toHaveProperty("profileWebPageUrl");
    expect(result.subscriptionInfo).not.toHaveProperty("planName");
    expect(result.savedSources.find((source) => source.id === "url-a")).toHaveProperty("subscriptionUserInfo");
    expect(result.savedSources.find((source) => source.id === "url-e")).not.toHaveProperty("subscriptionUserInfo");
  });
});
