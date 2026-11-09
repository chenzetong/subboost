// @ts-expect-error public coverage tests render with the public React runtime.
import * as React from "../../../node_modules/react";
// @ts-expect-error public coverage tests render with the public ReactDOM server runtime.
import { renderToStaticMarkup } from "../../../node_modules/react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captures: {} as Record<string, any>,
  store: {} as Record<string, any>,
  interactions: {
    proxyGroupAdded: vi.fn(),
  },
  toast: vi.fn(),
}));

const stateMock = vi.hoisted(() => ({
  enabled: false,
  callIndex: 0,
  overrides: {} as Record<number, unknown>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
}));

function mockReactModule(actual: typeof React) {
  return {
    ...actual,
    useCallback: (fn: unknown) => fn,
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => {
      if (!stateMock.enabled) return actual.useState(initial);
      const index = stateMock.callIndex++;
      const value = Object.prototype.hasOwnProperty.call(stateMock.overrides, index)
        ? stateMock.overrides[index]
        : typeof initial === "function"
          ? (initial as () => unknown)()
          : initial;
      const setter = vi.fn((next: unknown) => {
        const resolved = typeof next === "function" ? (next as (prev: unknown) => unknown)(value) : next;
        (setter as any).lastValue = resolved;
        return resolved;
      });
      stateMock.setters[index] = setter;
      return [value, setter];
    },
  };
}

vi.mock("react", async (importOriginal) => mockReactModule(await importOriginal<typeof import("react")>()));
vi.mock("../../../node_modules/react/index.js", async (importOriginal) =>
  mockReactModule(await importOriginal<typeof import("react")>())
);

function mockJsxRuntime(actual: typeof import("react/jsx-runtime")) {
  const capture = (type: unknown, props: any, key?: unknown) => {
    if (typeof type === "string") {
      (mocks.captures.intrinsics ||= []).push({ type, props: props ?? {}, key });
    }
  };
  return {
    ...actual,
    jsx: (type: unknown, props: any, key?: unknown) => {
      capture(type, props, key);
      return actual.jsx(type as any, props, key as any);
    },
    jsxs: (type: unknown, props: any, key?: unknown) => {
      capture(type, props, key);
      return actual.jsxs(type as any, props, key as any);
    },
  };
}

vi.mock("react/jsx-runtime", async (importOriginal) =>
  mockJsxRuntime(await importOriginal<typeof import("react/jsx-runtime")>())
);
vi.mock(
  "../../../node_modules/react/jsx-runtime.js",
  async (importOriginal) => mockJsxRuntime(await importOriginal<typeof import("react/jsx-runtime")>())
);
vi.mock("lucide-react", () => ({
  Check: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  Pencil: () => null,
  SlidersHorizontal: () => null,
  Trash2: () => null,
  X: () => null,
}));
vi.mock("@subboost/ui/components/ui/button", () => ({
  Button: (props: any) => {
    mocks.captures.buttons.push(props);
    return React.createElement("button", props, props.children);
  },
}));
vi.mock("@subboost/ui/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("@subboost/core/generator/proxy-groups", () => ({
  PROXY_GROUP_MODULES: [
    { id: "auto", name: "Auto" },
    { id: "fallback", name: "Fallback" },
  ],
}));
vi.mock("@subboost/core/proxy-group-name", () => ({
  resolveProxyGroupModuleName: (module: { name: string }, override?: string) => override || module.name,
}));
vi.mock("@subboost/core/rules/custom-routing-rule-sets", () => ({
  extractRuleSetPathFromUrl: (url: string) => url.replace(/^https?:\/\/rules\.example\//, ""),
}));
vi.mock("@subboost/core/types/config", () => ({ DEFAULT_LOAD_BALANCE_STRATEGY: "consistent-hashing" }));
vi.mock("@subboost/ui/store/config-store", () => {
  const useConfigStore = () => mocks.store;
  (useConfigStore as any).getState = () => mocks.store;
  return { useConfigStore };
});
vi.mock("@subboost/ui/product/interactions", () => ({ useProductInteractionAdapter: () => mocks.interactions }));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-rule-targets", () => ({
  buildManualRuleTargets: vi.fn(() => [{ name: "Auto" }]),
  listCustomRulesForTarget: vi.fn(() => []),
}));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-rule-row", () => ({
  ProxyGroupManualRuleRow: (props: any) => {
    mocks.captures.manualRows.push(props);
    return null;
  },
  ProxyGroupRuleMoveMenu: (props: any) => {
    mocks.captures.moveMenus.push(props);
    return null;
  },
  ProxyGroupRuleSetRow: (props: any) => {
    mocks.captures.ruleRows.push(props);
    return props.actions;
  },
  isRuleSetMoveTarget: (value: unknown) => Boolean(value && typeof value === "object"),
}));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-type-menu", () => ({
  ProxyGroupTypeMenu: (props: any) => {
    mocks.captures.typeMenus.push(props);
    return props.trigger ?? null;
  },
  getLoadBalanceStrategyLabel: (value: string) => `strategy:${value}`,
  getProxyGroupTypeLabel: (value: string) => `type:${value}`,
}));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-name-editor", () => ({
  ProxyGroupNameEditor: (props: any) => {
    mocks.captures.nameEditors.push(props);
    return null;
  },
  buildProxyGroupName: (draft: { emoji?: string; name?: string }) => {
    const emoji = String(draft.emoji ?? "").trim();
    const name = String(draft.name ?? "").trim();
    return name ? `${emoji ? `${emoji} ` : ""}${name}` : "";
  },
  parseProxyGroupNameDraft: (name: string, emoji: string) => ({
    emoji,
    name: emoji ? name.replace(emoji, "").trim() : name.trim(),
  }),
  pickRandomEmoji: () => "C",
  toProxyGroupNameDraft: (draft: { emoji?: string; name?: string }) => ({
    emoji: String(draft.emoji ?? ""),
    name: String(draft.name ?? ""),
  }),
}));
vi.mock(
  "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-groups-module-card",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, any>>();
    return {
      ...actual,
      ProxyGroupsModuleCard: (props: any) => {
        mocks.captures.moduleCards.push(props);
        return React.createElement(actual.ProxyGroupsModuleCard, props);
      },
    };
  },
);
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/group-advanced-settings-dialog", () => ({
  GroupAdvancedSettingsDialog: (props: any) => {
    mocks.captures.settingsDialogs.push(props);
    return null;
  },
}));

