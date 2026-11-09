import { describe, expect, it } from "vitest";
import { generateClashConfig } from "../../../packages/core/src/generator";
import {
  GroupListenerError,
  resolveGroupListenerEntries,
} from "../../../packages/core/src/generator/group-listeners";
import {
  getEffectiveModuleRuleItems,
  getEffectiveModuleRules,
  isModuleRuleMovedFrom,
  normalizeHiddenPresetRuleIds,
} from "../../../packages/core/src/generator/module-rules";
import { PROXY_GROUP_MODULES } from "../../../packages/core/src/generator/proxy-group-modules";
import {
  chooseFallbackPolicyTarget,
  createPolicyTargetResolver,
  uniquePolicyTargets,
} from "../../../packages/core/src/generator/policy-targets";
import { generateProxyGroups } from "../../../packages/core/src/generator/proxy-groups";
import { buildTypedProxyGroup } from "../../../packages/core/src/generator/proxy-group-type";
import {
  hasFullRuleOrderKeys,
  normalizePersistedRuleOrder,
  resolveAppliedRuleOrder,
} from "../../../packages/core/src/generator/rules";
import { collectDnsPolicyEntries, configToYaml } from "../../../packages/core/src/generator/yaml";
import {
  normalizeProxyGroupAdvancedConfig,
  resolveProxyGroupMembers,
} from "../../../packages/core/src/proxy-group-advanced";
import {
  normalizeGroupNameWithDefaultEmoji,
  resolveProxyGroupModuleName,
  splitLeadingEmoji,
} from "../../../packages/core/src/proxy-group-name";
import { resolveProxyGroupTargetName } from "../../../packages/core/src/proxy-group-targets";
import type {
  CustomProxyGroup,
  GroupListenerBinding,
} from "../../../packages/core/src/types/config";
import type { ParsedNode } from "../../../packages/core/src/types/node";

