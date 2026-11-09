// @ts-expect-error public coverage tests render with the public React runtime.
import * as React from "../../../node_modules/react";
// @ts-expect-error public coverage tests render with the public ReactDOM server runtime.
import { renderToStaticMarkup } from "../../../node_modules/react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captures: {} as Record<string, any>,
  confirmDialog: vi.fn(),
  effectiveRulesByModule: {} as Record<string, any[]>,
  interactions: {
    listenerPortConfigured: vi.fn(),
    proxyGroupAdded: vi.fn(),
    ruleAdded: vi.fn(),
    sourceAdded: vi.fn(),
    sourceImported: vi.fn(),
  },
  moveSubscriptionSource: vi.fn(),
  markSourceAsPendingImport: vi.fn(),
  search: {} as Record<string, any>,
  store: {} as Record<string, any>,
  toast: vi.fn(),
  user: null as any,
  userInfoDisplay: null as any,
}));

const stateMock = vi.hoisted(() => ({
  enabled: false,
  callIndex: 0,
  overrides: {} as Record<number, unknown>,
  runEffects: false,
  effects: [] as Array<() => void | (() => void)>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
}));

function mockReactModule(actual: typeof React) {
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void), deps?: React.DependencyList) => {
      if (!stateMock.enabled) return actual.useEffect(effect, deps);
      stateMock.effects.push(effect);
      if (stateMock.runEffects) return effect();
      return undefined;
    },
    useState: (initial: unknown) => {
      if (!stateMock.enabled) return actual.useState(initial);
      const index = stateMock.callIndex++;
      const value = Object.prototype.hasOwnProperty.call(stateMock.overrides, index)
        ? stateMock.overrides[index]
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

vi.mock("@radix-ui/react-popover", () => ({
  Root: ({ children }: React.PropsWithChildren) => React.createElement("div", null, children),
  Trigger: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
  Anchor: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
  Close: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
  Portal: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
  Content: ({ children }: React.PropsWithChildren) => React.createElement("section", null, children),
  Arrow: () => null,
}));
vi.mock("lucide-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("lucide-react")>()),
  AlertCircle: () => null,
  Check: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  ChevronUp: () => null,
  HelpCircle: () => null,
  Link: () => null,
  List: () => null,
  Loader2: () => null,
  Maximize2: () => null,
  Menu: () => null,
  Pencil: () => null,
  Plus: () => null,
  Search: () => null,
  Server: () => null,
  SlidersHorizontal: () => null,
  Trash2: () => null,
  X: () => null,
}));
vi.mock("@subboost/ui/components/ui/badge", () => ({
  Badge: (props: any) => React.createElement("span", props, props.children),
}));
vi.mock("@subboost/ui/components/ui/button", () => ({
  Button: (props: any) => {
    (mocks.captures.buttons ||= []).push(props);
    return React.createElement("button", props, props.children);
  },
}));
vi.mock("@subboost/ui/components/ui/confirm-dialog", () => ({ confirmDialog: mocks.confirmDialog }));
vi.mock("@subboost/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: (props: any) => {
    (mocks.captures.dropdownMenus ||= []).push(props);
    return props.children;
  },
  DropdownMenuContent: (props: any) => props.children,
  DropdownMenuItem: (props: any) => {
    (mocks.captures.dropdownItems ||= []).push(props);
    return React.createElement("button", { onClick: props.onSelect }, props.children);
  },
  DropdownMenuLabel: (props: any) => props.children,
  DropdownMenuSeparator: () => null,
  DropdownMenuSub: (props: any) => props.children,
  DropdownMenuSubContent: (props: any) => props.children,
  DropdownMenuSubTrigger: (props: any) => props.children,
  DropdownMenuTrigger: (props: any) => props.children,
}));
vi.mock("@subboost/ui/components/ui/input", () => ({
  Input: (props: any) => {
    (mocks.captures.inputs ||= []).push(props);
    return React.createElement("input", props);
  },
}));
vi.mock("@subboost/ui/components/ui/select", () => ({
  Select: (props: any) => {
    (mocks.captures.selects ||= []).push(props);
    return React.createElement("select", null, props.children);
  },
  SelectContent: (props: any) => React.createElement(React.Fragment, null, props.children),
  SelectItem: (props: any) => React.createElement("option", { value: props.value }, props.children),
  SelectTrigger: (props: any) => React.createElement(React.Fragment, null, props.children),
  SelectValue: (props: any) => React.createElement("span", null, props.placeholder),
}));
vi.mock("@subboost/ui/components/ui/switch", () => ({
  Switch: (props: any) => {
    (mocks.captures.switches ||= []).push(props);
    return React.createElement("button", props, props.children);
  },
}));
vi.mock("@subboost/ui/components/ui/textarea", () => ({
  Textarea: (props: any) => {
    (mocks.captures.textareas ||= []).push(props);
    return React.createElement("textarea", props);
  },
}));
vi.mock("@subboost/ui/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("@subboost/core/generator/proxy-groups", () => ({
  PROXY_GROUP_MODULES: [
    { id: "auto", name: "Auto", rules: [] },
    { id: "fallback", name: "Fallback", rules: [] },
  ],
}));
vi.mock("@subboost/core/generator/module-rules", () => ({
  getEffectiveModuleRules: (module: { id: string }) => mocks.effectiveRulesByModule[module.id] || [],
}));
vi.mock("@subboost/core/node-name-template", () => ({
  DEFAULT_NODE_NAME_TEMPLATE: "[{tag}] {name}",
  formatNodeNameFromTemplate: ({ originName, tag, template }: any) => `${template || "{name}"}:${tag || ""}:${originName}`,
}));
vi.mock("@subboost/core/proxy-group-name", () => ({
  resolveProxyGroupModuleName: (module: { name: string }, override?: string) => override || module.name,
  splitLeadingEmoji: (name: string) => {
    const trimmed = String(name || "").trim();
    const match = trimmed.match(/^(\S+)\s+(.+)$/);
    if (!match || /[A-Za-z0-9\u4e00-\u9fff]/.test(match[1])) return { hasEmojiPrefix: false, emoji: "", label: trimmed };
    return { hasEmojiPrefix: true, emoji: match[1], label: match[2] };
  },
}));
vi.mock("@subboost/core/rules/metadata", () => ({
  RULE_CATEGORIES: { streaming: { name: "流媒体" } },
}));
vi.mock("@subboost/core/subscription/import-error", () => ({
  normalizeSubscriptionImportErrorInfo: (value: any) => (value ? { message: value.message || String(value) } : null),
}));
vi.mock("@subboost/ui/lib/utils", () => ({ cn: (...parts: unknown[]) => parts.filter(Boolean).join(" ") }));
vi.mock("@subboost/ui/product/converter/source-display-label", () => ({
  buildSourceDisplayLabel: ({ typeLabel, order, total, tag }: any) => `${typeLabel} ${order}/${total}${tag ? ` ${tag}` : ""}`,
}));
vi.mock("@subboost/ui/product/converter/source-controls", () => ({
  AddSourceMenu: (props: any) => {
    mocks.captures.addSourceMenu = props;
    return null;
  },
  SourceStatusPopover: () => null,
  SourceTypeChoices: (props: any) => {
    (mocks.captures.sourceTypeChoices ||= []).push(props);
    return null;
  },
}));
vi.mock("@subboost/ui/product/converter/subscription-import-error", () => ({
  SubscriptionImportErrorBadge: (props: any) => React.createElement("span", null, props.errorMessage ?? props.errorInfo?.message ?? ""),
}));
vi.mock("@subboost/ui/product/interactions", () => ({ useProductInteractionAdapter: () => mocks.interactions }));
vi.mock("@subboost/ui/product/subscription/source-import-state", () => ({
  markSourceAsPendingImport: mocks.markSourceAsPendingImport,
}));
vi.mock("@subboost/ui/product/subscription/source-order", () => ({ moveSubscriptionSource: mocks.moveSubscriptionSource }));
vi.mock("@subboost/ui/product/subscription/subscription-userinfo-display", () => ({
  getSubscriptionUserInfoDisplay: () => mocks.userInfoDisplay,
}));
vi.mock("@subboost/ui/store/config-store", () => {
  const useConfigStore = () => mocks.store;
  (useConfigStore as any).getState = () => mocks.store;
  return {
    PRESET_RELAY_NAMES: ["香港中转", "日本中转"],
    getNodeSourceIds: (node: Record<string, unknown>) => (Array.isArray(node?._sourceIds) ? node._sourceIds : []),
    useConfigStore,
  };
});
vi.mock("@subboost/ui/store/user-store", () => ({ useUserStore: () => ({ user: mocks.user }) }));
vi.mock("@subboost/ui/product/converter/advanced-mode/constants", () => ({
  sourceTypeInfo: {
    url: { label: "订阅链接", placeholder: "https://example.com/sub", icon: () => null },
    yaml: { label: "YAML 配置", placeholder: "proxies:", icon: () => null },
    nodes: { label: "节点链接", placeholder: "ss://node", icon: () => null },
  },
}));
vi.mock("@subboost/ui/product/converter/advanced-mode/section-header", () => ({
  SectionHeader: (props: any) => {
    mocks.captures.header = props;
    return React.createElement("header", null, props.title, props.badge);
  },
}));
vi.mock("@subboost/ui/product/converter/advanced-mode/sections/input-source-editor-dialog", () => ({
  InputSourceEditorDialog: (props: any) => {
    mocks.captures.editor = props;
    return null;
  },
}));
vi.mock("@subboost/ui/product/converter/advanced-mode/sections/node-management/bulk-edit-dialog", () => ({
  NodeManagementBulkEditDialog: (props: any) => {
    mocks.captures.bulkDialog = props;
    return null;
  },
}));
vi.mock("@subboost/ui/product/converter/advanced-mode/sections/node-management/node-list", () => ({
  NodeManagementNodeList: (props: any) => {
    mocks.captures.nodeList = props;
    return null;
  },
}));
vi.mock("@subboost/ui/product/converter/advanced-mode/sections/proxy-groups-added-rule-sets", () => ({
  ProxyGroupsAddedRuleSets: (props: any) => {
    mocks.captures.addedRuleSets = props;
    return React.createElement("div", null, props.showSearchHint ? "search-hint" : "rule-sets");
  },
}));
vi.mock("@subboost/ui/product/converter/advanced-mode/sections/proxy-groups-rules-search", () => ({
  getRuleDisplayName: (rule: any) => rule.nameZh || rule.name || rule.id,
  replaceRuleProviderBase: (url: string, base: string) => {
    const match = url.match(/\/(geosite|geoip)\/[^/]+\.mrs$/);
    return match ? `${base.replace(/\/+$/, "")}/${match[1]}/${url.split("/").pop()}` : url;
  },
  useRulesLibrarySearch: () => mocks.search,
}));