import { ProxyGroupsCustomGroupsPanel } from "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-groups-custom-groups-panel";

const customGroup = {
  id: "custom-1",
  name: "Custom",
  groupType: "select",
};

function resetCaptures() {
  mocks.captures = {
    buttons: [],
    intrinsics: [],
    manualRows: [],
    moduleCards: [],
    moveMenus: [],
    nameEditors: [],
    ruleRows: [],
    settingsDialogs: [],
    typeMenus: [],
  };
}

function renderPanel(overrides: Record<number, unknown> = {}) {
  stateMock.enabled = true;
  stateMock.callIndex = 0;
  stateMock.overrides = overrides;
  stateMock.setters = [];
  resetCaptures();
  try {
    const html = renderToStaticMarkup(React.createElement(ProxyGroupsCustomGroupsPanel));
    return { html, setters: stateMock.setters };
  } finally {
    stateMock.enabled = false;
  }
}

describe("public ProxyGroupsCustomGroupsPanel extra branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCaptures();
    mocks.store = {
      ruleProviderBaseUrl: "https://rules.example/",
      enabledProxyGroups: ["auto"],
      hiddenProxyGroups: [],
      proxyGroupNameOverrides: { auto: "Auto" },
      customRules: [],
      customRuleSets: [{ id: "custom-rule", name: "Custom Rule", behavior: "domain", path: "geosite/custom.mrs", target: "Custom" }],
      customProxyGroups: [customGroup],
      dialerProxyGroups: [null, { name: 456 }, { name: "Dialer" }],
      addCustomProxyGroup: vi.fn(),
      removeCustomProxyGroup: vi.fn(),
      updateCustomProxyGroup: vi.fn(),
      updateCustomRule: vi.fn(),
      removeCustomRule: vi.fn(),
      setGroupListener: vi.fn(),
      toggleProxyGroup: vi.fn(),
      addModuleRules: vi.fn(),
    };
  });

  it("covers new-group empty guard, manual defaults, and duplicate-name source collection", () => {
    renderPanel();
    mocks.captures.buttons.find((props: any) => props.title === "新增").onClick();
    expect(mocks.store.addCustomProxyGroup).not.toHaveBeenCalled();

    renderPanel({ 1: { emoji: "", name: "Load" } });

    mocks.captures.buttons.find((props: any) => props.title === "新增").onClick();
    expect(mocks.store.addCustomProxyGroup).toHaveBeenCalledWith({
      name: "Load",
      emoji: "",
      description: "",
      groupType: "select",
    });
    expect(mocks.interactions.proxyGroupAdded).toHaveBeenCalledWith({ groupType: "select" });
  });

  it("covers custom group expand toggles, editing no-op, empty rename, and type fallback strategy", () => {
    let result = renderPanel();
    mocks.captures.intrinsics.find(
      (element: any) => element.type === "button" && element.props["aria-expanded"] === false
    ).props.onClick();
    expect(Array.from(result.setters[0].mock.results.at(-1)?.value ?? [])).toEqual(["custom-1"]);

    result = renderPanel({ 0: new Set(["custom-1"]) });
    mocks.captures.intrinsics.find(
      (element: any) => element.type === "button" && element.props["aria-expanded"] === true
    ).props.onClick();
    expect(Array.from(result.setters[0].mock.results.at(-1)?.value ?? [])).toEqual([]);

    result = renderPanel({ 3: "custom-1", 4: "   " });
    mocks.captures.nameEditors.find((props: any) => props.autoFocus).onKeyDown({ key: "Enter" });
    expect(mocks.store.updateCustomProxyGroup).not.toHaveBeenCalled();

    mocks.store.customProxyGroups = [{ id: "custom-1", name: "No Emoji", groupType: "select" }];
    renderPanel();
    mocks.captures.buttons.find((props: any) => props.title === "改名").onClick({ stopPropagation: vi.fn() });
    expect(stateMock.setters[4]).toHaveBeenCalledWith("No Emoji");

    mocks.captures.moduleCards[0].onOpenAdvancedSettings();
    expect(stateMock.setters[6]).toHaveBeenCalledWith("custom-1");

    renderPanel({ 6: "custom-1" });
    mocks.captures.settingsDialogs[0].onSave({
      groupType: "load-balance",
      listener: null,
      strategy: undefined,
    });
    expect(mocks.store.updateCustomProxyGroup).toHaveBeenCalledWith("custom-1", {
      groupType: "load-balance",
      strategy: "consistent-hashing",
    });
  });
});
