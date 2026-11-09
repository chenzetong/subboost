import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiAdapter: { rules: {} as any },
  interactions: { rulesSearchCompleted: vi.fn() },
  state: {
    enabled: false,
    runEffects: false,
    callIndex: 0,
    overrides: {} as Record<number, unknown>,
    setters: [] as Array<ReturnType<typeof vi.fn>>,
    cleanups: [] as Array<() => void>,
    refObject: { current: 0 },
  },
}));

function mockReactModule(actual: typeof import("react")) {
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!mocks.state.enabled) return actual.useState(initial);
      const index = mocks.state.callIndex++;
      const value = Object.prototype.hasOwnProperty.call(mocks.state.overrides, index)
        ? mocks.state.overrides[index]
        : initial;
      const setter = vi.fn((next: unknown) => {
        const resolved = typeof next === "function" ? (next as (prev: unknown) => unknown)(value) : next;
        (setter as any).lastValue = resolved;
        return resolved;
      });
      mocks.state.setters[index] = setter;
      return [value, setter];
    },
    useEffect: (effect: () => void | (() => void)) => {
      if (!mocks.state.enabled || !mocks.state.runEffects) return undefined;
      const cleanup = effect();
      if (typeof cleanup === "function") mocks.state.cleanups.push(cleanup);
      return cleanup;
    },
    useCallback: (callback: unknown) => callback,
    useRef: () => mocks.state.refObject,
  };
}

vi.mock("react", async (importOriginal) => mockReactModule(await importOriginal<typeof import("react")>()));
vi.mock("../../../node_modules/react/index.js", async (importOriginal) =>
  mockReactModule(await importOriginal<typeof import("react")>())
);
vi.mock("@subboost/ui/product/api-adapter", () => ({
  useProductApiAdapter: () => mocks.apiAdapter,
}));
vi.mock("@subboost/ui/product/interactions", () => ({
  useProductInteractionAdapter: () => mocks.interactions,
}));

import {
  getRuleDisplayName,
  replaceRuleProviderBase,
  useRulesLibrarySearch,
} from "@subboost/ui/product/converter/advanced-mode/sections/proxy-groups-rules-search";

