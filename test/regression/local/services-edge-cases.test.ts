import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDefaultSubBoostTemplateConfig: vi.fn(),
  buildSubscriptionCacheExpiry: vi.fn(),
  buildSubscriptionFetchCallbacks: vi.fn(),
  builtinIdToType: vi.fn(),
  createCronUpdateAccumulator: vi.fn(),
  decryptJsonObject: vi.fn(),
  encryptJson: vi.fn(),
  extractHostsFromSubscriptionUrls: vi.fn(),
  finalizeCronUpdateSummary: vi.fn(),
  getBuiltinTemplateId: vi.fn(),
  getBuiltinTemplateSummaryMetadata: vi.fn(),
  getTemplateList: vi.fn(),
  prepareRefreshCacheResult: vi.fn(),
  readSubscriptionSecrets: vi.fn(),
  refreshNodeSnapshot: vi.fn(),
  resolveAutomaticRefreshCompletionDecision: vi.fn(),
  resolveAutomaticRefreshFailureAnalysis: vi.fn(),
  resolveAutomaticRefreshUnexpectedFailureCompletion: vi.fn(),
  resolveAutoUpdateScheduleState: vi.fn(),
  resolveSubscriptionAutoUpdateState: vi.fn(),
  applyCronUpdateOutcome: vi.fn(),
  recordCronUpdateSkipped: vi.fn(),
  validateSubBoostTemplateConfig: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    localTemplate: {
      create: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    subscription: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    subscriptionAutoUpdateState: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@subboost/core/config/defaults", () => ({
  buildDefaultSubBoostTemplateConfig: mocks.buildDefaultSubBoostTemplateConfig,
}));
vi.mock("@subboost/core/templates/builtin", () => ({
  builtinIdToType: mocks.builtinIdToType,
  getBuiltinTemplateId: mocks.getBuiltinTemplateId,
  getBuiltinTemplateSummaryMetadata: mocks.getBuiltinTemplateSummaryMetadata,
}));
vi.mock("@subboost/core/templates", () => ({ getTemplateList: mocks.getTemplateList }));
vi.mock("@subboost/core/templates/config-template", () => ({
  validateSubBoostTemplateConfig: mocks.validateSubBoostTemplateConfig,
}));
vi.mock("../../../local/src/lib/crypto", () => ({
  decryptJsonObject: mocks.decryptJsonObject,
  encryptJson: mocks.encryptJson,
}));
vi.mock("../../../local/src/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../../../local/src/lib/subscription-service", () => ({
  buildSubscriptionCacheExpiry: mocks.buildSubscriptionCacheExpiry,
  buildSubscriptionFetchCallbacks: mocks.buildSubscriptionFetchCallbacks,
  MAX_NODES_PER_SUBSCRIPTION: 500,
  readSubscriptionSecrets: mocks.readSubscriptionSecrets,
}));
vi.mock("@subboost/server-core/subscription", () => ({
  applyCronUpdateOutcome: mocks.applyCronUpdateOutcome,
  createCronUpdateAccumulator: mocks.createCronUpdateAccumulator,
  extractHostsFromSubscriptionUrls: mocks.extractHostsFromSubscriptionUrls,
  finalizeCronUpdateSummary: mocks.finalizeCronUpdateSummary,
  prepareRefreshCacheResult: mocks.prepareRefreshCacheResult,
  recordCronUpdateSkipped: mocks.recordCronUpdateSkipped,
  refreshNodeSnapshot: mocks.refreshNodeSnapshot,
  resolveAutomaticRefreshCompletionDecision: mocks.resolveAutomaticRefreshCompletionDecision,
  resolveAutomaticRefreshFailureAnalysis: mocks.resolveAutomaticRefreshFailureAnalysis,
  resolveAutomaticRefreshUnexpectedFailureCompletion: mocks.resolveAutomaticRefreshUnexpectedFailureCompletion,
  resolveAutoUpdateScheduleState: mocks.resolveAutoUpdateScheduleState,
  resolveSubscriptionAutoUpdateState: mocks.resolveSubscriptionAutoUpdateState,
}));

import {
  createTemplate,
  getTemplateDetail,
  listTemplates,
} from "../../../local/src/lib/template-service";
import { runLocalSubscriptionAutoUpdateCron } from "../../../local/src/lib/auto-update-service";

const now = new Date("2026-06-14T00:00:00.000Z");

function localTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "local-1",
    ownerId: "owner-1",
    name: "Local Template",
    description: null,
    encryptedConfig: "encrypted",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides,
  };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    name: "Main",
    ownerId: "owner-1",
    owner: { username: null },
    autoUpdateInterval: "bad",
    createdAt: new Date("2026-06-13T00:00:00.000Z"),
    lastUpdatedAt: null,
    updatedAt: new Date("2026-06-13T00:00:00.000Z"),
    autoUpdateState: null,
    ...overrides,
  };
}

