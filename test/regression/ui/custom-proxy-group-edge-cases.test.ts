import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stateMock = vi.hoisted(() => ({
  index: 0,
  overrides: {} as Record<number, unknown>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
}));

const mocks = vi.hoisted(() => ({
  confirmDialog: vi.fn(),
  interactions: { proxyGroupAdded: vi.fn() },
  store: {} as Record<string, any>,
  toast: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => {
      const index = stateMock.index++;
      const value = Object.prototype.hasOwnProperty.call(stateMock.overrides, index)
        ? stateMock.overrides[index]
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
      stateMock.setters[index] = setter;
      return [value, setter];
    },
  };
});

vi.mock("@subboost/ui/components/ui/confirm-dialog", () => ({ confirmDialog: mocks.confirmDialog }));
vi.mock("@subboost/ui/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("@subboost/ui/store/config-store", () => {
  const useConfigStore = () => mocks.store;
  (useConfigStore as any).getState = () => mocks.store;
  return { useConfigStore };
});
vi.mock("@subboost/ui/product/interactions", () => ({
  useProductInteractionAdapter: () => mocks.interactions,
}));

import { PROXY_GROUP_MODULES } from "@subboost/core/generator/proxy-groups";
import { ProxyGroupAdvancedPanel } from "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-advanced-panel";
import {
  ProxyGroupRuleMoveMenu,
  ProxyGroupRuleSetRow,
} from "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-rule-row";
import { ProxyGroupsModuleCard } from "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-groups-module-card";
import { GroupAdvancedSettingsDialog } from "../../../packages/ui/src/product/converter/advanced-mode/sections/group-advanced-settings-dialog";
import { ProxyGroupsCustomGroupsPanel } from "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-groups-custom-groups-panel";

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

const sourceGroup = {
  id: "source",
  name: "Source",
  emoji: "",
  groupType: "select",
};
const blankTargetGroup = {
  id: "blank",
  name: "   ",
  emoji: "",
  groupType: "select",
};

function renderPanel(overrides: Record<number, unknown> = {}) {
  stateMock.index = 0;
  stateMock.overrides = overrides;
  stateMock.setters = [];
  const tree = ProxyGroupsCustomGroupsPanel({ advancedMode: true });
  const moduleCards = collectElements(tree, (element) => element.type === ProxyGroupsModuleCard).map((element) => element.props);
  const settingsDialogs = collectElements(tree, (element) => element.type === GroupAdvancedSettingsDialog).map((element) => element.props);
  return { moduleCards, settingsDialogs, tree };
}

function collectMoveMenus(rulesContent: React.ReactNode) {
  const ruleRows = collectElements(rulesContent, (element) => element.type === ProxyGroupRuleSetRow);
  return ruleRows.flatMap((row) =>
    collectElements(row.props.actions, (element) => element.type === ProxyGroupRuleMoveMenu)
      .map((element) => element.props),
  );
}

function baseStore() {
  const builtinModule = PROXY_GROUP_MODULES.find((module) => module.rules?.length) as any;
  const builtinRule = builtinModule.rules[0];
  return {
    enabledProxyGroups: PROXY_GROUP_MODULES.map((module) => module.id),
    hiddenProxyGroups: [],
    proxyGroupNameOverrides: {},
    customRules: [],
    customRuleSets: [
      {
        id: "custom-rule",
        name: "Custom Rule",
        behavior: "domain",
        path: "geosite/custom.mrs",
        target: { kind: "custom", id: sourceGroup.id },
      },
    ],
    builtinRuleEdits: {
      disabled: { enabled: false },
      noTarget: { enabled: true },
      malformed: { target: { kind: "custom", id: sourceGroup.id } },
      "module:missing:rule": { target: { kind: "custom", id: sourceGroup.id } },
      [`module:${builtinModule.id}:missing`]: { target: { kind: "custom", id: sourceGroup.id } },
      [`module:${builtinModule.id}:${builtinRule.id}`]: { target: { kind: "custom", id: sourceGroup.id } },
    },
    customProxyGroups: [sourceGroup, blankTargetGroup],
    addCustomProxyGroup: vi.fn(),
    removeCustomProxyGroup: vi.fn(),
    updateCustomProxyGroup: vi.fn(),
    updateCustomRule: vi.fn(),
    removeCustomRule: vi.fn(),
    moveModuleRule: vi.fn(),
    removeModuleRule: vi.fn(),
    dialerProxyGroups: [],
    groupListeners: [],
    setGroupListener: vi.fn(),
    dnsYaml: "",
    mixedPort: 7890,
    listenerPorts: {},
  };
}

