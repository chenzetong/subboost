import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactState = vi.hoisted(() => ({
  index: 0,
  overrides: {} as Record<number, unknown>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
}));

const mocks = vi.hoisted(() => ({
  confirmDialog: vi.fn(),
  store: {} as Record<string, any>,
  toast: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useEffect: () => undefined,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const index = reactState.index++;
      const value = Object.prototype.hasOwnProperty.call(reactState.overrides, index)
        ? reactState.overrides[index]
        : typeof initial === "function"
          ? (initial as () => unknown)()
          : initial;
      const setter = vi.fn((next: unknown) => {
        const resolved = typeof next === "function"
          ? (next as (previous: unknown) => unknown)(value)
          : next;
        (setter as any).lastValue = resolved;
        return resolved;
      });
      reactState.setters[index] = setter;
      return [value, setter];
    },
  };
});

vi.mock("lucide-react", () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
  RotateCcw: () => null,
}));
vi.mock("@subboost/ui/components/ui/badge", () => ({ Badge: (props: any) => React.createElement("span", null, props.children) }));
vi.mock("@subboost/ui/components/ui/button", () => ({ Button: (props: any) => React.createElement("button", null, props.children) }));
vi.mock("@subboost/ui/components/ui/confirm-dialog", () => ({ confirmDialog: mocks.confirmDialog }));
vi.mock("@subboost/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: (props: any) => React.createElement("div", null, props.children),
  DropdownMenuContent: (props: any) => React.createElement("div", null, props.children),
  DropdownMenuItem: (props: any) => React.createElement("button", { onClick: props.onClick }, props.children),
  DropdownMenuLabel: (props: any) => React.createElement("span", null, props.children),
  DropdownMenuTrigger: (props: any) => React.createElement("span", null, props.children),
}));
vi.mock("@subboost/ui/components/ui/switch", () => ({ Switch: () => null }));
vi.mock("@subboost/ui/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("@subboost/ui/store/config-store", () => ({ useConfigStore: () => mocks.store }));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-groups-custom-groups-panel", () => ({
  ProxyGroupsCustomGroupsPanel: () => null,
}));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-groups-custom-routing-rules", () => ({
  ProxyGroupsCustomRoutingRules: () => null,
}));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-groups-module-card", () => ({
  ProxyGroupsModuleCard: () => null,
}));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-advanced-panel", () => ({
  ProxyGroupAdvancedPanel: () => null,
}));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/group-advanced-settings-dialog", () => ({
  GroupAdvancedSettingsDialog: () => null,
}));

import { CATEGORY_INFO, PROXY_GROUP_MODULES } from "@subboost/core/generator/proxy-groups";
import { ProxyGroupsCategories } from "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-groups-categories";

function collectElements(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<Record<string, any>>) => boolean,
  output: Array<React.ReactElement<Record<string, any>>> = [],
) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    const element = child as React.ReactElement<Record<string, any>>;
    if (predicate(element)) output.push(element);
    collectElements(element.props.children, predicate, output);
  });
  return output;
}

function collectText(node: React.ReactNode, output: string[] = []) {
  React.Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") output.push(String(child));
    else if (React.isValidElement(child)) collectText((child.props as any).children, output);
  });
  return output.join("");
}

function renderCategories(overrides: Record<number, unknown> = {}) {
  reactState.index = 0;
  reactState.overrides = {
    0: new Set(Object.keys(CATEGORY_INFO)),
    ...overrides,
  };
  reactState.setters = [];
  const tree = ProxyGroupsCategories();
  const moduleCards = collectElements(tree, (element) => Boolean(element.props.module && element.props.onToggleEnabled))
    .map((element) => element.props);
  const settingsDialogs = collectElements(tree, (element) => Boolean(element.props.listenerTarget && element.props.onSave))
    .map((element) => element.props);
  return { moduleCards, settingsDialogs, tree };
}

function baseStore() {
  return {
    ruleProviderBaseUrl: "https://rules.example/",
    nodes: [],
    nodeNameFilter: { enabled: false, excludeRegexes: [] },
    testUrl: "https://example.com/generate_204",
    testInterval: 300,
    cnIpNoResolve: false,
    setCnIpNoResolve: vi.fn(),
    experimentalCnUseCnRuleSet: false,
    setExperimentalCnUseCnRuleSet: vi.fn(),
    enabledProxyGroups: PROXY_GROUP_MODULES.map((module) => module.id),
    hiddenProxyGroups: [],
    toggleProxyGroup: vi.fn(),
    hideProxyGroup: vi.fn(),
    restoreHiddenProxyGroup: vi.fn(),
    customRuleSets: [],
    builtinRuleEdits: {},
    moduleRuleEditWarningAccepted: true,
    customRules: [],
    updateCustomRule: vi.fn(),
    removeCustomRule: vi.fn(),
    addModuleRules: vi.fn(),
    removeModuleRule: vi.fn(),
    moveModuleRule: vi.fn(),
    restoreModuleRule: vi.fn(),
    resetModuleRuleTarget: vi.fn(),
    acceptModuleRuleEditWarning: vi.fn(),
    proxyGroupNameOverrides: {},
    setProxyGroupNameOverride: vi.fn(),
    clearProxyGroupNameOverride: vi.fn(),
    customProxyGroups: [{ id: "custom", name: "Custom", groupType: "select" }],
    proxyGroupAdvanced: {},
    proxyGroupAdvancedModeEnabled: true,
    setProxyGroupAdvancedModeEnabled: vi.fn(),
    updateProxyGroupAdvanced: vi.fn(),
    dialerProxyGroups: [],
    groupListeners: [],
    setGroupListener: vi.fn(),
    dnsYaml: "",
    mixedPort: 7890,
    listenerPorts: {},
  };
}

