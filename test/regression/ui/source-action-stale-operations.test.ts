import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedNode } from "@subboost/core/types/node";
import {
  createHarness,
  getSourceActionMocks,
  node,
  parseResult,
  resetSourceActionMocks,
  source,
} from "../../../packages/ui/src/store/config-store/source-actions.test-utils";

const mocks = getSourceActionMocks();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("source action stale-operation and normalization regressions", () => {
  const originalUrl = globalThis.URL;

  beforeEach(resetSourceActionMocks);

  afterEach(() => {
    globalThis.URL = originalUrl;
  });

  it("clears pending source flags before parsing pasted content", () => {
    mocks.parseSubscription.mockReturnValueOnce(parseResult([node("Fresh")], []));
    const { actions, getState } = createHarness({
      sources: [
        source({ id: "pending", parsing: true }),
        source({ id: "idle", parsing: false }),
      ],
    });

    actions.parseContent("ss://fresh");

    expect(getState().sources).toEqual([
      expect.objectContaining({ id: "pending", parsing: false }),
      expect.objectContaining({ id: "idle", parsing: false }),
    ]);
    expect(getState().nodes).toEqual([
      expect.objectContaining({ name: "Fresh", _originName: "Fresh" }),
    ]);
  });

  it("discards a rejected single import after its source fingerprint changes", async () => {
    const request = deferred<never>();
    mocks.fetchUrlContentInBrowser.mockReturnValueOnce(request.promise);
    const { actions, getState } = createHarness({
      sources: [
        source({ id: "changing", type: "url", content: "https://example.test/old" }),
        source({ id: "sibling", type: "yaml", content: "proxies: []", parsing: true }),
      ],
    });

    const importPromise = actions.parseSingleSource("changing");
    await flushAsync();
    getState().sources[0].content = "https://example.test/new";
    request.reject(new Error("stale failure"));
    await importPromise;

    expect(getState().sources).toEqual([
      expect.objectContaining({ id: "changing", parsing: false, error: undefined }),
      expect.objectContaining({ id: "sibling", parsing: true }),
    ]);
  });

  it("releases batch loading when an owned request becomes stale", async () => {
    const request = deferred<{
      content: string;
      headers: Record<string, string>;
      parseResult: ReturnType<typeof parseResult>;
    }>();
    mocks.fetchUrlContentInBrowser.mockReturnValueOnce(request.promise);
    const { actions, getState } = createHarness({
      sources: [source({ id: "batch", type: "url", content: "https://example.test/old" })],
    });

    const importPromise = actions.parseMultipleSources(getState().sources);
    await flushAsync();
    getState().sources[0].content = "https://example.test/new";
    request.resolve({
      content: "ss://old",
      headers: {},
      parseResult: parseResult([node("Old")]),
    });
    await importPromise;

    expect(getState().isLoading).toBe(false);
    expect(getState().nodes).toEqual([]);
  });

  it("keeps distinct duplicate-origin nodes despite a coarse deleted-name marker", async () => {
    mocks.parseSubscription.mockReturnValueOnce(
      parseResult([
        node("Shared A", { _originName: "Shared", server: "a.example.test" }),
        node("Shared B", { _originName: "Shared", server: "b.example.test" }),
      ])
    );
    const { actions, getState } = createHarness({
      deletedNodeNames: ["Shared"],
      sources: [source({ id: "yaml", type: "yaml", content: "proxies: []" })],
    });

    await actions.parseMultipleSources(getState().sources);

    expect(getState().nodes).toHaveLength(2);
    expect(getState().nodes.map((item: ParsedNode) => item.server)).toEqual([
      "a.example.test",
      "b.example.test",
    ]);
  });

  it("uses the safe URL error when a provider URL constructor throws a non-Error value", async () => {
    let constructorCalls = 0;
    globalThis.URL = class TestUrl {
      constructor(value: string | URL, base?: string | URL) {
        constructorCalls += 1;
        if (constructorCalls === 3) throw "non-error URL failure";
        return new originalUrl(value, base);
      }
    } as typeof URL;
    const { actions, getState } = createHarness({
      sources: [
        source({
          id: "provider",
          type: "url",
          content: "https://example.test/provider.yaml",
          useProxyProviders: true,
        }),
      ],
    });

    await actions.parseMultipleSources(getState().sources);

    expect(getState().sources[0]).toMatchObject({
      id: "provider",
      parsed: false,
      error: "无效的 url 格式",
    });
    expect(constructorCalls).toBeGreaterThanOrEqual(3);
  });
});