import { DialerProxyGroupsSection } from "../../../packages/ui/src/product/converter/advanced-mode/sections/dialer-proxy-groups-section";
import { InputSection } from "../../../packages/ui/src/product/converter/advanced-mode/sections/input-section";
import { NodeManagementSection } from "../../../packages/ui/src/product/converter/advanced-mode/sections/node-management-section";
import { ProxyGroupsRulesLibrary } from "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-groups-rules-library";

const nodes = [
  { name: "Alpha", type: "ss", _sourceIds: ["s1"], _originName: "Alpha" },
  { name: "Beta", type: "vless", _sourceIds: ["s1"], _originName: "Beta" },
];

function render(component: React.ReactElement, overrides: Record<number, unknown> = {}) {
  stateMock.enabled = true;
  stateMock.callIndex = 0;
  stateMock.overrides = overrides;
  stateMock.effects = [];
  stateMock.setters = [];
  mocks.captures = { buttons: [], dropdownItems: [], dropdownMenus: [], inputs: [], intrinsics: [], selects: [], sourceTypeChoices: [], switches: [], textareas: [] };
  try {
    const html = renderToStaticMarkup(component);
    return { html, setters: stateMock.setters };
  } finally {
    stateMock.enabled = false;
    stateMock.runEffects = false;
  }
}