describe("public local services remaining branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    mocks.getTemplateList.mockReturnValue([
      { id: "minimal", name: "Minimal", description: "small", groupCount: 1, ruleCount: 2 },
    ]);
    mocks.getBuiltinTemplateId.mockImplementation((id: string) => `builtin-${id}`);
    mocks.getBuiltinTemplateSummaryMetadata.mockReturnValue({
      downloads: 0,
      engagementCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      tags: ["官方"],
      isOfficial: true,
      isPublic: true,
    });
    mocks.builtinIdToType.mockImplementation((id: string) => (id === "builtin-ghost" ? "ghost" : null));
    mocks.buildDefaultSubBoostTemplateConfig.mockImplementation((type: string) => ({ template: type }));
    mocks.decryptJsonObject.mockReturnValue({ enabledProxyGroups: "bad", ruleOrder: "bad" });
    mocks.encryptJson.mockImplementation((value) => ({ encrypted: value }));
    mocks.validateSubBoostTemplateConfig.mockReturnValue({ ok: true, config: { template: "minimal" } });

    mocks.createCronUpdateAccumulator.mockImplementation((total: number) => ({ total, outcomes: [], skipped: 0 }));
    mocks.recordCronUpdateSkipped.mockImplementation((acc) => {
      acc.skipped += 1;
    });
    mocks.applyCronUpdateOutcome.mockImplementation((acc, outcome) => {
      acc.outcomes.push(outcome);
    });
    mocks.finalizeCronUpdateSummary.mockImplementation((acc, options) => ({ ...acc, options }));
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.subscription.findMany.mockResolvedValue([subscription()]);
    mocks.prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.subscriptionAutoUpdateState.upsert.mockResolvedValue({ upsert: true });
    mocks.resolveSubscriptionAutoUpdateState.mockReturnValue({ lastAttemptedAt: null, externalFailureCount: 0 });
    mocks.resolveAutoUpdateScheduleState.mockReturnValue({ due: true });
    mocks.readSubscriptionSecrets.mockReturnValue({ config: {}, urls: ["https://airport.example/sub"], nodes: [] });
    mocks.extractHostsFromSubscriptionUrls.mockReturnValue(["airport.example"]);
    mocks.buildSubscriptionFetchCallbacks.mockReturnValue({ fetchSubscription: vi.fn() });
    mocks.refreshNodeSnapshot.mockResolvedValue({ savedSources: [] });
    mocks.resolveAutomaticRefreshFailureAnalysis.mockReturnValue({
      failureState: { externalFailureCount: 0 },
      failureReason: "",
    });
    mocks.prepareRefreshCacheResult.mockReturnValue({
      ok: true,
      cacheEntry: { nodes: [], subscriptionInfo: {} },
      nodeCount: 0,
    });
    mocks.resolveAutomaticRefreshCompletionDecision.mockReturnValue({
      kind: "success",
      nextAutoUpdateState: {
        state: { lastAttemptedAt: now, externalFailureCount: 0 },
        shouldDisableAutoUpdate: true,
      },
      outcome: { kind: "updated", subscriptionId: "sub-1" },
    });
    mocks.resolveAutomaticRefreshUnexpectedFailureCompletion.mockReturnValue({
      attemptedState: null,
      message: "unexpected",
      outcome: { kind: "failed", subscriptionId: "sub-1" },
    });
    mocks.buildSubscriptionCacheExpiry.mockReturnValue(new Date("2026-06-15T00:00:00.000Z"));
  });

  it("lists all built-in templates when ids are empty and falls back for missing builtin summaries", async () => {
    await expect(listTemplates(null, "default")).resolves.toEqual([
      expect.objectContaining({ id: "builtin-minimal", name: "Minimal" }),
    ]);

    await expect(getTemplateDetail(null, "builtin-ghost")).resolves.toEqual({
      id: "builtin-ghost",
      name: "ghost",
      description: "",
      kind: "config",
      config: { template: "ghost" },
    });
  });

  it("formats local templates with blank descriptions and non-array counts", async () => {
    mocks.prisma.localTemplate.findMany.mockResolvedValueOnce([localTemplateRow()]);

    await expect(listTemplates("owner-1", "my")).resolves.toEqual([
      expect.objectContaining({
        description: "",
        proxyGroupCount: null,
        ruleCount: null,
      }),
    ]);
    expect(mocks.prisma.localTemplate.findMany).toHaveBeenCalledWith({
      where: { ownerId: "owner-1" },
      orderBy: { updatedAt: "desc" },
    });
  });

  it("rejects overlong template names before validation", async () => {
    await expect(createTemplate("owner-1", { name: "x".repeat(101), config: {} })).rejects.toThrow("Invalid name.");
    expect(mocks.validateSubBoostTemplateConfig).not.toHaveBeenCalled();
  });

  it("persists successful local auto-refresh while disabling future auto updates", async () => {
    await runLocalSubscriptionAutoUpdateCron(now);

    expect(mocks.resolveAutoUpdateScheduleState).toHaveBeenCalledWith(expect.objectContaining({ intervalSeconds: 360 }));
    expect(mocks.prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "sub-1",
          updatedAt: new Date("2026-06-13T00:00:00.000Z"),
        }),
        data: expect.objectContaining({ autoUpdateInterval: null }),
      })
    );
    expect(console.info).toHaveBeenCalledWith(
      "[local-subscription-cron] updated",
      expect.objectContaining({ autoUpdateDisabled: true })
    );
  });

  it("records unexpected successful decisions for failed refresh cache preparation", async () => {
    mocks.prepareRefreshCacheResult.mockReturnValueOnce({ ok: false, reason: "no_nodes" });
    mocks.resolveAutomaticRefreshCompletionDecision.mockReturnValueOnce({
      kind: "success",
      outcome: { kind: "updated", subscriptionId: "sub-1" },
    });

    await runLocalSubscriptionAutoUpdateCron(now);

    expect(mocks.resolveAutomaticRefreshUnexpectedFailureCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: "Unexpected successful completion decision" }),
        requestedHosts: ["airport.example"],
      })
    );
  });

  it("logs unexpected failures without writing attempted state when none is provided", async () => {
    mocks.readSubscriptionSecrets.mockImplementationOnce(() => {
      throw new Error("decrypt failed");
    });

    await runLocalSubscriptionAutoUpdateCron(now);

    expect(mocks.prisma.subscriptionAutoUpdateState.upsert).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[local-subscription-cron] failed",
      expect.objectContaining({ message: "unexpected" })
    );
  });
});