describe("UI component coverage: proxy-group categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store = baseStore();
    mocks.confirmDialog.mockResolvedValue(true);
  });

  it("renders the enabled advanced-mode status and ignores an empty module id", () => {
    const proxyModule = PROXY_GROUP_MODULES[0] as any;
    const originalId = proxyModule.id;
    try {
      proxyModule.id = null;
      mocks.store.enabledProxyGroups = [null];
      const result = renderCategories();
      expect(collectText(result.tree)).toContain("已开启");
      result.moduleCards.find((card) => card.module === proxyModule).onToggleRulesExpanded();
      expect(reactState.setters[3]).not.toHaveBeenCalled();
    } finally {
      proxyModule.id = originalId;
    }
  });

  it("tolerates a missing builtin edit map", () => {
    mocks.store.builtinRuleEdits = null;
    const result = renderCategories();
    expect(result.moduleCards.length).toBeGreaterThan(0);
  });

  it("ignores malformed edits and does not move a preset to an unknown target", () => {
    const source = PROXY_GROUP_MODULES.find((module) => module.rules?.length) as any;
    const rule = source.rules[0];
    const secondRule = source.rules.find((item: any) => !item.noResolve && item.id !== rule.id);
    const target = PROXY_GROUP_MODULES.find((module) => module.id !== source.id) as any;
    mocks.store.builtinRuleEdits = {
      malformed: { target: "Custom" },
      "module:missing:rule": { target: "Custom" },
      [`module:${source.id}:missing`]: { target: "Custom" },
      [`module:${source.id}:${rule.id}`]: { enabled: false, target: "Custom" },
      ...(secondRule && target
        ? { [`module:${source.id}:${secondRule.id}`]: { target: { kind: "module", id: target.id } } }
        : {}),
    };

    const result = renderCategories();
    const sourceCard = result.moduleCards.find((card) => card.module.id === source.id);
    expect(sourceCard.hiddenPresetRuleIds[source.id]).toContain(rule.id);
    expect(sourceCard.extraRules).toEqual([]);
    if (secondRule && target) {
      const targetCard = result.moduleCards.find((card) => card.module.id === target.id);
      expect(targetCard.extraRules).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: secondRule.id }),
      ]));
    }
  });

  it("opens module settings, preserves an open dialog, and saves both group-type branches", () => {
    const proxyModule = PROXY_GROUP_MODULES[0] as any;
    let result = renderCategories({ 4: proxyModule.id });
    let dialog = result.settingsDialogs[0];
    expect(dialog.groupType).toBe(proxyModule.groupType);
    dialog.onOpenChange(true);
    expect(reactState.setters[4]).not.toHaveBeenCalled();
    dialog.onOpenChange(false);
    expect(reactState.setters[4]).toHaveBeenCalledWith(null);

    dialog.onSave({ groupType: "load-balance", strategy: undefined, listener: null });
    expect(mocks.store.updateProxyGroupAdvanced).toHaveBeenCalledWith(proxyModule.id, {
      groupType: "load-balance",
      strategy: "consistent-hashing",
    });
    expect(mocks.store.setGroupListener).toHaveBeenCalledWith(
      { kind: "module", id: proxyModule.id },
      null,
    );

    mocks.store.proxyGroupAdvanced = { [proxyModule.id]: { groupType: "fallback", strategy: "round-robin" } };
    result = renderCategories({ 4: proxyModule.id });
    dialog = result.settingsDialogs[0];
    expect(dialog.groupType).toBe("fallback");
    dialog.onSave({ groupType: "fallback", strategy: "round-robin", listener: { port: 9001, enabled: false, allowLan: true } });
    expect(mocks.store.updateProxyGroupAdvanced).toHaveBeenCalledWith(proxyModule.id, {
      groupType: "fallback",
      strategy: undefined,
    });
    expect(mocks.store.setGroupListener).toHaveBeenCalledWith(
      { kind: "module", id: proxyModule.id },
      { port: 9001, enabled: false, allowLan: true },
    );
  });
});
