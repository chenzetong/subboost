import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  importSubscriptionFromUrl,
  type SourceImportTransportRequest,
  type SourceImportTransportResult,
} from "../../../packages/server-core/src/subscription/source-import";

const mocks = vi.hoisted(() => ({
  parseSubscription: vi.fn(),
}));

vi.mock("@subboost/core/parser", () => ({
  parseSubscription: mocks.parseSubscription,
}));

function node(name: string) {
  return { name, type: "trojan", server: `${name}.example.com`, port: 443, password: "secret" } as any;
}

function parseResult(nodes = [node("one")], errors: string[] = []) {
  return { nodes, errors, totalParsed: nodes.length, totalFailed: errors.length };
}

describe("server-core source import branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseSubscription.mockReturnValue(parseResult());
  });

  it("falls back to the default transport error when a failed attempt has no public message", async () => {
    const result = await importSubscriptionFromUrl(
      { url: "https://example.com/sub.yaml" },
      {
        userAgents: ["empty-error"],
        fetchText: async () => ({
          ok: false,
          error: "",
          responseStatus: 204,
          publicReason: null,
        }),
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("获取 url 失败");
    expect(result.responseStatus).toBe(204);
    expect(result.publicReason).toBeNull();
  });

  it("uses the fallback message when a failed attempt sanitizes to empty text", async () => {
    const result = await importSubscriptionFromUrl(
      { url: "https://example.com/sub.yaml" },
      {
        userAgents: ["blank-error"],
        fetchText: async () => ({
          ok: false,
          error: "   ",
          responseStatus: 599,
        }),
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("获取 url 失败");
    expect(result.responseStatus).toBe(599);
  });

  it("keeps an earlier usable attempt over later transport and smaller-result attempts", async () => {
    const fetchText = vi.fn(async (request: SourceImportTransportRequest): Promise<SourceImportTransportResult> => {
      if (request.userAgent === "two-nodes") {
        return { ok: true, content: "two-node-yaml", headers: { "content-type": "text/yaml" } };
      }
      if (request.userAgent === "failed") {
        return { ok: false, error: "HTTP 500", responseStatus: 500 };
      }
      return { ok: true, content: "one-node-yaml", headers: { "content-type": "text/yaml" } };
    });
    mocks.parseSubscription
      .mockReturnValueOnce(parseResult([node("two-a"), node("two-b")], ["partial"]))
      .mockReturnValueOnce(parseResult([node("one")]));

    const result = await importSubscriptionFromUrl(
      { url: "https://example.com/sub.yaml" },
      { fetchText, userAgents: ["two-nodes", "failed", "one-node"] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsedNodes.map((node) => node.name)).toEqual(["two-a", "two-b"]);
    expect(fetchText).toHaveBeenCalledTimes(3);
  });

  it("prefers a later successful parse over an earlier transport failure", async () => {
    const fetchText = vi.fn(async (request: SourceImportTransportRequest): Promise<SourceImportTransportResult> => {
      if (request.userAgent === "failed") {
        return { ok: false, error: "HTTP 500", responseStatus: 500 };
      }
      return { ok: true, content: "success-yaml", headers: {} };
    });
    mocks.parseSubscription.mockReturnValueOnce(parseResult([node("recovered")]));

    const result = await importSubscriptionFromUrl(
      { url: "https://example.com/sub.yaml" },
      { fetchText, userAgents: ["failed", "success"] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsedNodes[0]?.name).toBe("recovered");
  });

  it("keeps the first successful attempt when node counts tie and the later attempt has more errors", async () => {
    const fetchText = vi.fn(async (request: SourceImportTransportRequest): Promise<SourceImportTransportResult> => ({
      ok: true,
      content: request.userAgent === "clean" ? "clean-yaml" : "warning-yaml",
      headers: {},
    }));
    mocks.parseSubscription
      .mockReturnValueOnce(parseResult([node("one")], ["minor"]))
      .mockReturnValueOnce(parseResult([node("one-later")], ["minor", "extra"]));

    const result = await importSubscriptionFromUrl(
      { url: "https://example.com/sub.yaml" },
      { fetchText, userAgents: ["clean", "warn"] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsedNodes[0]?.name).toBe("one");
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it("prefers a later equally-sized parse when it has fewer parse errors", async () => {
    const fetchText = vi.fn(async (request: SourceImportTransportRequest): Promise<SourceImportTransportResult> => ({
      ok: true,
      content: request.userAgent === "noisy" ? "noisy-yaml" : "cleaner-yaml",
      headers: {},
    }));
    mocks.parseSubscription
      .mockReturnValueOnce(parseResult([node("noisy")], ["a", "b"]))
      .mockReturnValueOnce(parseResult([node("cleaner")], ["a"]));

    const result = await importSubscriptionFromUrl(
      { url: "https://example.com/sub.yaml" },
      { fetchText, userAgents: ["noisy", "cleaner"] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsedNodes[0]?.name).toBe("cleaner");
    expect(result.parseErrors).toEqual(["a"]);
  });

  it("returns the client-update placeholder message for unusable parsed attempts", async () => {
    const fetchText = vi.fn(async (): Promise<SourceImportTransportResult> => ({
      ok: true,
      content: "please update your client",
      headers: {},
    }));
    mocks.parseSubscription.mockReturnValueOnce(parseResult([], ["检测到客户端更新提示占位节点，已自动忽略"]));

    const result = await importSubscriptionFromUrl(
      { url: "https://example.com/sub.yaml" },
      { fetchText, userAgents: ["placeholder"] }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("订阅服务返回了客户端更新提示占位内容，未导入该结果");
    expect(result.errorInfo.detail).toBe("检测到客户端更新提示占位节点，已自动忽略");
  });
});
