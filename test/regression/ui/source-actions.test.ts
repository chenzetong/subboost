import { beforeEach, describe, expect, it } from "vitest";
import {
  createSubscriptionImportErrorInfo,
  SubscriptionImportError,
} from "@subboost/core/subscription/import-error";
import type { ParsedNode } from "@subboost/core/types/node";
import {
  createHarness,
  getSourceActionMocks,
  node,
  parseResult,
  PROXY_PROVIDER_HINT,
  resetSourceActionMocks,
  source,
} from "../../../packages/ui/src/store/config-store/source-actions.test-utils";

const mocks = getSourceActionMocks();
const SOURCE_IDS_KEY = "_sourceIds";
const ORIGIN_NAME_KEY = "_originName";

describe("source actions batch import branch coverage", () => {
  beforeEach(resetSourceActionMocks);

  it("parses mixed batch sources and keeps source metadata aligned", async () => {
    mocks.fetchUrlContentInBrowser
      .mockResolvedValueOnce({
        content: "ignored because parseResult is provided",
        headers: {
          "subscription-userinfo": "expire=1893456000",
        },
        parseResult: parseResult([node("Shared", { server: "same.example.com" })], ["remote warning"]),
      })
      .mockRejectedValueOnce(new Error("network down"));

    mocks.parseSubscription
      .mockReturnValueOnce(
        parseResult(
          [
            node("Shared", { server: "same.example.com" }),
            node("Deleted Origin", { _originName: "Deleted Origin" }),
            node("Manual Keep"),
          ],
          ["", "yaml warning"]
        )
      )
      .mockImplementationOnce(() => {
        throw "bad yaml";
      });

    const { actions, getState } = createHarness({
      deletedNodeNames: ["Deleted Origin"],
      listenerPorts: {
        Shared: 41000,
        "Deleted Origin": 41001,
        "Manual Keep": "bad",
      },
      sources: [
        source({ id: "empty", type: "yaml", content: "   " }),
        source({
          id: "provider-ok",
          type: "url",
          content: " https://provider.example.com/provider.yaml ",
          useProxyProviders: true,
          tag: " Provider ",
          nameTemplate: " {tag}-{name} ",
        }),
        source({
          id: "provider-bad",
          type: "url",
          content: "ftp://provider.example.com/provider.yaml",
          useProxyProviders: true,
        }),
        source({
          id: "url-ok",
          type: "url",
          content: " https://example.com/sub ",
          tag: "",
          nameTemplate: "",
        }),
        source({
          id: "url-bad",
          type: "url",
          content: "https://bad.example.com/sub",
        }),
        source({
          id: "yaml-ok",
          type: "yaml",
          content: "proxies: []",
        }),
        source({
          id: "yaml-bad",
          type: "yaml",
          content: "broken",
        }),
      ],
    });

    await actions.parseMultipleSources(getState().sources);

    const state = getState();
    expect(state.isLoading).toBe(false);
    expect(state.nodes.map((item: ParsedNode) => item.name)).toEqual(["Shared", "Manual Keep"]);
    expect(state.nodes[0]).toMatchObject({
      _originName: "Shared",
      _sourceIds: expect.arrayContaining(["url-ok", "yaml-ok"]),
    });
    expect(state.listenerPorts).toEqual({ Shared: 41000 });
    expect(state.parseErrors.join("\n")).toContain("provider.example.com");
    expect(state.parseErrors.join("\n")).toContain("network down");
    expect(state.parseErrors.join("\n")).toContain("yaml warning");
    expect(state.parseErrors.join("\n")).toContain("未知错误");
    expect(state.sources).toEqual([
      expect.objectContaining({ id: "empty", type: "yaml", content: "   " }),
      expect.objectContaining({
        id: "provider-ok",
        parsed: true,
        parsing: false,
        lastParsedContent: "https://provider.example.com/provider.yaml",
        lastParsedTag: "Provider",
        lastParsedNameTemplate: "{tag}-{name}",
      }),
      expect.objectContaining({
        id: "provider-bad",
        parsed: false,
        error: "只支持 HTTP/HTTPS url",
      }),
      expect.objectContaining({
        id: "url-ok",
        parsed: true,
        nodeCount: 1,
        subscriptionUserInfo: { expire: 1893456000 },
        lastParsedContent: "https://example.com/sub",
      }),
      expect.objectContaining({
        id: "url-bad",
        parsed: false,
        error: "network down",
      }),
      expect.objectContaining({
        id: "yaml-ok",
        parsed: true,
        nodeCount: 3,
        error: undefined,
      }),
      expect.objectContaining({
        id: "yaml-bad",
        parsed: false,
        error: "未知错误",
      }),
    ]);
  });

  it("parses pasted content while filtering duplicate and deleted origins", () => {
    mocks.parseSubscription.mockReturnValueOnce(
      parseResult([
        node("Existing"),
        node("Deleted Fresh", { [ORIGIN_NAME_KEY]: "Deleted Fresh" }),
        node("Fresh"),
      ], ["warning"])
    );

    const { actions, getState } = createHarness({
      nodes: [node("Existing")],
      deletedNodeNames: ["Deleted Fresh"],
    });

    actions.parseContent("proxies: []");

    expect(getState().isLoading).toBe(false);
    expect(getState().nodes.map((item: ParsedNode) => item.name)).toEqual(["Existing", "Fresh"]);
    expect(getState().nodes[1]).toMatchObject({ [ORIGIN_NAME_KEY]: "Fresh" });
    expect(getState().parseErrors).toEqual(["warning"]);
  });

  it("records non-error parseContent failures without leaking raw thrown values", () => {
    mocks.parseSubscription.mockImplementationOnce(() => {
      throw "raw parser failure";
    });

    const { actions, getState } = createHarness();

    actions.parseContent("broken");

    expect(getState().isLoading).toBe(false);
    expect(getState().parseErrors).toEqual(["解析失败"]);
  });

  it("refreshes a single yaml source and trims stale listener and dialer state", async () => {
    mocks.parseSubscription.mockReturnValueOnce(parseResult([node("Raw")], ["yaml warning"]));

    const { actions, getState } = createHarness({
      nodes: [
        node("Manual Keep"),
        node("Stale Source", { [SOURCE_IDS_KEY]: ["yaml-one"] }),
      ],
      listenerPorts: {
        Raw: 41001,
        "Manual Keep": 41000,
        "Stale Source": 41001,
      },
      dialerProxyGroups: [
        {
          id: "dialer",
          name: "Dialer",
          type: "select",
          enabled: true,
          relayNodes: ["DIRECT", "DIRECT", "Manual Keep", "Stale Source"],
          targetNodes: ["Manual Keep", "Stale Source"],
        },
      ],
      sources: [source({ id: "yaml-one", type: "yaml", content: " proxies: [] " })],
    });

    await actions.parseSingleSource("yaml-one");

    const state = getState();
    expect(state.nodes.map((item: ParsedNode) => item.name)).toEqual(["Manual Keep"]);
    expect(state.nodes[0]).toMatchObject({
      name: "Manual Keep",
      server: "raw.example.com",
      [ORIGIN_NAME_KEY]: "Raw",
      [SOURCE_IDS_KEY]: ["yaml-one"],
    });
    expect(state.listenerPorts).toEqual({ "Manual Keep": 41000 });
    expect(state.dialerProxyGroups[0]).toMatchObject({
      relayNodes: ["DIRECT", "Manual Keep"],
      targetNodes: ["Manual Keep"],
    });
    expect(state.sources[0]).toMatchObject({
      parsed: true,
      parsing: false,
      nodeCount: 1,
      lastParsedContent: "proxies: []",
      lastParsedTag: undefined,
      lastParsedNameTemplate: undefined,
    });
    expect(state.parseErrors).toEqual(["yaml warning"]);
  });

  it("imports a single proxy-provider URL source and cleans stale source-owned state", async () => {
    const { actions, getState } = createHarness({
      nodes: [
        node("Manual Keep"),
        node("Source Only", { [SOURCE_IDS_KEY]: ["provider"] }),
        node("Shared Keep", { [SOURCE_IDS_KEY]: ["provider", "other"] }),
      ],
      listenerPorts: {
        "Manual Keep": "bad",
        "Shared Keep": 41000,
        "Source Only": 41001,
      },
      dialerProxyGroups: [
        {
          id: "dialer",
          name: "Dialer",
          type: "select",
          enabled: true,
          relayNodes: ["DIRECT", "Source Only", "Manual Keep", "Shared Keep"],
          targetNodes: ["Source Only", "Shared Keep"],
        },
      ],
      sources: [
        source({
          id: "provider",
          type: "url",
          content: " https://provider.example.com/sub.yaml ",
          useProxyProviders: true,
          tag: "",
          nameTemplate: "",
        }),
        source({ id: "other", type: "yaml", content: "proxies: []" }),
      ],
    });

    await actions.parseSingleSource("provider");

    const state = getState();
    expect(state.nodes.map((item: ParsedNode) => item.name)).toEqual(["Manual Keep", "Shared Keep"]);
    expect(state.listenerPorts).toEqual({ "Shared Keep": 41000 });
    expect(state.dialerProxyGroups[0]).toMatchObject({
      relayNodes: ["DIRECT", "Manual Keep", "Shared Keep"],
      targetNodes: ["Shared Keep"],
    });
    expect(state.sources[0]).toMatchObject({
      id: "provider",
      parsed: true,
      parsing: false,
      lastParsedContent: "https://provider.example.com/sub.yaml",
      lastParsedTag: undefined,
      lastParsedNameTemplate: undefined,
    });
  });

  it("records single-source import failures with proxy-provider guidance for empty URL results", async () => {
    const { actions, getState } = createHarness({
      sources: [source({ id: "empty-result", type: "url", content: "https://empty.example.com/sub" })],
    });
    mocks.fetchUrlContentInBrowser.mockResolvedValueOnce({
      content: "empty",
      headers: { "subscription-userinfo": "upload=bad; download=bad" },
      parseResult: parseResult([], []),
    });

    await actions.parseSingleSource("empty-result");

    const state = getState();
    expect(state.sources[0]).toMatchObject({
      parsed: false,
      parsing: false,
      error: "未解析到有效节点",
    });
    expect(state.sources[0].errorInfo.suggestedActions).toContain(PROXY_PROVIDER_HINT);
  });

  it("keeps structured single-source URL import errors without adding duplicate provider guidance", async () => {
    const info = createSubscriptionImportErrorInfo({
      category: "parse",
      message: "proxy-providers payload is empty",
      detail: "proxy-providers payload is empty",
    });
    mocks.fetchUrlContentInBrowser.mockRejectedValueOnce(new SubscriptionImportError(info));

    const { actions, getState } = createHarness({
      sources: [source({ id: "structured", type: "url", content: "https://example.com/sub" })],
    });

    await actions.parseSingleSource("structured");

    expect(getState().sources[0]).toMatchObject({
      parsed: false,
      parsing: false,
      error: "proxy-providers payload is empty",
      errorInfo: expect.objectContaining({ category: "parse" }),
    });
    expect(getState().sources[0].errorInfo.suggestedActions).not.toContain(PROXY_PROVIDER_HINT);
  });

  it("keeps structured batch fetch and parse errors on their original source entries", async () => {
    mocks.fetchUrlContentInBrowser
      .mockRejectedValueOnce(
        new SubscriptionImportError(
          createSubscriptionImportErrorInfo({
            category: "format",
            message: "无效的 url 格式",
            detail: "无效的 url 格式",
          })
        )
      )
      .mockResolvedValueOnce({
        content: "bad yaml",
        headers: {},
        parseResult: null,
      });
    mocks.parseSubscription.mockImplementationOnce(() => {
      throw new SubscriptionImportError(
        createSubscriptionImportErrorInfo({
          category: "parse",
          message: "YAML parse failed",
          detail: "YAML parse failed",
        })
      );
    });

    const { actions, getState } = createHarness({
      sources: [
        source({ id: "url-format", type: "url", content: "https://format.example.com/sub" }),
        source({ id: "url-parse", type: "url", content: "https://parse.example.com/sub" }),
      ],
    });

    await actions.parseMultipleSources(getState().sources);

    expect(getState().sources).toEqual([
      expect.objectContaining({
        id: "url-format",
        parsed: false,
        error: "无效的 url 格式",
        errorInfo: expect.objectContaining({ category: "format" }),
      }),
      expect.objectContaining({
        id: "url-parse",
        parsed: false,
        error: "YAML parse failed",
        errorInfo: expect.objectContaining({ category: "parse" }),
      }),
    ]);
    expect(getState().parseErrors.join("\n")).toContain("源 #1 获取失败: 无效的 url 格式");
    expect(getState().parseErrors.join("\n")).toContain("源 #2 解析失败: YAML parse failed");
    expect(getState().sources[0].errorInfo.suggestedActions).not.toContain(PROXY_PROVIDER_HINT);
    expect(getState().sources[1].errorInfo.suggestedActions).toContain(PROXY_PROVIDER_HINT);
  });
});