function ssNode(name: string, patch: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "ss",
    server: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "node"}.example.com`,
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
    ...patch,
  } as unknown as ParsedNode;
}

function binding(patch: Partial<GroupListenerBinding> = {}): GroupListenerBinding {
  return {
    id: "listener",
    target: { kind: "module", id: "auto" },
    port: 7891,
    ...patch,
  };
}

describe("core generator edge regressions", () => {
  it("validates malformed listener collections before emitting a listener", () => {
    const resolveTarget = () => ({ exists: true, active: true, name: "Target" });

    expect(
      resolveGroupListenerEntries({
        bindings: null as never,
        resolveTarget,
        nodeListenerPorts: [],
        baseListenerPorts: [],
        usedNames: new Set(),
      }),
    ).toEqual([]);

    expect(() =>
      resolveGroupListenerEntries({
        bindings: [null as never, binding()],
        resolveTarget: () => ({ exists: true, active: true }),
        effectiveMixedPort: 0,
        nodeListenerPorts: [0, 7100, 7100],
        baseListenerPorts: [Number.NaN, 7200, 7200],
        usedNames: new Set(),
      }),
    ).toThrow(/名称为空/);

    expect(() =>
      resolveGroupListenerEntries({
        bindings: [binding({ port: 1.5 })],
        resolveTarget,
        nodeListenerPorts: [],
        baseListenerPorts: [],
        usedNames: new Set(),
      }),
    ).toThrow(/端口无效/);
  });

  it("rejects every stale listener target kind through the public generator", () => {
    const base = {
      nodes: [ssNode("Node")],
      userConfig: { dnsYaml: "", enabledGroups: ["select", "auto", "final"] },
    };
    const staleTargets: unknown[] = [
      null,
      { kind: "module", id: "missing" },
      { kind: "custom", id: "missing" },
      { kind: "dialer", id: "missing" },
      { kind: "future", id: "missing" },
    ];

    for (const target of staleTargets) {
      expect(() =>
        generateClashConfig({
          ...base,
          groupListeners: [binding({ target: target as never })],
        }),
      ).toThrow(GroupListenerError);
    }
  });

  it("keeps name collision resolution and sparse base listeners deterministic", () => {
    const config = generateClashConfig({
      nodes: [ssNode("Dup"), ssNode("Dup (2)"), ssNode("Dup")],
      userConfig: {
        dnsYaml: [
          "listeners:",
          "  - null",
          "  - 7",
          "  - name: 42",
          "    type: mixed",
          "    port: text",
        ].join("\n"),
        enabledGroups: ["select", "auto", "final"],
      },
      groupListeners: [binding({ port: 7892 })],
    });

    expect(config.proxies?.map((node) => node.name)).toEqual(["Dup", "Dup (2)", "Dup (3)"]);
    expect(config.listeners).toEqual([
      null,
      7,
      { name: 42, type: "mixed", port: "text" },
      expect.objectContaining({ name: "group-mixed-0", port: 7892 }),
    ]);
  });

  it("handles blank custom and dialer metadata without leaking invalid groups", () => {
    const config = generateClashConfig({
      nodes: [ssNode("Node")],
      customProxyGroups: [
        { id: "blank", name: 9, emoji: "", groupType: "select" } as never,
      ],
      dialerProxyGroups: [
        {
          id: "blank-dialer",
          name: " ",
          type: "select",
          relayNodes: ["Node"],
          targetNodes: [],
        } as never,
      ],
      proxyGroupOrder: ["missing", "missing"],
      userConfig: { dnsYaml: "", enabledGroups: ["select", "auto", "final"] },
    });

    expect(config.proxies).toHaveLength(1);
    expect(config["proxy-groups"]?.length).toBeGreaterThan(0);
  });

  it("normalizes module rules with sparse hidden and moved rule data", () => {
    const cn = PROXY_GROUP_MODULES.find((module) => module.id === "cn")!;
    const firstRule = cn.rules[0];

    expect(normalizeHiddenPresetRuleIds({ cn: ["", firstRule.id, firstRule.id], empty: [] })).toEqual({
      cn: [firstRule.id],
    });
    expect(
      isModuleRuleMovedFrom(cn.id, firstRule.id, {
        "": [null as never],
        missing: [{ id: firstRule.id }],
        global: [{ id: firstRule.id }],
      }),
    ).toBe(true);
    expect(
      getEffectiveModuleRuleItems(cn, {
        cn: [null as never, { ...firstRule, id: "extra" }],
      }, {
        cn: [firstRule.id],
      }).some((item) => item.id === "extra"),
    ).toBe(true);
    expect(
      getEffectiveModuleRules(cn, {
        ruleSetsByTarget: { cn: null as never },
      }),
    ).toEqual(cn.rules);
  });

  it("keeps policy target and group display fallbacks explicit", () => {
    expect(uniquePolicyTargets(["", " DIRECT ", 1, "DIRECT", "Proxy"])).toEqual(["DIRECT", "Proxy"]);
    expect(chooseFallbackPolicyTarget([null, " Missing ", "DIRECT"], ["DIRECT"])).toBe("DIRECT");
    expect(chooseFallbackPolicyTarget([], [])).toBe("DIRECT");
    const resolve = createPolicyTargetResolver({ availablePolicyTargets: ["DIRECT"], fallbackPolicyTarget: "" });
    expect(resolve("missing")).toBe("DIRECT");

    expect(splitLeadingEmoji("Label")).toEqual({ emoji: "", label: "Label", hasEmojiPrefix: false });
    expect(splitLeadingEmoji(12 as never)).toEqual({ emoji: "", label: "", hasEmojiPrefix: false });
    expect(normalizeGroupNameWithDefaultEmoji("", "F")).toEqual({ full: "", emoji: "F" });
    expect(normalizeGroupNameWithDefaultEmoji("🔥 Ready", "F")).toEqual({ full: "🔥 Ready", emoji: "🔥" });
    expect(resolveProxyGroupModuleName({ name: "X", emoji: "E" }, 1 as never)).toBe("X");
  });

  it("resolves malformed policy references through documented fallbacks", () => {
    const customProxyGroups = [
      { id: "custom", name: " Custom ", emoji: "", groupType: "select" },
    ] as CustomProxyGroup[];
    const options = {
      moduleNames: { auto: "Auto" },
      customProxyGroups,
      fallbackTarget: "DIRECT",
    };

    expect(resolveProxyGroupTargetName(" ", options)).toBe("DIRECT");
    expect(resolveProxyGroupTargetName({ kind: "module", id: "missing" }, options)).toBe("DIRECT");
    expect(resolveProxyGroupTargetName({ kind: "custom", id: "custom" }, options)).toBe("Custom");
    expect(resolveProxyGroupTargetName({ kind: "custom", id: "missing" }, options)).toBe("DIRECT");
  });

  it("covers sparse advanced members and load-balance defaults", () => {
    expect(normalizeProxyGroupAdvancedConfig({ sourceIds: [null, " source "] })).toMatchObject({
      sourceIds: ["source"],
    });
    expect(
      resolveProxyGroupMembers({
        defaultProxyNames: [null, "", "Node"] as never,
        nodes: [ssNode("Node")],
        advanced: {},
      }).proxyNames,
    ).toContain("Node");

    expect(
      buildTypedProxyGroup({
        name: "LB",
        groupType: "load-balance",
        proxies: ["Node"],
        url: "https://example.com/generate_204",
        interval: 300,
      }),
    ).toMatchObject({ type: "load-balance", strategy: "consistent-hashing" });
  });

  it("serializes empty values and comparator ties without dropping valid DNS policy", () => {
    const yaml = configToYaml({
      proxies: [{ name: "Node", type: "ss", server: "n.example.com", port: 8388, cipher: "x", password: "p", aa: 1, bb: 2 }],
      "proxy-groups": [{ name: "G", type: "select", proxies: ["Node"], aa: 1, bb: 2 }],
      "rule-providers": {},
      rules: [],
      listeners: undefined,
    } as never);
    expect(yaml).toContain("aa: 1");
    expect(collectDnsPolicyEntries({ "+.same.example": ["", "1.1.1.1"] })).toEqual([
      ["+.same.example", ["1.1.1.1"]],
    ]);

    expect(
      generateProxyGroups({
        nodes: [ssNode("Node")],
        enabledModules: ["select", "unknown", "final"],
        ruleProviderBaseUrl: "https://rules.example",
        testUrl: "https://example.com/generate_204",
        testInterval: 300,
        customProxyGroups: [{ id: "late", name: "Late", emoji: "", groupType: "select" }],
      }).some((group) => group.name === "Late"),
    ).toBe(true);
  });

  it("preserves unusual persisted rule orders without inventing keys", () => {
    const options = {
      enabledModules: ["cn", "final"],
      customRules: [
        { id: "one", type: "DOMAIN" as const, value: "one.example", target: "DIRECT" },
        { id: "two", type: "DOMAIN" as const, value: "two.example", target: "DIRECT" },
      ],
      ruleOrder: ["custom-rule:one"],
    };
    expect(normalizePersistedRuleOrder(options)).toEqual(["custom-rule:one", "custom-rule:two"]);
    expect(resolveAppliedRuleOrder(options)).toEqual(expect.arrayContaining(["custom-rule:one", "custom-rule:two"]));
    expect(hasFullRuleOrderKeys(["module:cn:", "special:match"])).toBe(true);
  });
});
