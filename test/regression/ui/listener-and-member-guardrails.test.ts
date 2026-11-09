import { describe, expect, it } from "vitest";
import {
  collectUsedListenerPorts,
  findGroupListenerBinding,
  resolveEffectiveMixedPort,
  validateGroupListenerPort,
} from "../../../packages/ui/src/product/converter/advanced-mode/sections/group-listener-settings";
import {
  findCycleCreatingProxyGroupKeys,
  mergeVisibleMemberOrder,
  type ResolvedMember,
} from "../../../packages/ui/src/product/converter/advanced-mode/sections/proxy-group-member-bulk";

const target = { kind: "custom" as const, id: "target" };

function member(
  kind: "module" | "custom" | "node",
  idOrName: string,
): ResolvedMember {
  const ref = kind === "node"
    ? { kind, name: idOrName }
    : { kind, id: idOrName };
  return {
    key: kind === "node" ? `node:${idOrName}` : `${kind}:${idOrName}`,
    kind,
    name: idOrName,
    ref,
  } as ResolvedMember;
}

describe("group listener guardrails", () => {
  it("distinguishes explicit invalid, absent, and non-record YAML ports", () => {
    expect(resolveEffectiveMixedPort("mixed-port: invalid", 7890)).toBeUndefined();
    expect(resolveEffectiveMixedPort("{}", 7890)).toBeUndefined();
    expect(resolveEffectiveMixedPort("[]", 7890)).toBe(7890);
    expect(resolveEffectiveMixedPort("not-a-record", 0)).toBeUndefined();
  });

  it("ignores malformed, disabled, excluded, invalid, and duplicate listeners", () => {
    const used = collectUsedListenerPorts({
      dnsYaml: "listeners:\n  - null\n  - port: 9000\n  - port: invalid",
      mixedPort: 0,
      listenerPorts: { Node: 9000, Invalid: 70000 },
      groupListeners: [
        null,
        { id: "missing-target", target: null, port: 9001 },
        { id: "disabled", target: { kind: "module", id: "disabled" }, port: 9002, enabled: false },
        { id: "excluded", target, port: 9003, enabled: true },
        { id: "active", target: { kind: "module", id: "active" }, port: 9004, enabled: true },
      ],
    } as any, target);

    expect(Array.from(used.entries())).toEqual([
      [9000, "节点监听端口"],
      [9004, "其他策略组的监听端口"],
    ]);
  });

  it("finds only a complete matching binding and can skip conflict checks", () => {
    const bindings = [
      null,
      { id: "bad", target: null, port: 9000 },
      { id: "match", target, port: 9001 },
    ] as any;
    expect(findGroupListenerBinding(bindings, target)?.id).toBe("match");

    const state = {
      dnsYaml: "",
      mixedPort: 7890,
      listenerPorts: {},
      groupListeners: [],
    };
    expect(validateGroupListenerPort("7890", state, target)).toEqual({
      port: null,
      error: "端口 7890 与全局 mixed-port冲突。",
    });
    expect(validateGroupListenerPort("7890", state, target, { checkConflict: false })).toEqual({
      port: 7890,
      error: null,
    });
  });
});

describe("proxy-group member ordering and cycle guardrails", () => {
  it("deduplicates visible replacements and tolerates missing replacement slots", () => {
    const direct = { kind: "direct" as const };
    const first = member("node", "First").ref;
    const second = member("node", "Second").ref;
    const merged = mergeVisibleMemberOrder(
      [direct, first, second, first],
      [first, first],
      new Set(["direct:DIRECT"]),
    );
    expect(merged).toEqual([direct, first]);
  });

  it("does not append the same preserved member twice", () => {
    const direct = { kind: "direct" as const };
    expect(mergeVisibleMemberOrder(
      [direct, direct],
      [],
      new Set(["direct:DIRECT"]),
    )).toEqual([direct]);
  });

  it("handles missing proxy lists, missing dependency records, and dependency cycles", () => {
    const candidates = [
      member("module", "A"),
      member("module", "Orphan"),
      member("custom", "NoProxies"),
    ];
    const cycleKeys = findCycleCreatingProxyGroupKeys({
      candidates,
      targetName: "Target",
      generatedGroups: [
        { name: "A", proxies: ["B"] },
        { name: "B", proxies: ["A", "Target"] },
        { name: "Target", proxies: [] },
        { name: "NoProxies" },
      ],
    });
    expect(cycleKeys).toEqual(new Set(["module:A"]));
  });
});
