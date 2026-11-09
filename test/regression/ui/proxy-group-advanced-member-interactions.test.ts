import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addPatch: {} as Record<string, unknown>,
  captures: { headers: [] as any[], listItems: [] as any[] },
  cycleKeys: new Set<string>(),
  generated: [] as Array<Record<string, any>>,
  store: {} as Record<string, any>,
  toast: vi.fn(),
}));

const stateMock = vi.hoisted(() => ({
  enabled: false,
  value: null as string | null,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!stateMock.enabled) return actual.useState(initial);
      return [stateMock.value, vi.fn()];
    },
  };
});

vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const capture = (type: unknown, props: any) => {
    if (type === "div" && props?.role === "listitem") mocks.captures.listItems.push(props);
  };
  return {
    ...actual,
    jsx: (type: unknown, props: any, key?: unknown) => {
      capture(type, props);
      return actual.jsx(type as any, props, key as any);
    },
    jsxs: (type: unknown, props: any, key?: unknown) => {
      capture(type, props);
      return actual.jsxs(type as any, props, key as any);
    },
  };
});

vi.mock("lucide-react", () => ({ Plus: () => null, X: () => null }));
vi.mock("@subboost/ui/components/ui/badge", () => ({ Badge: (props: any) => React.createElement("span", null, props.children) }));
vi.mock("@subboost/ui/components/ui/button", () => ({ Button: (props: any) => React.createElement("button", null, props.children) }));
vi.mock("@subboost/ui/components/ui/choice-group", () => ({
  ChoiceChip: (props: any) => React.createElement("button", null, props.children),
  ChoiceGroup: (props: any) => React.createElement("div", null, props.children),
}));
vi.mock("@subboost/ui/components/ui/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("@subboost/ui/components/ui/form-field", () => ({ FormField: (props: any) => React.createElement("div", null, props.children) }));
vi.mock("@subboost/ui/components/ui/input", () => ({ Input: () => null }));
vi.mock("@subboost/ui/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("@subboost/ui/lib/utils", () => ({ cn: (...parts: unknown[]) => parts.filter(Boolean).join(" ") }));
vi.mock("@subboost/ui/store/config-store", () => ({ useConfigStore: () => mocks.store }));
vi.mock("@subboost/core/generator/proxy-groups", () => ({
  PROXY_GROUP_MODULES: [
    { id: "auto", name: "Auto", category: "core", groupType: "url-test", rules: [] },
    { id: "select", name: "Select", category: "core", groupType: "select", rules: [] },
  ],
  generateProxyGroups: () => mocks.generated,
}));
vi.mock(
  "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-member-bulk",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, any>>();
    return {
      ...actual,
      buildAddAllMembersPatch: () => mocks.addPatch,
      findCycleCreatingProxyGroupKeys: () => mocks.cycleKeys,
    };
  },
);
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-member-section-header", () => ({
  ProxyGroupMemberSectionHeader: (props: any) => {
    mocks.captures.headers.push(props);
    return null;
  },
}));

import { ProxyGroupAdvancedPanel } from "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-advanced-panel";

function renderPanel(draggingKey: string | null = null) {
  mocks.captures = { headers: [], listItems: [] };
  stateMock.enabled = true;
  stateMock.value = draggingKey;
  const onChange = vi.fn();
  try {
    const html = renderToStaticMarkup(React.createElement(ProxyGroupAdvancedPanel, {
      target: { kind: "custom", id: "media", name: "Media" },
      advanced: {},
      onChange,
      rulesCount: 0,
      rulesContent: null,
    }));
    return { html, onChange };
  } finally {
    stateMock.enabled = false;
  }
}

function excludedHeader() {
  return mocks.captures.headers.find((header) => header.mode === "excluded");
}

describe("UI component coverage: advanced proxy-group members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addPatch = {};
    mocks.cycleKeys = new Set();
    mocks.generated = [{
      name: "Media",
      proxies: ["DIRECT", "DIRECT", "Missing", "Media"],
    }];
    mocks.store = {
      nodes: [
        { name: "US Node", type: "ss", server: "us.test", port: 443 },
        { name: "DIRECT", type: "ss", server: "duplicate.test", port: 443 },
      ],
      nodeNameFilter: { enabled: false, excludeRegexes: [] },
      sources: [],
      enabledProxyGroups: ["auto", "select"],
      customProxyGroups: [
        { id: "media", name: "Media", groupType: "select" },
        { id: "other", name: "Auto", groupType: "select" },
        { id: "blank", name: "", groupType: "select" },
        { id: "invalid", name: null, groupType: "select" },
      ],
      customRuleSets: [],
      proxyGroupAdvanced: {},
      builtinRuleEdits: {},
      proxyGroupNameOverrides: {},
      testUrl: "https://example.com/generate_204",
      testInterval: 300,
      ruleProviderBaseUrl: "https://rules.example/",
    };
  });

  it("filters invalid, duplicate, and self candidates while accepting valid generated members", () => {
    const result = renderPanel();
    expect(result.html).toContain("DIRECT");
    expect(result.html).toContain("Media");
    expect(result.html).not.toContain("Missing");
  });

  it("ignores same-key and missing-source drops but reorders valid members", () => {
    let result = renderPanel("direct:DIRECT");
    const [directItem, mediaItem] = mocks.captures.listItems;
    directItem.onDrop();
    expect(result.onChange).not.toHaveBeenCalled();
    mediaItem.onDrop();
    expect(result.onChange).toHaveBeenCalledWith(expect.objectContaining({ memberOrder: expect.any(Array) }));

    result = renderPanel("missing:key");
    mocks.captures.listItems[0].onDrop();
    expect(result.onChange).not.toHaveBeenCalled();
  });

  it("normalizes a missing bulk-node order before applying the patch", () => {
    const result = renderPanel();
    excludedHeader().onNodeAction();
    expect(result.onChange).toHaveBeenCalledWith({ memberOrder: [] });
  });

  it("warns when every proxy group would create a cycle", () => {
    renderPanel();
    mocks.cycleKeys = new Set(["module:auto", "module:select", "custom:other"]);
    renderPanel();
    excludedHeader().onProxyGroupAction();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining("会形成循环"),
      variant: "warning",
    }));
  });

  it("adds safe proxy groups without a cycle warning", () => {
    mocks.addPatch = { memberOrder: [{ kind: "module", id: "select" }] };
    const result = renderPanel();
    excludedHeader().onProxyGroupAction();
    expect(result.onChange).toHaveBeenCalledWith({
      memberOrder: [{ kind: "module", id: "select" }],
    });
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("normalizes a missing bulk proxy-group order before applying the patch", () => {
    mocks.addPatch = {};
    const result = renderPanel();
    excludedHeader().onProxyGroupAction();
    expect(result.onChange).toHaveBeenCalledWith({ memberOrder: [] });
  });
});
