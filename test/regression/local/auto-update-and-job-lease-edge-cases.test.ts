import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyCronUpdateOutcome: vi.fn(),
  buildSubscriptionCacheExpiry: vi.fn(),
  buildSubscriptionFetchCallbacks: vi.fn(),
  createCronUpdateAccumulator: vi.fn(),
  encryptJson: vi.fn(),
  extractHostsFromSubscriptionUrls: vi.fn(),
  finalizeCronUpdateSummary: vi.fn(),
  prepareRefreshCacheResult: vi.fn(),
  readSubscriptionSecrets: vi.fn(),
  recordCronUpdateSkipped: vi.fn(),
  refreshNodeSnapshot: vi.fn(),
  resolveAutomaticRefreshCompletionDecision: vi.fn(),
  resolveAutomaticRefreshFailureAnalysis: vi.fn(),
  resolveAutomaticRefreshUnexpectedFailureCompletion: vi.fn(),
  resolveAutoUpdateScheduleState: vi.fn(),
  resolveSubscriptionAutoUpdateState: vi.fn(),
  prisma: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    subscription: { findMany: vi.fn(), updateMany: vi.fn() },
    subscriptionAutoUpdateState: { upsert: vi.fn() },
  },
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

vi.mock("../../../local/src/lib/crypto", () => ({ encryptJson: mocks.encryptJson }));
vi.mock("../../../local/src/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../../../local/src/lib/subscription-service", () => ({
  buildSubscriptionCacheExpiry: mocks.buildSubscriptionCacheExpiry,
  buildSubscriptionFetchCallbacks: mocks.buildSubscriptionFetchCallbacks,
  MAX_NODES_PER_SUBSCRIPTION: 500,
  readSubscriptionSecrets: mocks.readSubscriptionSecrets,
}));

import { runLocalSubscriptionAutoUpdateCron } from "../../../local/src/lib/auto-update-service";
import {
  JobLeaseLostError,
  renewLocalJobLease,
  startLocalJobLeaseHeartbeat,
} from "../../../local/src/lib/job-lease";

const now = new Date("2026-08-01T00:00:00.000Z");

function subscription() {
  return {
    id: "sub-1",
    name: "Main",
    ownerId: "owner-1",
    owner: { username: "admin" },
    autoUpdateInterval: 600,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    lastUpdatedAt: null,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    autoUpdateState: null,
  };
}

function failureDecision(overrides: Record<string, unknown> = {}) {
  return {
    kind: "failure",
    attemptedState: { lastAttemptedAt: now },
    outcome: { status: "failed", requestedHosts: ["example.test"] },
    ...overrides,
  };
}

