import { describe, expect, it } from "vitest";

import {
  areSubscriptionUrlListsEquivalent,
  normalizeSubscriptionConfigForPersistence,
  normalizeSubscriptionNodeList,
  serializeSubscriptionSummaryData,
  validateSubscriptionNodeList,
} from "../../../packages/server-core/src/subscription/crud";
import { buildSubscriptionResponseHeaders } from "../../../packages/server-core/src/subscription/response-headers";
import { normalizeSavedSourcesForPersistence } from "../../../packages/server-core/src/subscription/saved-sources";

describe("subscription CRUD boundary behavior", () => {
  it("returns an empty normalized node list for non-array payloads", () => {
    expect(normalizeSubscriptionNodeList({ nodes: [] })).toEqual([]);
  });

  it("rejects non-string node names and types with indexed messages", () => {
    expect(() =>
      validateSubscriptionNodeList([
        { name: 123, type: "trojan", server: "local.subboost.test", port: 443 },
      ])
    ).toThrow("节点 #1 缺少有效名称");

    expect(() =>
      validateSubscriptionNodeList([
        { name: "Node", type: null, server: "local.subboost.test", port: 443 },
      ])
    ).toThrow("节点 #1 缺少有效类型");
  });

  it("detects unequal URL lists even when their lengths match", () => {
    expect(
      areSubscriptionUrlListsEquivalent(
        ["https://local.subboost.test/a", "https://local.subboost.test/b"],
        ["https://local.subboost.test/a", "https://local.subboost.test/c"]
      )
    ).toBe(false);
  });

  it("removes an empty normalized source collection from persisted config", () => {
    expect(
      normalizeSubscriptionConfigForPersistence({
        config: {
          keep: true,
          sources: [{ type: "url", content: "   " }],
        },
      })
    ).toEqual({ keep: true });
  });

  it("omits every optional subscription timestamp when the source does not expose it", () => {
    const result = serializeSubscriptionSummaryData(
      {
        id: "sub-minimal",
        name: "Minimal",
        token: "token-minimal",
        isPrimary: false,
      },
      { config: {}, nodes: [] },
      { subscriptionUrl: "https://local.subboost.test/s/token-minimal" }
    );

    expect(result).not.toHaveProperty("cacheExpiresAt");
    expect(result).not.toHaveProperty("lastAccessedAt");
    expect(result).not.toHaveProperty("lastUpdatedAt");
    expect(result).not.toHaveProperty("createdAt");
    expect(result).not.toHaveProperty("updatedAt");
  });
});

describe("saved subscription source normalization", () => {
  it("preserves non-URL content and skips malformed source records", () => {
    expect(
      normalizeSavedSourcesForPersistence([
        null,
        7,
        {
          id: "raw-url",
          type: "url",
          content: "not a url",
        },
        {
          id: "raw-yaml",
          type: "yaml",
          content: "proxies: []",
          lastParsedContent: "proxies: []",
        },
      ])
    ).toEqual([
      { id: "raw-url", type: "url", content: "not a url" },
      {
        id: "raw-yaml",
        type: "yaml",
        content: "proxies: []",
        lastParsedContent: "proxies: []",
      },
    ]);
  });

  it("returns no fallback sources when no fallback list is configured", () => {
    expect(normalizeSavedSourcesForPersistence([])).toEqual([]);
  });
});

describe("subscription response filename safety", () => {
  it("uses config when sanitization removes the entire supplied name", () => {
    const headers = buildSubscriptionResponseHeaders('\r\n".yaml', {}, { isAdmin: false });

    expect(headers["content-disposition"]).toContain('filename="config"');
  });

  it("uses only the UTF-8 filename parameter when no ASCII fallback remains", () => {
    const headers = buildSubscriptionResponseHeaders("订阅", {}, { isAdmin: false });

    expect(headers["content-disposition"]).toBe("attachment; filename*=UTF-8''%E8%AE%A2%E9%98%85");
  });

  it("uses the default filename for an empty input", () => {
    const headers = buildSubscriptionResponseHeaders("", {}, { isAdmin: true });

    expect(headers["content-disposition"]).toContain('filename="config"');
  });
});
