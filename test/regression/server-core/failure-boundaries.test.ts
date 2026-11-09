import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveAppVersionInfo } from "../../../packages/server-core/src/app-version";
import {
  decryptEncryptedFieldV2,
  encryptEncryptedFieldV2,
} from "../../../packages/server-core/src/crypto/encrypted-field";
import {
  parseAutoUpdateFailureSourceState,
  updateAutoUpdateFailureSourceState,
} from "../../../packages/server-core/src/subscription/auto-update-failure";
import { getLastAutoUpdateScheduleMark } from "../../../packages/server-core/src/subscription/auto-update-schedule";
import {
  applyCronUpdateOutcome,
  createCronUpdateAccumulator,
  recordUpdatedSubscriptionUser,
  type CronUpdatedUserSummary,
} from "../../../packages/server-core/src/subscription/cron-update-summary";
import { resolveHostnameByDoh } from "../../../packages/server-core/src/subscription/doh-resolver";
import { looksLikeMissingAnyTLSDetails } from "../../../packages/server-core/src/subscription/fetch-profile-heuristics";
import { buildManualRefreshFailureResponse } from "../../../packages/server-core/src/subscription/manual-refresh-response";

describe("server-core failure boundary behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("drops non-object auto-update streak entries", () => {
    expect(
      parseAutoUpdateFailureSourceState(
        JSON.stringify({
          nullEntry: null,
          scalarEntry: "invalid",
        })
      )
    ).toEqual({});
  });

  it("treats an unrelated numeric HTTP status as a non-stable failure", () => {
    const result = updateAutoUpdateFailureSourceState({
      previousStateRaw: null,
      sources: [{ id: "source-a", type: "url", content: "https://local.subboost.test/a" }],
      failedSources: [
        {
          id: "source-a",
          type: "url",
          content: "https://local.subboost.test/a",
          responseStatus: 200,
          errorMessage: "unexpected response",
        },
      ],
      failedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(result.failedSources).toEqual([
      expect.objectContaining({ sourceId: "source-a", isStableExternalFailure: false, count: 0 }),
    ]);
  });

  it("selects a disable source from multiple threshold-reaching failures", () => {
    const sources = [
      { id: "source-a", type: "url", content: "https://local.subboost.test/a" },
      { id: "source-b", type: "url", content: "https://local.subboost.test/b" },
    ];
    const failedSources = sources.map((source) => ({ ...source, errorMessage: "HTTP 403", httpStatus: 403 }));
    const first = updateAutoUpdateFailureSourceState({
      previousStateRaw: null,
      sources,
      failedSources,
      failedAt: new Date("2026-08-01T00:00:00.000Z"),
      threshold: 2,
    });
    const second = updateAutoUpdateFailureSourceState({
      previousStateRaw: first.serializedSourceState,
      sources,
      failedSources,
      failedAt: new Date("2026-08-01T01:00:00.000Z"),
      threshold: 2,
    });

    expect(second.stableFailedSources).toHaveLength(2);
    expect(second.disableSource).toMatchObject({ count: 2, isStableExternalFailure: true });
    expect(second.shouldDisableAutoUpdate).toBe(true);
  });

  it("does not replace an already-known cron username", () => {
    const users = new Map<string, CronUpdatedUserSummary>();

    recordUpdatedSubscriptionUser(users, "user-a", "alice");
    recordUpdatedSubscriptionUser(users, "user-a", "bob");

    expect(users.get("user-a")).toEqual({ userId: "user-a", username: "alice", count: 2 });
  });

  it("records a failed cron result even when subscription details are unavailable", () => {
    const accumulator = createCronUpdateAccumulator(1);

    applyCronUpdateOutcome(accumulator, {
      status: "failed",
      requestedHosts: [],
      recordHosts: false,
      resultsError: "Subscription lookup failed",
    });

    expect(accumulator.results.failed).toBe(1);
    expect(accumulator.failedSubscriptions).toEqual([]);
  });

  it("rejects absent and blank encryption master keys", () => {
    expect(() => encryptEncryptedFieldV2("secret", undefined as unknown as string)).toThrow(
      "Encryption master key is required"
    );
    expect(() => decryptEncryptedFieldV2("v2:bad", "   ")).toThrow("Encryption master key is required");
  });

  it("uses the public package metadata through the default file reader", () => {
    const info = resolveAppVersionInfo({ env: {}, cwd: process.cwd() });

    expect(info.releaseVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.buildVersion).toBe(info.releaseVersion);
  });

  it("recognizes AnyTLS nodes that already carry a string ALPN value", () => {
    expect(
      looksLikeMissingAnyTLSDetails({
        nodes: [
          {
            name: "AnyTLS",
            type: "anytls",
            server: "local.subboost.test",
            port: 443,
            password: "secret",
            alpn: "h2",
          },
        ],
        errors: [],
        totalParsed: 1,
        totalFailed: 0,
      })
    ).toBe(false);
  });

  it("falls back to the adapter node limit in a quota response", () => {
    expect(
      buildManualRefreshFailureResponse({
        refreshResult: { ok: false, reason: "quota_exceeded" },
        maxNodesPerSubscription: 10_000,
      })
    ).toEqual({
      body: { error: "已超过节点数量上限 (10000)", code: "QUOTA_EXCEEDED" },
      status: 403,
    });
  });

  it("ignores invalid Date schedule marks", () => {
    expect(
      getLastAutoUpdateScheduleMark({
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        lastUpdatedAt: new Date(Number.NaN),
        lastAttemptedAt: new Date("2026-08-01T01:00:00.000Z"),
      })
    ).toEqual(new Date("2026-08-01T01:00:00.000Z"));
  });

  it("aborts the default DoH transport after its timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    );

    const pending = resolveHostnameByDoh("local.subboost.test", {
      endpoints: ["https://local.subboost.test/dns-query"],
      timeoutMs: 5,
    });
    await vi.advanceTimersByTimeAsync(5);

    await expect(pending).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
