import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMetaCubeXRuleListUrl,
  isSafeMetaCubeXRuleName,
  ShadowrocketRuleListError,
  fetchShadowrocketRuleList,
} from "./shadowrocket-rule-list";

describe("shadowrocket rule list source", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("fetches fixed-origin text without following redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("+.example.test\n"));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchShadowrocketRuleList("geosite", "test")).resolves.toMatchObject({ content: "DOMAIN-SUFFIX,example.test\n" });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("raw.githubusercontent.com/MetaCubeX/"), expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });

  it.each([
    [new Response(null, { status: 404 }), 404],
    [new Response(null, { status: 500 }), 502],
    [new Response(null), 422],
    [new Response("# no rules"), 422],
    [new Response("x", { headers: { "content-length": String(8 * 1024 * 1024 + 1) } }), 413],
    [new Response(new Uint8Array(8 * 1024 * 1024 + 1)), 413],
  ])("bounds failed and oversized responses", async (response, status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(fetchShadowrocketRuleList("geoip", "test")).rejects.toMatchObject({ status });
  });

  it.each([new Error("network"), "unexpected"])("sanitizes transport failures", async (error) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(fetchShadowrocketRuleList("geosite", "test")).rejects.toMatchObject({ status: 502, message: "Failed to fetch MetaCubeX rule list." });
  });

  it("aborts stalled requests and clears the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const assertion = expect(fetchShadowrocketRuleList("geosite", "test")).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("builds only fixed MetaCubeX meta-branch URLs", () => {
    expect(buildMetaCubeXRuleListUrl("geosite", "category-ai-chat-!cn")).toBe(
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-chat-!cn.list"
    );
    expect(buildMetaCubeXRuleListUrl("geoip", "private")).toBe(
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.list"
    );
  });

  it("rejects path traversal and arbitrary URLs", () => {
    expect(isSafeMetaCubeXRuleName("anthropic")).toBe(true);
    expect(isSafeMetaCubeXRuleName("../secret")).toBe(false);
    expect(isSafeMetaCubeXRuleName("https://evil.example/x")).toBe(false);
    expect(() => buildMetaCubeXRuleListUrl("geosite", ".." )).toThrow(ShadowrocketRuleListError);
  });
});
