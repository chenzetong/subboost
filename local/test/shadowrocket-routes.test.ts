import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as rules } from "../app/api/rules/shadowrocket/[type]/[name]/route";
import { GET as conf } from "../app/api/subscriptions/[id]/config.conf/route";
import { ShadowrocketRuleListError } from "../src/lib/shadowrocket-rule-list";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), generate: vi.fn(), key: vi.fn(), limit: vi.fn() }));
vi.mock("@local/lib/shadowrocket-rule-list", async (original) => ({
  ...await original<typeof import("../src/lib/shadowrocket-rule-list")>(), fetchShadowrocketRuleList: mocks.fetch,
}));
vi.mock("@local/lib/subscription-service", () => ({ generateSubscriptionShadowrocketConf: mocks.generate }));
vi.mock("@local/lib/rate-limit", () => ({
  getTrustedClientRateLimitKey: mocks.key,
  consumeLocalRateLimit: mocks.limit,
  hashLocalRateLimitKey: (value: string) => `hashed-${value}`,
  localRateLimitResponse: () => Response.json({}, { status: 429 }),
}));
const request = () => new Request("https://app.test/api/test");
const ruleContext = (type = "geosite") => ({ params: Promise.resolve({ type, name: "example" }) });
const confContext = () => ({ params: Promise.resolve({ id: "test-token" }) });

describe("Shadowrocket HTTP contracts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.key.mockReturnValue("client");
    mocks.limit.mockReturnValue({ allowed: true });
    mocks.fetch.mockResolvedValue({ content: "DOMAIN,example.test\n", inputLines: 2, outputLines: 1, skippedLines: 1 });
    mocks.generate.mockResolvedValue({
      conf: "[Rule]\nFINAL,PROXY\n", name: "Test", metrics: { proxiesEmbedded: 0, rulesWritten: 1 },
      diagnostics: [{ severity: "info" }, { severity: "warning" }, { severity: "error" }],
      cacheExpirySeconds: 300, autoUpdateIntervalSeconds: null, isAdmin: true, subscriptionInfo: {},
    });
  });
  it.each(["geosite", "geoip"])("serves safe cached %s rule lists", async (type) => {
    if (type === "geoip") mocks.key.mockReturnValue(null);
    const response = await rules(request(), ruleContext(type));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("DOMAIN,example.test\n");
    expect(response.headers.get("x-subboost-skipped-lines")).toBe("1");
    expect(response.headers.get("cache-control")).toContain("public");
    expect(mocks.fetch).toHaveBeenCalledWith(type, "example");
  });
  it("rejects invalid kinds and rate limits before fetching", async () => {
    expect((await rules(request(), ruleContext("invalid"))).status).toBe(400);
    mocks.limit.mockReturnValue({ allowed: false, retryAfterSeconds: 60 });
    expect((await rules(request(), ruleContext())).status).toBe(429);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([400, 404, 413, 502, 504])("preserves rule error status %s", async (status) => {
    mocks.fetch.mockRejectedValue(new ShadowrocketRuleListError("Safe error", status));
    expect((await rules(request(), ruleContext())).status).toBe(status);
  });
  it("hides unexpected rule errors", async () => {
    mocks.fetch.mockRejectedValue(new Error("private detail"));
    const response = await rules(request(), ruleContext());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private detail");
  });
  it.each(["client", null])("serves CONF without caching credentials for client %s", async (key) => {
    mocks.key.mockReturnValue(key);
    const response = await conf(request(), confContext());
    expect(await response.text()).toBe("[Rule]\nFINAL,PROXY\n");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-subboost-shadowrocket-warnings")).toBe("2");
    expect(mocks.generate).toHaveBeenCalledWith("test-token");
  });
  it("rejects client and token quota exhaustion before generation", async () => {
    mocks.limit.mockReturnValueOnce({ allowed: false });
    expect((await conf(request(), confContext())).status).toBe(429);
    mocks.limit.mockReturnValueOnce({ allowed: true }).mockReturnValueOnce({ allowed: false });
    expect((await conf(request(), confContext())).status).toBe(429);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("returns 404 for missing or empty subscriptions", async () => {
    mocks.generate.mockResolvedValue(null);
    expect((await conf(request(), confContext())).status).toBe(404);
  });
});
