import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

describe("rule catalog deduplication and cache behavior", () => {
  afterEach(() => {
    vi.doUnmock("@subboost/core/generator/proxy-group-modules");
    vi.doUnmock("@subboost/core/rules/cn-candidate-utils");
    vi.doUnmock("@subboost/core/rules-database");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("deduplicates repeated variants, sorts diagnostics, and reuses its fresh inner cache", async () => {
    vi.resetModules();
    vi.doMock("@subboost/core/generator/proxy-group-modules", () => ({
      PROXY_GROUP_MODULES: [
        {
          id: "module-b",
          category: "media",
          rules: [{ id: "parent-b", behavior: "domain", path: "geosite/parent-b.mrs" }],
        },
        {
          id: "module-a",
          category: "media",
          rules: [{ id: "parent-a", behavior: "domain", path: "geosite/parent-a.mrs" }],
        },
      ],
    }));
    vi.doMock("@subboost/core/rules-database", () => ({
      ALL_RULES: [
        {
          id: "duplicate-b",
          name: "Duplicate B",
          nameZh: "Duplicate B",
          category: "other",
          behavior: "domain",
          format: "mrs",
          url: "https://local.subboost.test/geosite/duplicate-b.mrs",
        },
        {
          id: "duplicate-b",
          name: "Duplicate B copy",
          nameZh: "Duplicate B copy",
          category: "other",
          behavior: "domain",
          format: "mrs",
          url: "https://local.subboost.test/geosite/duplicate-b.mrs",
        },
        {
          id: "duplicate-a",
          name: "Duplicate A",
          nameZh: "Duplicate A",
          category: "other",
          behavior: "domain",
          format: "mrs",
          url: "https://local.subboost.test/geosite/duplicate-a.mrs",
        },
        {
          id: "duplicate-a",
          name: "Duplicate A copy",
          nameZh: "Duplicate A copy",
          category: "other",
          behavior: "domain",
          format: "mrs",
          url: "https://local.subboost.test/geosite/duplicate-a.mrs",
        },
      ],
    }));
    vi.doMock("@subboost/core/rules/cn-candidate-utils", async () => {
      const actual = await vi.importActual<
        typeof import("../../../packages/core/src/rules/cn-candidate-utils")
      >("@subboost/core/rules/cn-candidate-utils");
      return {
        ...actual,
        buildCnRuleVariantIds: () => [
          { id: "duplicate-cn", variantKind: "dash-cn" as const },
          { id: "duplicate-cn", variantKind: "dash-cn" as const },
        ],
      };
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/git/trees/") && !url.includes("recursive=1")) {
        return jsonResponse({ sha: "meta", tree: [{ path: "geo", type: "tree", sha: "geo-sha" }] });
      }
      if (url.includes("/git/trees/geo-sha")) {
        return jsonResponse({
          sha: "geo-sha",
          tree: [
            { path: "geosite/.mrs", type: "blob", sha: "empty" },
            { path: "geosite/zeta.mrs", type: "blob", sha: "zeta" },
            { path: "geosite/alpha.mrs", type: "blob", sha: "alpha" },
            { path: "geosite/duplicate-cn.mrs", type: "blob", sha: "duplicate" },
            { path: "geosite/geolocation-cn.mrs", type: "blob", sha: "cn" },
          ],
        });
      }
      if (url.endsWith(".list")) return textResponse("DOMAIN,local.subboost.test\n");
      return textResponse("");
    });

    const { buildRuleCatalogDiff, createRuleCatalogService, extractRemoteRuleNames } = await import(
      "../../../packages/server-core/src/rules/index"
    );

    expect(
      extractRemoteRuleNames(
        [
          { path: "geosite/.mrs", type: "blob", sha: "empty" },
          { path: "geosite/zeta.mrs", type: "blob", sha: "zeta" },
          { path: "geosite/alpha.mrs", type: "blob", sha: "alpha" },
        ],
        "geosite"
      )
    ).toEqual(["alpha", "zeta"]);

    expect(
      buildRuleCatalogDiff({
        geosite: [],
        geoip: [],
        fetchedAt: 1_000,
        expiresAt: 11_000,
        source: "remote",
      }).duplicateCuratedRuleIds
    ).toEqual(["duplicate-a", "duplicate-b"]);

    const service = createRuleCatalogService({ now: () => 1_000, cacheTtlMs: 10_000 });
    await expect(service.getRemoteRuleIndex()).resolves.toMatchObject({
      geosite: ["alpha", "duplicate-cn", "geolocation-cn", "zeta"],
      source: "remote",
    });
    const fetchCountAfterInitialIndex = fetchMock.mock.calls.length;

    await expect(service.getRemoteRuleIndex({ now: 20_000 })).resolves.toMatchObject({ source: "remote" });
    expect(fetchMock).toHaveBeenCalledTimes(fetchCountAfterInitialIndex);

    const discovery = await service.getCnRuleCandidateDiscovery({
      moduleIds: ["module-b", "module-a"],
    });
    expect(discovery.parents).toHaveLength(2);
    expect(discovery.allItems).toHaveLength(2);
    expect(discovery.allItems.map((item) => item.parentModuleId).sort()).toEqual(["module-a", "module-b"]);
  });
});
