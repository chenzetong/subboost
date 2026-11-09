import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captures: {} as Record<string, any[]>,
  interactions: { proxyGroupAdded: vi.fn() },
  store: {} as Record<string, any>,
  toast: vi.fn(),
}));

const stateMock = vi.hoisted(() => ({
  index: 0,
  overrides: {} as Record<number, unknown>,
  setters: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = stateMock.index++;
      const value = Object.prototype.hasOwnProperty.call(stateMock.overrides, index)
        ? stateMock.overrides[index]
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

vi.mock("lucide-react", () => ({
  Check: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  Link: () => null,
  Pencil: () => null,
  Plus: () => null,
  Search: () => null,
  Shuffle: () => null,
  SlidersHorizontal: () => null,
  Trash2: () => null,
  X: () => null,
}));
vi.mock("@subboost/ui/components/ui/badge", () => ({ Badge: () => null }));
vi.mock("@subboost/ui/components/ui/button", () => ({
  Button: (props: any) => {
    mocks.captures.buttons.push(props);
    return null;
  },
}));
vi.mock("@subboost/ui/components/ui/confirm-dialog", () => ({ confirmDialog: vi.fn(async () => true) }));
vi.mock("@subboost/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: (props: any) => props.children,
  DropdownMenuContent: (props: any) => props.children,
  DropdownMenuItem: (props: any) => props.children,
  DropdownMenuLabel: (props: any) => props.children,
  DropdownMenuSeparator: () => null,
  DropdownMenuSub: (props: any) => props.children,
  DropdownMenuSubContent: (props: any) => props.children,
  DropdownMenuSubTrigger: (props: any) => props.children,
  DropdownMenuTrigger: (props: any) => props.children,
}));
vi.mock("@subboost/ui/components/ui/icon-button", () => ({ IconButton: () => null }));
vi.mock("@subboost/ui/components/ui/input", () => ({ Input: () => null }));
vi.mock("@subboost/ui/components/ui/switch", () => ({
  Switch: (props: any) => {
    mocks.captures.switches.push(props);
    return null;
  },
}));
vi.mock("@subboost/ui/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("@subboost/ui/lib/utils", () => ({ cn: (...parts: unknown[]) => parts.filter(Boolean).join(" ") }));
vi.mock("@subboost/ui/store/config-store", () => ({
  PRESET_RELAY_NAMES: [],
  useConfigStore: () => mocks.store,
}));
vi.mock("@subboost/ui/product/interactions", () => ({ useProductInteractionAdapter: () => mocks.interactions }));
vi.mock("@subboost/core/generator/proxy-groups", () => ({
  PROXY_GROUP_MODULES: [{ id: "auto", name: "Auto" }],
}));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/section-header", () => ({ SectionHeader: () => null }));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-summary", () => ({ ProxyGroupSummary: () => null }));
vi.mock("../../../packages/ui/src/product/converter/advanced-mode/sections/group-advanced-settings-dialog", () => ({
  GroupAdvancedSettingsDialog: (props: any) => {
    mocks.captures.dialogs.push(props);
    return null;
  },
}));

import { DialerProxyGroupsSection } from "../../../packages/ui/src/product/converter/advanced-mode/sections/dialer-proxy-groups-section";

const enabledGroup = {
  id: "enabled",
  name: "Enabled",
  enabled: true,
  relayNodes: ["Beta", "stale-relay"],
  targetNodes: ["Alpha", "stale-target"],
  type: "select",
};
const disabledGroup = {
  id: "disabled",
  name: "Disabled",
  enabled: false,
  relayNodes: ["Alpha", "DIRECT"],
  targetNodes: ["Beta"],
  type: "load-balance",
};

function renderSection(overrides: Record<number, unknown> = {}) {
  stateMock.index = 0;
  stateMock.overrides = overrides;
  stateMock.setters = [];
  mocks.captures = { buttons: [], dialogs: [], switches: [] };
  renderToStaticMarkup(React.createElement(DialerProxyGroupsSection, {
    isExpanded: true,
    onToggle: vi.fn(),
  }));
  return { setters: stateMock.setters };
}

function baseStore() {
  return {
    nodes: [
      { name: "Alpha", type: "ss" },
      { name: "Beta", type: "vless" },
    ],
    nodeNameFilter: { enabled: false, excludeRegexes: [] },
    dialerProxyGroups: [enabledGroup, disabledGroup],
    customProxyGroups: [],
    proxyGroupNameOverrides: {},
    addDialerProxyGroup: vi.fn(),
    removeDialerProxyGroup: vi.fn(),
    updateDialerProxyGroup: vi.fn(),
    addNodeToDialerGroup: vi.fn(),
    removeNodeFromDialerGroup: vi.fn(),
    groupListeners: [],
    setGroupListener: vi.fn(),
    dnsYaml: "",
    mixedPort: 7890,
    listenerPorts: {},
  };
}

describe("UI component coverage: dialer proxy groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.store = baseStore();
  });

  it("labels a load-balance dialer group with its default strategy", () => {
    renderSection();
    const advancedButton = mocks.captures.buttons.find(
      (button) => button["aria-label"] === "打开 Disabled 高级设置",
    );
    expect(advancedButton.title).toContain("负载均衡");
    expect(advancedButton.title).toContain("稳定分配");
  });

  it("ignores stale nodes from other groups while resolving enable conflicts", () => {
    renderSection();
    mocks.captures.switches.find((item) => item["aria-label"] === "启用 Disabled 中转组").onCheckedChange(true);
    expect(mocks.store.updateDialerProxyGroup).toHaveBeenCalledWith("disabled", {
      enabled: true,
      relayNodes: ["DIRECT"],
      targetNodes: [],
    });
  });

  it("keeps an open settings dialog and uses the global load-balance default", () => {
    renderSection({ 7: disabledGroup.id });
    const dialog = mocks.captures.dialogs[0];
    dialog.onOpenChange(true);
    expect(stateMock.setters[7]).not.toHaveBeenCalled();
    dialog.onOpenChange(false);
    expect(stateMock.setters[7]).toHaveBeenCalledWith(null);

    dialog.onSave({ groupType: "load-balance", strategy: undefined, listener: null });
    expect(mocks.store.updateDialerProxyGroup).toHaveBeenCalledWith(disabledGroup.id, {
      type: "load-balance",
      strategy: "consistent-hashing",
    });
    expect(mocks.store.setGroupListener).toHaveBeenCalledWith(
      { kind: "dialer", id: disabledGroup.id },
      null,
    );
  });

  it("falls back to the group's stored strategy before the global default", () => {
    mocks.store.dialerProxyGroups = [{ ...disabledGroup, strategy: "round-robin" }];
    renderSection({ 7: disabledGroup.id });
    mocks.captures.dialogs[0].onSave({
      groupType: "load-balance",
      strategy: undefined,
      listener: { port: 9010, enabled: false, allowLan: true },
    });
    expect(mocks.store.updateDialerProxyGroup).toHaveBeenCalledWith(disabledGroup.id, {
      type: "load-balance",
      strategy: "round-robin",
    });
    expect(mocks.store.setGroupListener).toHaveBeenCalledWith(
      { kind: "dialer", id: disabledGroup.id },
      { port: 9010, enabled: false, allowLan: true },
    );
  });
});