describe("UI component coverage: custom proxy groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store = baseStore();
    mocks.confirmDialog.mockResolvedValue(true);
  });

  it("ignores malformed moved-rule edits and invalid move-menu values", () => {
    const result = renderPanel({ 0: new Set([sourceGroup.id]) });
    const sourceCard = result.moduleCards.find((card) => card.module.id === sourceGroup.id);
    const moveMenus = collectMoveMenus(sourceCard.rulesContentOverride);
    expect(moveMenus.length).toBe(2);

    moveMenus[0].onMove({ kind: "listener" });
    moveMenus[1].onMove({ kind: "listener" });
    expect(mocks.store.moveModuleRule).not.toHaveBeenCalled();
  });

  it("does not move a custom rule set to a target whose name is blank", () => {
    const result = renderPanel({ 0: new Set([sourceGroup.id]) });
    const sourceCard = result.moduleCards.find((card) => card.module.id === sourceGroup.id);
    const moveMenus = collectMoveMenus(sourceCard.rulesContentOverride);

    moveMenus[0].onMove({ kind: "custom", id: blankTargetGroup.id, name: "" });
    expect(mocks.store.moveModuleRule).not.toHaveBeenCalled();
  });

  it("uses an empty advanced object and merges patches without erasing existing settings", () => {
    let result = renderPanel();
    let sourceCard = result.moduleCards.find((card) => card.module.id === sourceGroup.id);
    let advancedElement = sourceCard.renderAdvancedContent("rules", 1) as React.ReactElement<Record<string, any>>;
    expect(advancedElement.type).toBe(ProxyGroupAdvancedPanel);
    expect(advancedElement.props.advanced).toEqual({});
    advancedElement.props.onChange({ includeAll: true });
    expect(mocks.store.updateCustomProxyGroup).toHaveBeenCalledWith(sourceGroup.id, {
      advanced: { includeAll: true },
    });

    mocks.store.customProxyGroups = [{ ...sourceGroup, advanced: { excludeRegex: "test" } }];
    result = renderPanel();
    sourceCard = result.moduleCards[0];
    advancedElement = sourceCard.renderAdvancedContent("rules", 0) as React.ReactElement<Record<string, any>>;
    expect(advancedElement.props.rulesContent).toBeNull();
    advancedElement.props.onChange({ includeAll: true });
    expect(mocks.store.updateCustomProxyGroup).toHaveBeenCalledWith(sourceGroup.id, {
      advanced: { excludeRegex: "test", includeAll: true },
    });
  });

  it("keeps an open settings dialog and saves enabled, disabled, and removed listeners", () => {
    let result = renderPanel({ 6: sourceGroup.id });
    let dialog = result.settingsDialogs[0];
    dialog.onOpenChange(true);
    expect(stateMock.setters[6]).not.toHaveBeenCalled();
    dialog.onOpenChange(false);
    expect(stateMock.setters[6]).toHaveBeenCalledWith(null);

    dialog.onSave({ groupType: "load-balance", strategy: undefined, listener: null });
    expect(mocks.store.updateCustomProxyGroup).toHaveBeenCalledWith(sourceGroup.id, {
      groupType: "load-balance",
      strategy: "consistent-hashing",
    });
    expect(mocks.store.setGroupListener).toHaveBeenCalledWith(
      { kind: "custom", id: sourceGroup.id },
      null,
    );

    mocks.store.customProxyGroups = [{ ...sourceGroup, strategy: "round-robin" }];
    result = renderPanel({ 6: sourceGroup.id });
    dialog = result.settingsDialogs[0];
    dialog.onSave({ groupType: "select", strategy: "round-robin", listener: { port: 9020, enabled: false, allowLan: true } });
    expect(mocks.store.updateCustomProxyGroup).toHaveBeenCalledWith(sourceGroup.id, {
      groupType: "select",
      strategy: undefined,
    });
    expect(mocks.store.setGroupListener).toHaveBeenCalledWith(
      { kind: "custom", id: sourceGroup.id },
      { port: 9020, enabled: false, allowLan: true },
    );
  });
});