function textOf(children: unknown): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (React.isValidElement(children)) {
    const element = children as { props: { children?: unknown } };
    return textOf(element.props.children);
  }
  return "";
}

describe("public advanced UI extra branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markSourceAsPendingImport.mockImplementation((source) => ({ ...source, pendingImport: true }));
    mocks.moveSubscriptionSource.mockImplementation((sources) => sources);
    mocks.user = { isAdmin: false, quota: { maxImportSourcesPerType: 1 } };
    mocks.userInfoDisplay = { traffic: "1 GB", expire: "" };
    mocks.effectiveRulesByModule = {};
    mocks.search = {
      ruleSearchKeyword: "",
      setRuleSearchKeyword: vi.fn(),
      searchResults: [],
      rulesSearchLoading: false,
      rulesSearchLoadingMore: false,
      rulesSearchError: "",
      rulesSearchSource: "fresh",
      totalMatched: undefined,
      totalRules: 0,
      canLoadMore: false,
      handleLoadMore: vi.fn(),
    };
    mocks.store = {
      addDialerProxyGroup: vi.fn(),
      addModuleRules: vi.fn(),
      addNodeToDialerGroup: vi.fn(),
      bulkRenameNodes: vi.fn(),
      bulkSetListenerPorts: vi.fn(),
      customProxyGroups: [],
      deletedNodeNames: [],
      deletedNodes: [],
      dialerProxyGroups: [],
      enabledProxyGroups: ["auto"],
      hiddenProxyGroups: [],
      listenerPorts: {},
      customRuleSets: [],
      builtinRuleEdits: {},
      moveNode: vi.fn(),
      nodes,
      parseErrors: [],
      parseSingleSource: vi.fn(),
      proxyGroupNameOverrides: {},
      removeDialerProxyGroup: vi.fn(),
      removeNode: vi.fn(),
      removeNodeFromDialerGroup: vi.fn(),
      renameNode: vi.fn(),
      restoreDeletedNode: vi.fn(),
      restoreNodeName: vi.fn(),
      ruleProviderBaseUrl: "https://rules.example/",
      setListenerPort: vi.fn(),
      setNodeOrder: vi.fn(),
      setSources: vi.fn(),
      sources: [],
      toggleProxyGroup: vi.fn(),
      updateCustomProxyGroup: vi.fn(),
      updateDialerProxyGroup: vi.fn(),
    };
  });

  it("covers dialer edit guards, empty rows, and conflict cleanup combinations", () => {
    mocks.store.customProxyGroups = [{ name: 123 }, { name: " " }, { id: "filtered-a", name: "Filtered A" }];
    mocks.store.dialerProxyGroups = [
      { id: "g-a", name: " ", enabled: true, relayNodes: ["Alpha", "Beta"], targetNodes: [], type: "select" },
      { id: "g-b", name: 456, enabled: false, relayNodes: ["DIRECT", "Filtered A"], targetNodes: ["Alpha"], type: "select" },
    ];

    const { setters } = render(
      React.createElement(DialerProxyGroupsSection, { isExpanded: true, onToggle: vi.fn() }),
      { 0: new Set(["g-a"]), 1: true, 2: { emoji: "🔗", name: "" }, 3: "g-a", 4: { emoji: "", name: "" }, 5: { "g-a": "missing" }, 6: { "g-a": "missing" } }
    );

    expect(
      mocks.captures.intrinsics.some(
        (element: any) => element.type === "button" && element.props["aria-expanded"] === true
      )
    ).toBe(false);
    expect(setters[0]).not.toHaveBeenCalled();

    mocks.captures.inputs.find((input: any) => input.placeholder === "中转组名称").onKeyDown({ key: "Enter" });
    expect(mocks.store.updateDialerProxyGroup).not.toHaveBeenCalled();

    mocks.captures.inputs.find((input: any) => input.placeholder === "自定义名称").onKeyDown({ key: "Enter" });
    expect(mocks.store.addDialerProxyGroup).not.toHaveBeenCalled();

    mocks.captures.switches[0].onCheckedChange(true);
    expect(mocks.store.updateDialerProxyGroup).toHaveBeenCalledWith("g-b", {
      enabled: true,
      relayNodes: ["DIRECT", "Filtered A"],
      targetNodes: [],
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "已移除 1 个冲突落地节点",
    }));
  });

  it("covers dialer menu add paths, duplicate names, and target search empty state", () => {
    mocks.store.customProxyGroups = [{ name: "Custom Main" }, { id: "filtered-main", name: "Filtered Main" }];
    mocks.store.dialerProxyGroups = [
      { id: "g-menu", name: "Relay Menu", enabled: true, relayNodes: ["DIRECT"], targetNodes: [], type: "select" },
    ];

    const { html, setters } = render(
      React.createElement(DialerProxyGroupsSection, { isExpanded: true, onToggle: vi.fn() }),
      {
        0: new Set(["g-menu"]),
        1: true,
        2: { emoji: "", name: "Custom Main" },
        6: { "g-menu": "not-found" },
      }
    );

    expect(html).toContain("未找到匹配节点");

    mocks.captures.dropdownMenus.find((menu: any) => menu.open === true).onOpenChange(false);
    expect(setters[1]).toHaveBeenCalledWith(false);

    mocks.captures.inputs.find((input: any) => input.placeholder === "自定义名称").onKeyDown({ key: "Enter" });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "代理组名称已存在，请换一个名称。",
      variant: "warning",
    }));
    expect(mocks.store.addDialerProxyGroup).not.toHaveBeenCalled();

    mocks.captures.dropdownItems.find((item: any) => textOf(item.children) === "香港中转").onSelect();
    expect(mocks.store.addDialerProxyGroup).toHaveBeenCalledWith({
      name: "香港中转",
      enabled: true,
      relayNodes: [],
      targetNodes: [],
      type: "select",
    });
    expect(mocks.interactions.proxyGroupAdded).toHaveBeenCalledWith({ groupType: "dialer_select" });
    expect(setters[2]).toHaveBeenCalledWith({ emoji: "🔗", name: "" });
  });

  it("covers dialer enable cleanup when both relay and target nodes conflict", () => {
    mocks.store.dialerProxyGroups = [
      { id: "enabled", name: "Enabled", enabled: true, relayNodes: ["Beta"], targetNodes: ["Alpha"], type: "select" },
      { id: "disabled", name: "Disabled", enabled: false, relayNodes: ["DIRECT", "Alpha"], targetNodes: ["Beta"], type: "select" },
    ];

    render(React.createElement(DialerProxyGroupsSection, { isExpanded: true, onToggle: vi.fn() }));

    mocks.captures.switches[1].onCheckedChange(true);
    expect(mocks.store.updateDialerProxyGroup).toHaveBeenCalledWith("disabled", {
      enabled: true,
      relayNodes: ["DIRECT"],
      targetNodes: [],
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "中转组已启用并自动修正冲突",
      description: "已移除 1 个冲突中转节点；已移除 1 个冲突落地节点",
      variant: "warning",
    }));
  });

  it("covers node-management parsing and listener-port cleanup fallbacks", () => {
    stateMock.runEffects = true;
    mocks.store.nodes = [
      { name: "", type: "ss", _originName: " " },
      { name: "[HK] Alpha", type: "ss", _sourceIds: ["s1", "s2"], _originName: "Alpha" },
    ];
    mocks.store.sources = [
      { id: "s1", tag: "", nameTemplate: "{tag}-{name}" },
      { id: "s2", tag: "HK", nameTemplate: "{tag}-only" },
    ];
    mocks.store.deletedNodes = [{ originName: 123, name: 456 }, { originName: " Gone ", name: 789 }];
    mocks.store.deletedNodeNames = [123, "Gone"];
    mocks.store.listenerPorts = { "[HK] Alpha": 7891 };

    const { setters } = render(React.createElement(NodeManagementSection, { isExpanded: true, onToggle: vi.fn() }), {
      5: {},
      6: {},
    });

    expect(setters[4]).toHaveBeenCalledWith(true);
    expect(mocks.captures.nodeList.deletedMarkedNodes).toEqual([{ originName: "Gone", name: "Gone" }]);
    expect(mocks.captures.nodeList.resolveNodeNameParts({ name: "" })).toMatchObject({ baseName: "", canEditBase: true });
    expect(mocks.captures.nodeList.resolveNodeNameParts({ name: "HK-only", _sourceIds: ["s2"] })).toMatchObject({
      tag: "HK",
      baseName: "HK-only",
      canEditBase: false,
    });
    expect(mocks.captures.nodeList.resolveNodeNameParts({ name: "HK-", _sourceIds: ["s1", "s2"] })).toMatchObject({
      baseName: "HK-",
    });

    mocks.captures.nodeList.commitListenerPort("[HK] Alpha");
    expect(mocks.store.setListenerPort).toHaveBeenCalledWith("[HK] Alpha", 7891);
    mocks.captures.bulkDialog.onClearListenerPortUiState([123, " [HK] Alpha ", "[HK] Alpha"]);
    expect(setters[5]).toHaveBeenCalledWith(expect.any(Function));
    expect(setters[6]).toHaveBeenCalledWith(expect.any(Function));
  });

  it("covers input-section no-op updates, admin quotas, parsing states, and partial userinfo display", async () => {
    mocks.user = { isAdmin: true, quota: { maxImportSourcesPerType: 0 } };
    mocks.store.sources = [
      { id: "s1", type: "url", content: "https://example.com/sub", tag: "", parsed: true, nodeCount: 1, parsing: true },
    ];

    const { html } = render(React.createElement(InputSection, { isExpanded: true, onToggle: vi.fn() }), {
      0: true,
      1: "s1",
      2: {
        id: "s1",
        content: "https://example.com/sub",
        tag: "",
        nameTemplate: "",
        useProxyProviders: false,
        userinfoUrl: "",
        userinfoUserAgent: "",
      },
    });

    expect(html).toContain("导入中");
    mocks.captures.editor.onClose();
    expect(mocks.store.parseSingleSource).not.toHaveBeenCalled();

    mocks.captures.inputs.find((input: any) => input.placeholder === "https://example.com/sub").onChange({
      target: { value: "https://example.com/sub" },
    });
    expect(mocks.markSourceAsPendingImport).not.toHaveBeenCalled();

    mocks.captures.editor.onUpdateMeta("s1", { tag: "" });
    expect(mocks.markSourceAsPendingImport).not.toHaveBeenCalled();

    mocks.store.setSources.mockClear();
    mocks.captures.buttons.find((button: any) => button["aria-label"] === "下移")?.onClick?.();
    expect(mocks.store.setSources).not.toHaveBeenCalled();

    mocks.captures.buttons.find((button: any) => button.title === "导入中...")?.onClick?.();
    await Promise.resolve();
    expect(mocks.store.parseSingleSource).not.toHaveBeenCalled();

    mocks.captures.addSourceMenu.onAdd("url");
    expect(mocks.store.setSources).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ type: "url" })]));
  });

  it("covers rules-library empty summaries, fallbacks, loading-more, and long conflicts", () => {
    const rules = Array.from({ length: 10 }, (_, index) => ({
      id: `rule-${index}`,
      nameZh: `Rule ${index}`,
      behavior: index % 2 === 0 ? "ipcidr" : "domain",
      category: index === 0 ? "unknown" : "streaming",
      url: `https://raw.example/${index % 2 === 0 ? "geoip" : "geosite"}/rule-${index}.mrs`,
    }));
    mocks.search = {
      ...mocks.search,
      ruleSearchKeyword: "rules",
      searchResults: rules.slice(0, 2),
      rulesSearchLoadingMore: true,
      totalMatched: undefined,
      totalRules: 0,
      canLoadMore: true,
    };
    mocks.effectiveRulesByModule.auto = rules;
    mocks.store.customProxyGroups = [{ id: "custom", name: "Custom" }];
    mocks.store.customRuleSets = rules.map((rule) => ({
      id: rule.id,
      name: rule.nameZh,
      behavior: rule.behavior,
      path: rule.url,
      target: "Other",
    }));

    render(React.createElement(ProxyGroupsRulesLibrary), { 0: rules, 1: "custom:custom" });
    expect(mocks.captures.addedRuleSets).toEqual({ showSearchHint: false, totalRules: 0 });
    expect(mocks.captures.buttons.some((button: any) => textOf(button.children).includes("加载更多"))).toBe(true);
    mocks.captures.buttons.find((button: any) => button.children === "添加").onClick();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "规则集已在其他分流组中",
      description: expect.stringContaining("以及 2 条"),
    }));

    mocks.search.ruleSearchKeyword = "";
    mocks.search.searchResults = [];
    render(React.createElement(ProxyGroupsRulesLibrary));
    expect(mocks.captures.addedRuleSets).toEqual({ showSearchHint: true, totalRules: 0 });

    expect(mocks.store.addModuleRules).not.toHaveBeenCalled();
  });
});
