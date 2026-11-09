import { afterEach, describe, expect, it, vi } from "vitest";

import {
  importSubscriptionFromUrl,
  type SourceImportTransportRequest,
  type SourceImportTransportResult,
} from "../../../packages/server-core/src/subscription/source-import";

const oneNodeWithParseError = [
  "proxies:",
  "  - name: first",
  "    type: trojan",
  "    server: local.subboost.test",
  "    port: 443",
  "    password: secret",
  "not a valid node",
].join("\n");

const oneCleanNode = [
  "proxies:",
  "  - name: clean",
  "    type: trojan",
  "    server: local.subboost.test",
  "    port: 443",
  "    password: secret",
].join("\n");

describe("subscription import attempt selection", () => {
  it("keeps equally useful attempts stable, ignores a placeholder, then prefers the clean result", async () => {
    const fetchText = vi.fn(
      async (request: SourceImportTransportRequest): Promise<SourceImportTransportResult> => {
        if (request.userAgent === "first") {
          return { ok: true, content: oneNodeWithParseError, headers: {} };
        }
        if (request.userAgent === "same-quality") {
          return {
            ok: true,
            content: oneNodeWithParseError.replace("name: first", "name: same-quality"),
            headers: {},
          };
        }
        if (request.userAgent === "placeholder") {
          return { ok: true, content: "请更新客户端后继续使用", headers: {} };
        }
        return { ok: true, content: oneCleanNode, headers: {} };
      }
    );

    const result = await importSubscriptionFromUrl(
      { url: "https://local.subboost.test/sub" },
      { fetchText, userAgents: ["first", "same-quality", "placeholder", "clean"] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsedNodes.map((node) => node.name)).toEqual(["clean"]);
    expect(result.parseErrors).toEqual([]);
    expect(fetchText).toHaveBeenCalledTimes(4);
  });
});

describe("static subscription refresh metadata and failures", () => {
  afterEach(() => {
    vi.doUnmock("@subboost/core/parser");
    vi.resetModules();
  });

  it("derives aggregate subscription traffic from static metadata nodes", async () => {
    const { refreshNodeSnapshot } = await import(
      "../../../packages/server-core/src/subscription/refresh-node-snapshot"
    );
    const result = await refreshNodeSnapshot({
      config: {
        sources: [
          {
            id: "static-metadata",
            type: "yaml",
            content: [
              "proxies:",
              '  - name: "总流量: 10 GB"',
              "    type: trojan",
              "    server: local.subboost.test",
              "    port: 443",
              "    password: secret",
              '  - name: "已用流量: 1 GB"',
              "    type: trojan",
              "    server: local.subboost.test",
              "    port: 8443",
              "    password: secret",
            ].join("\n"),
          },
        ],
      },
      urls: [],
      storedNodes: [],
      fetchUrlNodes: vi.fn(),
    });

    expect(result.subscriptionInfo).toMatchObject({
      upload: 1024 ** 3,
      download: 0,
      total: 10 * 1024 ** 3,
    });
    expect(result.savedSources[0]).toHaveProperty("subscriptionUserInfo.total", 10 * 1024 ** 3);
  });

  it("records an unexpected parser exception as a source parse failure", async () => {
    vi.resetModules();
    vi.doMock("@subboost/core/parser", () => ({
      parseSubscription: () => {
        throw new Error("parser exploded");
      },
    }));
    const { refreshNodeSnapshot } = await import(
      "../../../packages/server-core/src/subscription/refresh-node-snapshot"
    );

    const result = await refreshNodeSnapshot({
      config: {
        sources: [{ id: "broken-static", type: "nodes", content: "ignored" }],
      },
      urls: [],
      storedNodes: [],
      fetchUrlNodes: vi.fn(),
    });

    expect(result.failedSources).toEqual([
      expect.objectContaining({
        id: "broken-static",
        errorMessage: "parser exploded",
        errorCategory: "parse",
      }),
    ]);
  });
});
