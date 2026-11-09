import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captures: {
    buttons: [] as Array<Record<string, unknown>>,
    chips: [] as Array<Record<string, unknown>>,
    dropdownItems: [] as Array<Record<string, unknown>>,
    dropdowns: [] as Array<Record<string, unknown>>,
    groups: [] as Array<Record<string, unknown>>,
  },
  getSubscriptionUserInfoDisplay: vi.fn(),
}));

vi.mock("lucide-react", () => ({
  HelpCircle: () => null,
  Menu: () => null,
  Plus: () => null,
}));

vi.mock("@subboost/ui/lib/utils", () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));

vi.mock("@subboost/ui/product/converter/source-type-info", () => ({
  sourceTypeInfo: {
    url: { label: "URL", description: "URL source", icon: () => null },
    yaml: { label: "YAML", description: "YAML source", icon: () => null },
    nodes: { label: "Nodes", description: "Node links", icon: () => null },
  },
}));

vi.mock("@subboost/ui/product/subscription/subscription-userinfo-display", () => ({
  getSubscriptionUserInfoDisplay: mocks.getSubscriptionUserInfoDisplay,
}));

vi.mock("@subboost/ui/components/ui/button", () => ({
  Button: (props: Record<string, unknown>) => {
    mocks.captures.buttons.push(props);
    return null;
  },
}));

vi.mock("@subboost/ui/components/ui/choice-group", () => ({
  ChoiceGroup: (props: Record<string, unknown>) => {
    mocks.captures.groups.push(props);
    return props.children;
  },
  ChoiceChip: (props: Record<string, unknown>) => {
    mocks.captures.chips.push(props);
    return null;
  },
}));

vi.mock("@subboost/ui/components/ui/dropdown-menu", () => ({
  DropdownMenu: (props: Record<string, unknown>) => {
    mocks.captures.dropdowns.push(props);
    return props.children;
  },
  DropdownMenuTrigger: (props: Record<string, unknown>) => props.children,
  DropdownMenuContent: (props: Record<string, unknown>) => props.children,
  DropdownMenuItem: (props: Record<string, unknown>) => {
    mocks.captures.dropdownItems.push(props);
    return null;
  },
}));

vi.mock("@subboost/ui/components/ui/popover", () => ({
  Popover: (props: Record<string, unknown>) => props.children,
  PopoverTrigger: (props: Record<string, unknown>) => props.children,
  PopoverContent: (props: Record<string, unknown>) => props.children,
  PopoverArrow: () => null,
}));

import {
  AddSourceMenu,
  SourceStatusPopover,
  SourceTypeChoices,
} from "@subboost/ui/product/converter/source-controls";

function render(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}

describe("source control state regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captures.buttons = [];
    mocks.captures.chips = [];
    mocks.captures.dropdownItems = [];
    mocks.captures.dropdowns = [];
    mocks.captures.groups = [];
  });

  it("renders every source choice in regular and compact states and forwards selection", () => {
    const onChange = vi.fn();

    render(React.createElement(SourceTypeChoices, { value: "url", onChange }));
    expect(mocks.captures.groups[0]).toMatchObject({
      label: "导入源类型",
      className: "gap-1",
    });
    expect(mocks.captures.chips.map((chip) => chip.selected)).toEqual([true, false, false]);
    for (const chip of mocks.captures.chips) {
      (chip.onClick as () => void)();
    }
    expect(onChange.mock.calls).toEqual([["url"], ["yaml"], ["nodes"]]);

    mocks.captures.chips = [];
    render(React.createElement(SourceTypeChoices, { value: "nodes", onChange, compact: true }));
    expect(mocks.captures.groups[1]).toMatchObject({ className: "gap-0.5" });
    expect(mocks.captures.chips.map((chip) => chip.selected)).toEqual([false, false, true]);
  });

  it("renders compact and descriptive add menus and forwards every source type", () => {
    const onOpenChange = vi.fn();
    const onAdd = vi.fn();

    render(React.createElement(AddSourceMenu, { open: false, onOpenChange, onAdd }));
    expect(mocks.captures.dropdowns[0]).toMatchObject({ open: false, onOpenChange });
    expect(mocks.captures.buttons[0].className).toContain("h-8");
    expect(mocks.captures.dropdownItems).toHaveLength(3);
    for (const item of mocks.captures.dropdownItems) {
      expect(item.className).toContain("py-2.5");
      (item.onSelect as () => void)();
    }
    expect(onAdd.mock.calls).toEqual([["url"], ["yaml"], ["nodes"]]);

    mocks.captures.buttons = [];
    mocks.captures.dropdownItems = [];
    render(React.createElement(AddSourceMenu, { open: true, onOpenChange, onAdd, compact: true }));
    expect(mocks.captures.buttons[0].className).toContain("h-7");
    expect(mocks.captures.dropdownItems).toHaveLength(3);
    expect(mocks.captures.dropdownItems.every((item) => String(item.className).includes("py-2"))).toBe(true);
  });

  it("shows no status before parsing and handles absent, traffic-only, and expiry-only info", () => {
    const nodes = [{ name: "A", type: "ss" }] as never[];
    const baseSource = { id: "source", type: "url", content: "https://example.test/sub" } as const;

    expect(SourceStatusPopover({ source: baseSource as never, nodes })).toBeNull();
    expect(
      SourceStatusPopover({ source: { ...baseSource, parsed: true } as never, nodes })
    ).toBeNull();

    mocks.getSubscriptionUserInfoDisplay.mockReturnValueOnce(null);
    render(
      React.createElement(SourceStatusPopover, {
        source: { ...baseSource, parsed: true, nodeCount: 1 } as never,
        nodes,
      })
    );

    mocks.getSubscriptionUserInfoDisplay.mockReturnValueOnce({ traffic: "1 GB" });
    render(
      React.createElement(SourceStatusPopover, {
        source: { ...baseSource, parsed: true, nodeCount: 1 } as never,
        nodes,
      })
    );

    mocks.getSubscriptionUserInfoDisplay.mockReturnValueOnce({ expire: "2030-01-01" });
    render(
      React.createElement(SourceStatusPopover, {
        source: { ...baseSource, parsed: true, nodeCount: 1 } as never,
        nodes,
      })
    );

    expect(mocks.getSubscriptionUserInfoDisplay).toHaveBeenCalledTimes(3);
  });
});
