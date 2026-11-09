import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedNode } from "../../../packages/core/src/types/node";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock("lucide-react", () => ({
  Check: () => React.createElement("span", null, "Check"),
  ChevronDown: () => React.createElement("span", null, "ChevronDown"),
  ChevronUp: () => React.createElement("span", null, "ChevronUp"),
  Pencil: () => React.createElement("span", null, "Pencil"),
  RotateCcw: () => React.createElement("span", null, "RotateCcw"),
  Trash2: () => React.createElement("span", null, "Trash2"),
  X: () => React.createElement("span", null, "X"),
}));
vi.mock("@subboost/ui/components/ui/badge", () => ({
  Badge: (props: any) => React.createElement("span", props, props.children),
}));
vi.mock("@subboost/ui/components/ui/input", () => ({
  Input: (props: any) => React.createElement("input", props),
}));
vi.mock("@subboost/ui/components/ui/protocol-badge", () => ({
  ProtocolBadge: (props: any) => React.createElement("span", null, `protocol:${props.type}`),
}));
vi.mock("@subboost/ui/components/ui/toaster", () => ({ toast: mocks.toast }));
vi.mock("@subboost/core/node-name-template", () => ({
  formatNodeNameFromTemplate: ({ originName, tag }: { originName: string; tag: string }) => `[${tag}] ${originName}`,
}));
vi.mock("@subboost/ui/lib/utils", () => ({ cn: (...parts: unknown[]) => parts.filter(Boolean).join(" ") }));

import { NodeManagementNodeList } from "../../../packages/ui/src/product/converter/advanced-mode/sections/node-management/node-list";

const plainNode = {
  name: "Plain",
  type: "ss",
  server: "plain.test",
  port: 443,
  cipher: "aes-128-gcm",
  password: "secret",
} as ParsedNode;

function collectElements(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<Record<string, any>>) => boolean,
  out: Array<React.ReactElement<Record<string, any>>> = [],
) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    const element = child as React.ReactElement<Record<string, any>>;
    if (predicate(element)) out.push(element);
    collectElements((element.props as { children?: React.ReactNode }).children, predicate, out);
  });
  return out;
}

function collectInputs(node: React.ReactNode) {
  return collectElements(node, (element) => {
    const props = element.props as Record<string, unknown>;
    return typeof element.type !== "string" && "value" in props && typeof props.onChange === "function";
  });
}

function collectText(node: React.ReactNode, out: string[] = []) {
  React.Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      out.push(String(child));
      return;
    }
    if (React.isValidElement(child)) {
      collectText((child.props as { children?: React.ReactNode }).children, out);
    }
  });
  return out.join("");
}

function callSetter<T>(initial: T) {
  return vi.fn((next: React.SetStateAction<T>) => (typeof next === "function" ? (next as (prev: T) => T)(initial) : next));
}

function makeProps(overrides: Partial<React.ComponentProps<typeof NodeManagementNodeList>> = {}) {
  return {
    nodes: [plainNode],
    deletedMarkedNodes: [],
    visibleNodes: [plainNode],
    visibleDeletedMarkedNodes: [],
    nodeSearchKeyword: "",
    resolveNodeNameParts: vi.fn(() => ({ baseName: "Plain", tag: "", template: "{name}", canEditBase: true })),
    editingNodeName: null,
    setEditingNodeName: vi.fn(),
    editNodeValue: "Plain",
    setEditNodeValue: vi.fn(),
    renameNode: vi.fn(),
    restoreNodeName: vi.fn(),
    listenerPortDrafts: {},
    setListenerPortDrafts: callSetter<Record<string, string>>({}),
    listenerPorts: {},
    listenerPortErrors: {},
    setListenerPortErrors: callSetter<Record<string, string>>({}),
    commitListenerPort: vi.fn(),
    orderDrafts: {},
    setOrderDrafts: callSetter<Record<string, string>>({}),
    nodeIndexByName: new Map([[plainNode.name, 0]]),
    setNodeOrder: vi.fn(),
    moveNode: vi.fn(),
    isListenerPortVisible: true,
    removeNode: vi.fn(),
    restoreDeletedNode: vi.fn(),
    ...overrides,
  };
}

describe("public NodeManagementNodeList extra branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("covers empty rename guard and plain-name rename without a tag", () => {
    const emptyProps = makeProps({ editingNodeName: plainNode.name, editNodeValue: "   " });
    const emptyInput = collectInputs(NodeManagementNodeList(emptyProps)).find((element) => element.props.autoFocus);
    emptyInput!.props.onKeyDown({ key: "Enter" });
    expect(emptyProps.renameNode).not.toHaveBeenCalled();
    expect(emptyProps.setEditingNodeName).toHaveBeenCalledWith(null);

    const saveProps = makeProps({ editingNodeName: plainNode.name, editNodeValue: "Renamed" });
    const saveTree = NodeManagementNodeList(saveProps);
    const saveButton = collectElements(saveTree, (element) => element.props.label === "保存节点名称")[0];
    saveButton.props.onClick();
    expect(saveProps.renameNode).toHaveBeenCalledWith(plainNode.name, "Renamed");
    expect(saveProps.setEditingNodeName).toHaveBeenCalledWith(null);
  });

  it("covers listener and order cleanup when no draft or error exists", () => {
    const props = makeProps();
    const tree = NodeManagementNodeList(props);
    const inputs = collectInputs(tree);

    const listenerInput = inputs[0];
    expect(listenerInput.props.value).toBe("");
    listenerInput.props.onChange({ target: { value: "7890" } });
    listenerInput.props.onKeyDown({ key: "Escape" });
    expect((props.setListenerPortErrors as any).mock.results.at(-1)?.value).toEqual({});

    const orderInput = inputs[1];
    expect(orderInput.props.value).toBe("1");
    orderInput.props.onKeyDown({ key: "Enter" });
    orderInput.props.onBlur();
    expect(props.setNodeOrder).not.toHaveBeenCalled();

    expect(collectElements(tree, (element) => element.props.label === "上移节点")[0]?.props.disabled).toBe(true);
    expect(collectElements(tree, (element) => element.props.label === "下移节点")[0]?.props.disabled).toBe(true);
  });

  it("renders deleted-only rows without the top divider", () => {
    const tree = NodeManagementNodeList({
      ...makeProps({
        nodes: [plainNode],
        deletedMarkedNodes: [{ originName: "Deleted", name: "Deleted" }],
        visibleNodes: [],
        visibleDeletedMarkedNodes: [{ originName: "Deleted", name: "Deleted" }],
      }),
    });

    expect(collectText(tree)).toContain("已删除节点");
    expect(collectElements(tree, (element) => String(element.props.className).includes("pt-0 mt-0 border-t-0"))).toHaveLength(1);
  });
});