describe("local automatic update completion edge behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCronUpdateAccumulator.mockImplementation((total: number) => ({ total, outcomes: [] }));
    mocks.applyCronUpdateOutcome.mockImplementation((accumulator, outcome) => accumulator.outcomes.push(outcome));
    mocks.finalizeCronUpdateSummary.mockImplementation((accumulator) => accumulator);
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.subscription.findMany.mockResolvedValue([subscription()]);
    mocks.prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.subscriptionAutoUpdateState.upsert.mockResolvedValue({});
    mocks.resolveSubscriptionAutoUpdateState.mockReturnValue({ lastAttemptedAt: null });
    mocks.resolveAutoUpdateScheduleState.mockReturnValue({ due: true });
    mocks.readSubscriptionSecrets.mockReturnValue({
      config: {},
      urls: ["https://example.test/sub"],
      nodes: [],
    });
    mocks.extractHostsFromSubscriptionUrls.mockReturnValue(["example.test"]);
    mocks.buildSubscriptionFetchCallbacks.mockReturnValue({ fetchSubscription: vi.fn() });
    mocks.refreshNodeSnapshot.mockResolvedValue({ savedSources: [] });
    mocks.resolveAutomaticRefreshFailureAnalysis.mockReturnValue({
      failureState: { externalFailureCount: 1 },
      failureReason: "upstream failed",
    });
    mocks.prepareRefreshCacheResult.mockReturnValue({ ok: false, reason: "no_nodes" });
    mocks.resolveAutomaticRefreshCompletionDecision.mockReturnValue(failureDecision());
    mocks.resolveAutomaticRefreshUnexpectedFailureCompletion.mockReturnValue({
      attemptedState: null,
      message: "unexpected",
      outcome: { status: "failed", requestedHosts: ["example.test"] },
    });
    mocks.encryptJson.mockImplementation((value) => `encrypted:${JSON.stringify(value)}`);
    mocks.buildSubscriptionCacheExpiry.mockReturnValue(new Date("2026-08-02T00:00:00.000Z"));
  });

  it("keeps automatic updates enabled after a persisted all-sources failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.resolveAutomaticRefreshCompletionDecision.mockReturnValue({
      kind: "all_sources_failed",
      nextAutoUpdateState: {
        state: { lastAttemptedAt: now },
        shouldDisableAutoUpdate: false,
      },
      outcome: { status: "failed", requestedHosts: ["example.test"] },
    });

    await runLocalSubscriptionAutoUpdateCron(now);

    expect(mocks.prisma.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ autoUpdateInterval: null }),
    }));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns stale outcomes when all-sources failure persistence loses CAS", async () => {
    mocks.prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
    mocks.resolveAutomaticRefreshCompletionDecision.mockReturnValue({
      kind: "all_sources_failed",
      nextAutoUpdateState: {
        state: { lastAttemptedAt: now },
        shouldDisableAutoUpdate: true,
      },
      outcome: { status: "failed", requestedHosts: ["example.test"] },
    });

    const summary = await runLocalSubscriptionAutoUpdateCron(now) as any;

    expect(summary.outcomes).toContainEqual({
      status: "skipped",
      requestedHosts: ["example.test"],
      recordHosts: false,
    });
    expect(mocks.prisma.subscriptionAutoUpdateState.upsert).not.toHaveBeenCalled();
  });

  it("returns stale outcomes when ordinary failure persistence loses CAS", async () => {
    mocks.prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    const summary = await runLocalSubscriptionAutoUpdateCron(now) as any;

    expect(summary.outcomes).toContainEqual(expect.objectContaining({
      status: "skipped",
      recordHosts: false,
    }));
  });

  it("detects a success result that changes into a failed cache result", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let reads = 0;
    mocks.prepareRefreshCacheResult.mockReturnValue({
      get ok() {
        reads += 1;
        return reads === 1;
      },
      reason: "changed",
    });

    await runLocalSubscriptionAutoUpdateCron(now);

    expect(errorSpy).toHaveBeenCalledWith(
      "[local-subscription-cron] failed",
      expect.objectContaining({ message: "unexpected" }),
    );
    expect(mocks.resolveAutomaticRefreshCompletionDecision).not.toHaveBeenCalled();
  });

  it("detects a non-success completion decision for a prepared success", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.prepareRefreshCacheResult.mockReturnValue({
      ok: true,
      cacheEntry: { nodes: [], subscriptionInfo: {} },
      nodeCount: 0,
    });
    mocks.resolveAutomaticRefreshCompletionDecision.mockReturnValue(failureDecision());

    await runLocalSubscriptionAutoUpdateCron(now);

    expect(errorSpy).toHaveBeenCalledWith(
      "[local-subscription-cron] failed",
      expect.objectContaining({ message: "unexpected" }),
    );
  });

  it("continues reporting the original failure if attempted-state persistence errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readSubscriptionSecrets.mockImplementation(() => {
      throw new Error("decrypt failed");
    });
    mocks.resolveAutomaticRefreshUnexpectedFailureCompletion.mockReturnValue({
      attemptedState: { lastAttemptedAt: now },
      message: "decrypt failed",
      outcome: { status: "failed", requestedHosts: [] },
    });
    mocks.prisma.$transaction.mockRejectedValue(new Error("database unavailable"));

    await runLocalSubscriptionAutoUpdateCron(now);

    expect(errorSpy).toHaveBeenCalledWith(
      "[local-subscription-cron] failed",
      expect.objectContaining({ message: "decrypt failed" }),
    );
  });

  it("returns stale when attempted-state persistence loses CAS", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readSubscriptionSecrets.mockImplementation(() => {
      throw new Error("decrypt failed");
    });
    mocks.resolveAutomaticRefreshUnexpectedFailureCompletion.mockReturnValue({
      attemptedState: { lastAttemptedAt: now },
      message: "decrypt failed",
      outcome: { status: "failed", requestedHosts: [] },
    });
    mocks.prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    const summary = await runLocalSubscriptionAutoUpdateCron(now) as any;

    expect(summary.outcomes).toContainEqual(expect.objectContaining({ status: "skipped" }));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("never swallows lease-loss errors from refresh or failure persistence", async () => {
    mocks.refreshNodeSnapshot.mockRejectedValueOnce(new JobLeaseLostError("local-cron"));
    await expect(runLocalSubscriptionAutoUpdateCron(now)).rejects.toBeInstanceOf(JobLeaseLostError);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readSubscriptionSecrets.mockImplementation(() => {
      throw new Error("decrypt failed");
    });
    mocks.resolveAutomaticRefreshUnexpectedFailureCompletion.mockReturnValue({
      attemptedState: { lastAttemptedAt: now },
      message: "decrypt failed",
      outcome: { status: "failed", requestedHosts: [] },
    });
    mocks.prisma.$transaction.mockRejectedValue(new JobLeaseLostError("local-cron"));

    await expect(runLocalSubscriptionAutoUpdateCron(now)).rejects.toBeInstanceOf(JobLeaseLostError);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("local job lease heartbeat edge behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not mutate expiry when renewal fails", async () => {
    const lease = { name: "local-cron", ownerToken: "owner", expiresAt: new Date(0) };
    mocks.prisma.$executeRaw.mockResolvedValue(0);

    await expect(renewLocalJobLease(lease, 1_000, now)).resolves.toBe(false);
    expect(lease.expiresAt).toEqual(new Date(0));
  });

  it("lets an already queued renewal observe a stopped heartbeat", async () => {
    const lease = { name: "local-cron", ownerToken: "owner", expiresAt: new Date(0) };
    const heartbeat = startLocalJobLeaseHeartbeat({ lease, leaseMs: 1_000, intervalMs: 100 });

    vi.advanceTimersByTime(100);
    await heartbeat.stop();

    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("short-circuits queued renewals after ownership is lost", async () => {
    const lease = { name: "local-cron", ownerToken: "owner", expiresAt: new Date(0) };
    mocks.prisma.$executeRaw.mockResolvedValue(0);
    const heartbeat = startLocalJobLeaseHeartbeat({ lease, leaseMs: 1_000, intervalMs: 100 });

    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    await heartbeat.stop();

    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("supports timer handles without an unref method", async () => {
    const setIntervalMock = vi.fn(() => 7 as unknown as NodeJS.Timeout);
    const clearIntervalMock = vi.fn();
    vi.stubGlobal("setInterval", setIntervalMock);
    vi.stubGlobal("clearInterval", clearIntervalMock);
    const lease = { name: "local-cron", ownerToken: "owner", expiresAt: new Date(0) };

    const heartbeat = startLocalJobLeaseHeartbeat({ lease, leaseMs: 1_000, intervalMs: 100 });
    await heartbeat.stop();

    expect(setIntervalMock).toHaveBeenCalledTimes(1);
    expect(clearIntervalMock).toHaveBeenCalledWith(7);
  });
});