function useRunHook(overrides: Record<number, unknown> = {}, options: { runEffects?: boolean; refCurrent?: number } = {}) {
  mocks.state.enabled = true;
  mocks.state.runEffects = options.runEffects ?? false;
  mocks.state.refObject = { current: options.refCurrent ?? 0 };
  mocks.state.callIndex = 0;
  mocks.state.overrides = overrides;
  mocks.state.setters = [];
  mocks.state.cleanups = [];
  try {
    return useRulesLibrarySearch();
  } finally {
    mocks.state.enabled = false;
    mocks.state.runEffects = false;
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("public rules search hook remaining branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiAdapter = { rules: {} };
    mocks.interactions = { rulesSearchCompleted: vi.fn() };
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: () => void) => {
        callback();
        return 1 as any;
      }),
      clearTimeout: vi.fn(),
    });
  });

  it("formats rule display names and rewrites provider bases only for supported rule paths", () => {
    expect(replaceRuleProviderBase("https://cdn.example.com/rules/geosite/openai.mrs", "https://mirror.example.com/base/")).toBe(
      "https://mirror.example.com/base/geosite/openai.mrs"
    );
    expect(replaceRuleProviderBase("https://cdn.example.com/rules/list.txt", "https://mirror.example.com")).toBe(
      "https://cdn.example.com/rules/list.txt"
    );

    expect(getRuleDisplayName({ id: "geosite-openai", name: "", path: "geosite/openai.mrs" } as any)).toBe("geosite-openai");
    expect(getRuleDisplayName({ id: "id", name: "OpenAI", nameZh: "OpenAI", path: "geosite/openai.mrs" } as any)).toBe("OpenAI");
    expect(getRuleDisplayName({ id: "id", name: "OpenAI", nameZh: "人工智能", path: "geosite/openai.mrs" } as any)).toBe(
      "OpenAI（人工智能）"
    );
  });

  it("resets state for blank keywords and ignores missing total-rule counts", async () => {
    mocks.apiAdapter = { rules: {} };
    const result = useRunHook({}, { runEffects: true });
    await flushPromises();

    expect(result.canLoadMore).toBe(false);
    expect(mocks.state.setters[1]).toHaveBeenCalledWith([]);
    expect(mocks.state.setters[4]).toHaveBeenCalledWith(null);
    expect(mocks.state.setters[5]).toHaveBeenCalledWith(1);
    expect(mocks.state.setters[6]).toHaveBeenCalledWith(null);
    expect(mocks.state.setters[8]).toHaveBeenCalledWith(null);
  });

  it("records successful remote searches and runs effect cleanup", async () => {
    const rule = { id: "geosite-openai", name: "openai", nameZh: "OpenAI", path: "geosite/openai.mrs" };
    mocks.apiAdapter = {
      rules: {
        getTotalRules: vi.fn(async () => 99),
        searchRules: vi.fn(async () => ({
          items: [rule],
          totalRules: 100,
          totalMatched: 2,
          source: "stale",
        })),
      },
    };

    useRunHook({ 0: " ai " }, { runEffects: true });
    await flushPromises();
    mocks.state.cleanups.at(-1)?.();

    expect(mocks.apiAdapter.rules.getTotalRules).toHaveBeenCalled();
    expect(mocks.apiAdapter.rules.searchRules).toHaveBeenCalledWith(expect.objectContaining({
      keyword: "ai",
      page: 1,
      size: 50,
    }));
    expect(mocks.state.setters[1]).toHaveBeenCalledWith([rule]);
    expect(mocks.state.setters[6]).toHaveBeenCalledWith(2);
    expect(mocks.state.setters[7]).toHaveBeenCalledWith(100);
    expect(mocks.state.setters[8]).toHaveBeenCalledWith("stale");
    expect(mocks.interactions.rulesSearchCompleted).toHaveBeenCalledWith({
      result: "success",
      resultSource: "stale",
      resultCount: 2,
    });
    expect(window.clearTimeout).toHaveBeenCalledWith(1);
  });

  it("ignores aborted searches after cleanup", async () => {
    let resolveSearch: (value: unknown) => void = () => undefined;
    mocks.apiAdapter = {
      rules: {
        searchRules: vi.fn(() => new Promise((resolve) => {
          resolveSearch = resolve;
        })),
      },
    };

    useRunHook({ 0: "abort" }, { runEffects: true });
    mocks.state.cleanups.at(-1)?.();
    resolveSearch({ items: [{ id: "late" }], totalMatched: 1, source: "remote" });
    await flushPromises();

    expect(mocks.state.setters[1]).not.toHaveBeenCalledWith([{ id: "late" }]);
  });

  it("ignores late total-count, stale search success, and aborted search failures", async () => {
    let resolveTotal: (value: number) => void = () => undefined;
    let resolveSearch: (value: unknown) => void = () => undefined;
    mocks.apiAdapter = {
      rules: {
        getTotalRules: vi.fn(() => new Promise<number>((resolve) => {
          resolveTotal = resolve;
        })),
        searchRules: vi.fn(() => new Promise((resolve) => {
          resolveSearch = resolve;
        })),
      },
    };

    useRunHook({ 0: "late" }, { runEffects: true });
    mocks.state.cleanups[0]?.();
    resolveTotal(123);
    mocks.state.refObject.current = 99;
    resolveSearch({ items: [{ id: "late" }], totalMatched: 1, source: "remote" });
    await flushPromises();

    expect(mocks.state.setters[7]).not.toHaveBeenCalledWith(123);
    expect(mocks.state.setters[1]).not.toHaveBeenCalledWith([{ id: "late" }]);

    let rejectSearch: (reason: unknown) => void = () => undefined;
    mocks.apiAdapter = {
      rules: {
        searchRules: vi.fn(() => new Promise((_, reject) => {
          rejectSearch = reject;
        })),
      },
    };

    useRunHook({ 0: "late-error" }, { runEffects: true });
    mocks.state.cleanups.at(-1)?.();
    rejectSearch(new Error("too late"));
    await flushPromises();

    expect(mocks.state.setters[4]).not.toHaveBeenCalledWith("too late");
  });

  it("reports missing search API errors through state and interactions", async () => {
    mocks.apiAdapter = { rules: {} };
    useRunHook({ 0: "ai" }, { runEffects: true });
    await flushPromises();

    expect(mocks.state.setters[1]).toHaveBeenCalledWith([]);
    expect(mocks.state.setters[4]).toHaveBeenCalledWith("规则库接口暂不可用");
    expect(mocks.interactions.rulesSearchCompleted).toHaveBeenCalledWith({
      result: "error",
      resultSource: "unknown",
      resultCount: 0,
    });
  });

  it("loads more results, dedupes invalid rows, and guards unavailable load-more states", async () => {
    const existing = { id: "old", name: "Old", path: "geosite/old.mrs" };
    const next = { id: "new", name: "New", path: "geosite/new.mrs" };
    mocks.apiAdapter = {
      rules: {
        searchRules: vi.fn(async () => ({
          items: [existing, null, { id: 1 }, next],
          totalRules: 200,
          totalMatched: 3,
          source: "remote",
        })),
      },
    };

    const result = useRunHook({ 0: "ai", 1: [existing], 2: false, 3: false, 5: 1, 6: 3 }, { runEffects: false });
    expect(result.canLoadMore).toBe(true);
    result.handleLoadMore();
    await flushPromises();

    const merge = mocks.state.setters[1].mock.calls.at(-1)?.[0] as (prev: any[]) => any[];
    expect(merge([existing])).toEqual([existing, next]);
    expect(mocks.state.setters[3]).toHaveBeenCalledWith(false);
    expect(mocks.state.setters[5]).toHaveBeenCalledWith(2);
    expect(mocks.state.setters[6]).toHaveBeenCalledWith(3);
    expect(mocks.state.setters[7]).toHaveBeenCalledWith(200);
    expect(mocks.state.setters[8]).toHaveBeenCalledWith("remote");

    mocks.apiAdapter.rules.searchRules.mockClear();
    const guarded = useRunHook({ 0: "ai", 1: [], 2: true, 3: false, 5: 1, 6: 10 }, { runEffects: false });
    guarded.handleLoadMore();
    expect(mocks.apiAdapter.rules.searchRules).not.toHaveBeenCalled();
  });

  it("keeps previous load-more results for empty pages and reports non-Error failures", async () => {
    mocks.apiAdapter = {
      rules: {
        searchRules: vi.fn(async () => ({
          items: [],
          totalMatched: undefined,
          totalRules: undefined,
          source: "unknown",
        })),
      },
    };

    const existing = { id: "old", name: "Old", path: "geosite/old.mrs" };
    const result = useRunHook({ 0: "ai", 1: [existing], 2: false, 3: false, 5: 1, 6: 2 }, { runEffects: false });
    result.handleLoadMore();
    await flushPromises();

    const keepPrevious = mocks.state.setters[1].mock.calls.at(-1)?.[0] as (prev: any[]) => any[];
    expect(keepPrevious([existing])).toEqual([existing]);
    expect(mocks.state.setters[5]).toHaveBeenCalledWith(2);
    expect(mocks.state.setters[7]).not.toHaveBeenCalledWith(undefined);
    expect(mocks.state.setters[8]).not.toHaveBeenCalledWith("unknown");

    mocks.apiAdapter = { rules: { searchRules: vi.fn(() => Promise.reject("bad-load")) } };
    const failed = useRunHook({ 0: "ai", 1: [existing], 2: false, 3: false, 5: 1, 6: 2 }, { runEffects: false });
    failed.handleLoadMore();
    await flushPromises();

    expect(mocks.state.setters[4]).toHaveBeenCalledWith("加载失败");
    expect(mocks.state.setters[3]).toHaveBeenCalledWith(false);
  });

  it("drops stale load-more success and failure results without updating state", async () => {
    let resolveSearch: (value: unknown) => void = () => undefined;
    mocks.apiAdapter = {
      rules: {
        searchRules: vi.fn(() => new Promise((resolve) => {
          resolveSearch = resolve;
        })),
      },
    };

    const result = useRunHook({ 0: "ai", 1: [{ id: "old" }], 2: false, 3: false, 5: 1, 6: 2 }, { runEffects: false, refCurrent: 7 });
    result.handleLoadMore();
    mocks.state.refObject.current = 8;
    resolveSearch({ items: [{ id: "late" }], totalMatched: 2, source: "remote" });
    await flushPromises();

    expect(mocks.state.setters[1]).not.toHaveBeenCalled();
    expect(mocks.state.setters[3]).not.toHaveBeenCalledWith(false);

    let rejectSearch: (reason: unknown) => void = () => undefined;
    mocks.apiAdapter = {
      rules: {
        searchRules: vi.fn(() => new Promise((_, reject) => {
          rejectSearch = reject;
        })),
      },
    };

    const failed = useRunHook({ 0: "ai", 1: [{ id: "old" }], 2: false, 3: false, 5: 1, 6: 2 }, { runEffects: false, refCurrent: 11 });
    failed.handleLoadMore();
    mocks.state.refObject.current = 12;
    rejectSearch(new Error("late failure"));
    await flushPromises();

    expect(mocks.state.setters[4]).not.toHaveBeenCalledWith("late failure");
  });
});
