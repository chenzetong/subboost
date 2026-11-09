import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildCnRuleCandidateResponse: vi.fn((value) => value),
  buildCnRuleCandidateUnavailableResponse: vi.fn(() => ({ source: "unavailable" })),
  getCnRuleCandidateDiscovery: vi.fn(),
  normalizeRuleSearchType: vi.fn(() => "all"),
  parseCnRuleCandidateQuery: vi.fn(() => ({
    moduleIds: ["google"],
    excludedRuleKeys: [],
    debug: false,
  })),
  parsePagePagination: vi.fn(() => ({ page: 1, pageSize: 20 })),
  refreshRuleIndex: vi.fn(),
  requireLocalCronAuth: vi.fn(),
  searchRules: vi.fn(),
  RuleIndexUnavailableError: class RuleIndexUnavailableError extends Error {},
}));

vi.mock("@local/lib/cron-auth", () => ({
  requireLocalCronAuth: mocks.requireLocalCronAuth,
}));
vi.mock("@local/lib/rule-catalog", () => ({
  getCnRuleCandidateDiscovery: mocks.getCnRuleCandidateDiscovery,
  refreshRuleIndex: mocks.refreshRuleIndex,
  searchRules: mocks.searchRules,
}));
vi.mock("@subboost/core/api/pagination", () => ({
  parsePagePagination: mocks.parsePagePagination,
}));
vi.mock("@subboost/server-core/rules", () => ({
  buildCnRuleCandidateResponse: mocks.buildCnRuleCandidateResponse,
  buildCnRuleCandidateUnavailableResponse: mocks.buildCnRuleCandidateUnavailableResponse,
  normalizeRuleSearchType: mocks.normalizeRuleSearchType,
  parseCnRuleCandidateQuery: mocks.parseCnRuleCandidateQuery,
  RuleIndexUnavailableError: mocks.RuleIndexUnavailableError,
}));

import { POST as updateRuleIndex } from "../../../local/app/api/cron/update-rule-index/route";
import { GET as getCnCandidates } from "../../../local/app/api/rules/cn-candidates/route";
import { GET as searchRuleIndex } from "../../../local/app/api/rules/search/route";

const index = {
  source: "stale",
  fetchedAt: 1,
  expiresAt: 2,
};

describe("local rule route failure behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLocalCronAuth.mockReturnValue(null);
  });

  it("returns the cron authentication response without refreshing", async () => {
    const authError = new Response(JSON.stringify({ code: "UNAUTHORIZED" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    mocks.requireLocalCronAuth.mockReturnValue(authError);

    const response = await updateRuleIndex(
      new Request("http://local.subboost.test/api/cron/update-rule-index?force=1") as never,
    );

    expect(response).toBe(authError);
    expect(mocks.refreshRuleIndex).not.toHaveBeenCalled();
  });

  it("reports an unavailable rule index with a stable 503 response", async () => {
    mocks.refreshRuleIndex.mockResolvedValue({
      status: "unavailable",
      error: "remote index unavailable",
    });

    const response = await updateRuleIndex(
      new Request("http://local.subboost.test/api/cron/update-rule-index?force=1") as never,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      success: false,
      status: "unavailable",
      error: "remote index unavailable",
      code: "RULE_INDEX_UNAVAILABLE",
    });
    expect(mocks.refreshRuleIndex).toHaveBeenCalledWith({ force: true });
  });

  it("preserves a non-fatal refresh warning in a successful response", async () => {
    mocks.refreshRuleIndex.mockResolvedValue({
      status: "stale",
      index,
      diff: { missingCuratedRules: [] },
      error: "using verified stale index",
    });

    const response = await updateRuleIndex(
      new Request("http://local.subboost.test/api/cron/update-rule-index") as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      status: "stale",
      error: "using verified stale index",
    });
  });

  it("rethrows unexpected CN candidate discovery failures", async () => {
    const failure = new Error("database failed");
    mocks.getCnRuleCandidateDiscovery.mockRejectedValue(failure);

    await expect(getCnCandidates(
      new Request("http://local.subboost.test/api/rules/cn-candidates") as never,
    )).rejects.toBe(failure);
  });

  it("uses a blank keyword and rethrows unexpected search failures", async () => {
    const failure = new Error("catalog failed");
    mocks.searchRules.mockRejectedValue(failure);

    await expect(searchRuleIndex(
      new Request("http://local.subboost.test/api/rules/search") as never,
    )).rejects.toBe(failure);

    expect(mocks.searchRules).toHaveBeenCalledWith({
      keyword: "",
      type: "all",
      page: 1,
      size: 20,
      allowStale: true,
    });
  });
});
