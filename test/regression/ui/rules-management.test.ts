// @ts-expect-error public coverage tests render with the public React runtime.
import * as React from "../../../node_modules/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stateMock = vi.hoisted(() => {
  const state = {
    value: {} as Record<string, string>,
    setter: vi.fn((next: React.SetStateAction<Record<string, string>>) => {
      state.value = typeof next === "function" ? next(state.value) : next;
      return state.value;
    }),
  };
  return state;
});

const mocks = vi.hoisted(() => ({
  store: {} as Record<string, any>,
  entries: [] as Array<Record<string, any>>,
  confirmDialog: vi.fn(),
  buildGeneratedRuleEntries: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: (fn: unknown) => fn,
    useMemo: (factory: () => unknown) => factory(),
    useState: () => [stateMock.value, stateMock.setter],
  };
});
vi.mock("../../../node_modules/react/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: (fn: unknown) => fn,
    useMemo: (factory: () => unknown) => factory(),
    useState: () => [stateMock.value, stateMock.setter],
  };
});
vi.mock("lucide-react", () => ({
  ArrowDown: () => null,
  ArrowUp: () => null,
  ListOrdered: () => null,
}));
vi.mock("@subboost/ui/components/ui/badge", () => ({
  Badge: (props: any) => React.createElement("span", props, props.children),
}));
vi.mock("@subboost/ui/components/ui/confirm-dialog", () => ({ confirmDialog: mocks.confirmDialog }));
vi.mock("@subboost/ui/components/ui/input", () => ({
  Input: (props: any) => React.createElement("input", props),
}));
vi.mock("@subboost/ui/components/ui/switch", () => ({
  Switch: (props: any) => React.createElement("button", props),
}));
vi.mock("@subboost/core/generator/rules", () => ({
  buildGeneratedRuleEntries: mocks.buildGeneratedRuleEntries,
  hasFullRuleOrderKeys: (ruleOrder: string[] | undefined) =>
    Array.isArray(ruleOrder) && ruleOrder.some((key) => key.startsWith("module:") || key.startsWith("special:")),
}));
vi.mock("@subboost/ui/store/config-store", () => ({ useConfigStore: () => mocks.store }));
vi.mock("@subboost/ui/product/converter/advanced-mode/section-header", () => ({
  SectionHeader: (props: any) => React.createElement("header", props, props.title, props.badge),
}));

import { RulesManagementSection } from "../../../packages/ui/src/product/converter/advanced-mode/sections/rules-management-section";

function collectElements(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<Record<string, any>>) => boolean,
  out: Array<React.ReactElement<Record<string, any>>> = [],
) {
  React.Children.forEach(node, (child: unknown) => {
    if (!React.isValidElement(child)) return;
    const element = child as React.ReactElement<Record<string, any>>;
    if (predicate(element)) out.push(element);
    collectElements((element.props as { children?: React.ReactNode }).children, predicate, out);
  });
  return out;
}

function renderSection(overrides: Record<string, unknown> = {}) {
  mocks.store = {
    enabledProxyGroups: ["core"],
    customRules: [{ id: "custom" }],
    customProxyGroups: [],
    customRuleSets: [],
    builtinRuleEdits: {},
    proxyGroupNameOverrides: {},
    cnIpNoResolve: true,
    experimentalCnUseCnRuleSet: true,
    ruleOrder: ["custom:one"],
    setRuleOrder: vi.fn(),
    ...overrides,
  };
  return RulesManagementSection({ isExpanded: true, onToggle: vi.fn() });
}

beforeEach(() => {
  vi.clearAllMocks();
  stateMock.value = {};
  mocks.entries = [
    {
      key: "module:geo",
      editable: false,
      summary: "系统 GEO",
      sourceLabel: "系统规则",
      target: "DIRECT",
      noResolve: true,
      text: "GEOIP,CN,DIRECT,no-resolve",
    },
    {
      key: "custom:one",
      editable: true,
      summary: "自定义规则",
      sourceLabel: "用户规则",
      target: "节点选择",
      noResolve: false,
      text: "DOMAIN-SUFFIX,example.com,节点选择",
    },
    {
      key: "special:match",
      editable: false,
      summary: "兜底规则",
      sourceLabel: "系统规则",
      target: "MATCH",
      noResolve: false,
      text: "MATCH,DIRECT",
    },
  ];
  mocks.buildGeneratedRuleEntries.mockImplementation(() => mocks.entries);
});

describe("public RulesManagementSection extra branches", () => {
  it("keeps disabled order controls as no-ops", () => {
    stateMock.value = { "module:geo": "1", "special:match": "2" };
    const tree = renderSection();
    const orderInputs = collectElements(tree, (element) => (element.props as any).title === "最终规则行号（1=最前）");
    const upButtons = collectElements(tree, (element) => element.props.label === "上移规则");
    const downButtons = collectElements(tree, (element) => element.props.label === "下移规则");

    orderInputs[0].props.onChange({ target: { value: "2" } });
    orderInputs[0].props.onBlur();
    orderInputs[0].props.onKeyDown({ key: "Enter" });
    expect(mocks.store.setRuleOrder).not.toHaveBeenCalled();

    upButtons[0].props.onClick();
    downButtons[1].props.onClick();
    upButtons[2].props.onClick();
    expect(mocks.store.setRuleOrder).not.toHaveBeenCalled();
  });

  it("ignores invalid absolute order and removes stale MATCH drafts", () => {
    stateMock.value = { "custom:one": "bad", "special:match": "1" };
    const invalidTree = renderSection();
    const invalidInput = collectElements(invalidTree, (element) => (element.props as any).title === "最终规则行号（1=最前）")[1];
    invalidInput.props.onKeyDown({ key: "Enter" });
    invalidInput.props.onBlur();
    expect(mocks.store.setRuleOrder).not.toHaveBeenCalled();

    stateMock.value = { "module:geo": "2", "special:match": "1" };
    const allRulesTree = renderSection({ ruleOrder: ["module:geo", "custom:one"] });
    const moduleInput = collectElements(allRulesTree, (element) => (element.props as any).title === "最终规则行号（1=最前）")[0];
    moduleInput.props.onBlur();
    expect(mocks.store.setRuleOrder).toHaveBeenCalledWith(["custom:one", "module:geo"]);
    expect(stateMock.value).toEqual({});
  });
});
