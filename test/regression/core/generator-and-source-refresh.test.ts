import { describe, expect, it } from "vitest";
import {
  configToYaml,
  generateClashConfig,
  generateProxyGroups,
  generateRules,
  generateRuleProviders,
} from "@subboost/core/generator";
import {
  normalizePersistedRuleOrder,
  resolveAppliedRuleOrder,
} from "@subboost/core/generator/rules";
import { collectDnsPolicyEntries } from "@subboost/core/generator/yaml";
import {
  detachSourceNodesFromState,
  mergeParsedSourceNodes,
  prepareSourceParsedNodes,
} from "@subboost/core/subscription/source-node-refresh";
import { ORIGIN_NAME_KEY, SOURCE_IDS_KEY } from "@subboost/core/subscription/node-source-state";
import type { ParsedNode } from "@subboost/core/types/node";

const UUID = "11111111-1111-4111-8111-111111111111";

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

function trojanNode(name: string, patch: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "trojan",
    server: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "trojan"}.example.com`,
    port: 443,
    password: "secret",
    ...patch,
  } as unknown as ParsedNode;
}

describe("public core generator extra branch coverage", () => {
  it("generates advanced and custom proxy group variants with real policy targets", () => {
    const groups = generateProxyGroups({
      nodes: [ssNode("Alpha"), ssNode("剩余流量：100 GB")],
      proxyProviderNames: ["remote-provider"],
      enabledModules: ["select", "auto", "ad", "private", "cn", "final"],
      ruleProviderBaseUrl: "https://rules.example/base",
      testUrl: "https://latency.example/generate_204",
      testInterval: 321,
      customProxyGroups: [
        { id: "url", name: "URL Filter", emoji: "", groupType: "url-test", advanced: {} },
        { id: "fallback", name: "Fallback Filter", emoji: "", groupType: "fallback", advanced: {} },
        { id: "lb", name: "LB Filter", emoji: "", groupType: "load-balance", advanced: {} },
        { id: "direct", name: "Direct Filter", emoji: "", groupType: "direct-first", advanced: {} },
        { id: "reject", name: "Reject Filter", emoji: "", groupType: "reject-first", advanced: {} },
        { id: "custom-url", name: "Custom URL", emoji: "", groupType: "url-test" },
        { id: "custom-fallback", name: "Custom Fallback", emoji: "", groupType: "fallback" },
        { id: "custom-lb", name: "Custom LB", emoji: "", groupType: "load-balance" },
        { id: "custom-direct", name: "Custom Direct", emoji: "", groupType: "direct-first" },
        { id: "custom-reject", name: "Custom Reject", emoji: "", groupType: "reject-first" },
        { id: "custom-select", name: "Custom Select", emoji: "", groupType: "select" },
      ],
    });

    expect(groups.find((group) => group.name === "URL Filter")).toMatchObject({
      type: "url-test",
      lazy: false,
    });
    expect(groups.find((group) => group.name === "Custom URL")).toMatchObject({
      type: "url-test",
      use: ["remote-provider"],
    });
    expect(groups.find((group) => group.name === "LB Filter")).toMatchObject({
      type: "load-balance",
      strategy: "consistent-hashing",
    });
    expect(groups.find((group) => group.name === "Direct Filter")?.proxies?.slice(0, 2)).toEqual([
      "DIRECT",
      "REJECT",
    ]);
    expect(groups.find((group) => group.name === "Reject Filter")?.proxies?.slice(0, 2)).toEqual([
      "REJECT",
      "DIRECT",
    ]);
    expect(groups.find((group) => group.name === "Custom LB")).toMatchObject({
      type: "load-balance",
      strategy: "consistent-hashing",
    });
    expect(groups.find((group) => group.name === "Custom Direct")?.proxies?.[0]).toBe("DIRECT");
    expect(groups.find((group) => group.name === "Custom Reject")?.proxies?.[0]).toBe("REJECT");
    expect(groups.find((group) => group.name === "Custom Select")?.proxies).toEqual(
      expect.arrayContaining(["Alpha", "DIRECT", "REJECT"]),
    );
  });

  it("keeps preset rule providers ahead of duplicate custom provider ids", () => {
    const providers = generateRuleProviders({
      nodes: [ssNode("Alpha")],
      enabledModules: ["cn"],
      ruleProviderBaseUrl: "https://rules.example/base",
      testUrl: "https://latency.example/generate_204",
      testInterval: 300,
      experimentalCnUseCnRuleSet: true,
      customProxyGroups: [
        {
          id: "custom",
          name: "Custom",
          emoji: "",
          groupType: "select",
        },
      ],
      customRuleSets: [
        { id: "cn", name: "Should Not Override", behavior: "domain", path: "https://custom.example/cn.mrs", target: "Custom" },
        { id: "custom-only", name: "Custom Only", behavior: "ipcidr", path: "https://custom.example/ip.mrs", target: "Custom" },
      ],
    });

    expect(providers.cn).toMatchObject({
      url: "https://rules.example/base/geosite/cn.mrs",
      path: "./ruleset/cn.mrs",
    });
    expect(providers["custom-only"]).toMatchObject({
      behavior: "ipcidr",
      url: "https://custom.example/ip.mrs",
    });
  });

  it("serializes YAML with sorted rest keys, listener variants, and DNS policy cleanup", () => {
    expect(collectDnsPolicyEntries(undefined)).toEqual([]);
    expect(
      collectDnsPolicyEntries({
        "": "1.1.1.1",
        "+.b.example": ["", "8.8.8.8"],
        "+.a.example": " 1.1.1.1 ",
        "+.empty.example": [],
        "+.bad.example": 123,
      }),
    ).toEqual([
      ["+.a.example", "1.1.1.1"],
      ["+.b.example", ["8.8.8.8"]],
    ]);

    const yaml = configToYaml({
      "z-top": { beta: 2, alpha: "yes", empty: {} },
      "a-top": "off",
      listeners: [],
      proxies: [
        {
          name: "Yaml Node",
          type: "ss",
          server: "yaml.example.com",
          port: 8388,
          cipher: "aes-128-gcm",
          password: "secret",
          zeta: "last",
          alpha: "first",
          beta: undefined,
          "dialer-proxy": "DIRECT",
          _internal: "hidden",
        },
      ],
      "proxy-groups": [
        { zzz: "z", aaa: "a", name: "Group", type: "select", proxies: ["Yaml Node"] },
      ],
      "rule-providers": {
        beta: { type: "http", behavior: "domain", url: "https://rules.example/b.mrs" },
      },
      rules: ["MATCH,DIRECT"],
    } as never);

    expect(yaml).toContain("listeners: []");
    expect(yaml).toContain('name: "Yaml Node"');
    expect(yaml.indexOf("alpha: first")).toBeLessThan(yaml.indexOf("zeta: last"));
    expect(yaml).toContain("udp: true");
    expect(yaml).not.toContain("_internal");
    expect(yaml).not.toContain("beta: undefined");

    const scalarListenerYaml = configToYaml({
      listeners: "mixed",
      proxies: [],
      "proxy-groups": [],
      "rule-providers": {},
      rules: [],
    } as never);
    expect(scalarListenerYaml).toContain("listeners: mixed");
  });

  it("merges explicit base YAML listeners, proxy providers, and TLS fingerprints", () => {
    const config = generateClashConfig({
      nodes: [
        trojanNode("Trojan"),
        {
          name: "AnyTLS",
          type: "anytls",
          server: "anytls.example.com",
          port: 443,
          password: "secret",
        } as unknown as ParsedNode,
        {
          name: "Reality",
          type: "vless",
          server: "reality.example.com",
          port: 443,
          uuid: UUID,
          tls: true,
          "reality-opts": { "public-key": "A".repeat(43) },
        } as ParsedNode,
      ],
      proxyProviders: {
        remote: { type: "http", url: "https://provider.example.com/sub.yaml" },
      },
      userConfig: {
        dnsYaml: [
          "global-client-fingerprint: chrome",
          "listeners:",
          "  - {name: base, type: mixed, port: 1090}",
          "proxy-providers:",
          "  local:",
          "    type: file",
          "    path: ./local.yaml",
        ].join("\n"),
        listenerPorts: {
          Trojan: 12000,
          AnyTLS: 12001,
          Reality: 12002,
        },
      },
      dialerProxyGroups: [
        {
          id: "relay",
          name: "Relay",
          type: "select",
          enabled: true,
          relayNodes: ["Trojan"],
          targetNodes: ["Reality"],
        },
      ],
    });

    expect(config.listeners).toHaveLength(4);
    expect(config["proxy-providers"]).toMatchObject({
      local: { type: "file", path: "./local.yaml" },
      remote: { type: "http", url: "https://provider.example.com/sub.yaml" },
    });
    expect(config["global-client-fingerprint"]).toBe("chrome");
    expect(config.proxies?.find((node) => node.name === "Trojan")).toMatchObject({
      "client-fingerprint": "chrome",
    });
    expect(config.proxies?.find((node) => node.name === "AnyTLS")).toMatchObject({
      "client-fingerprint": "chrome",
    });
    expect(config.proxies?.find((node) => node.name === "Reality")).toMatchObject({
      "client-fingerprint": "chrome",
    });
  });

  it("validates base YAML and normalizes generated node names without hiding config mistakes", () => {
    expect(() =>
      generateClashConfig({
        nodes: [],
        userConfig: { dnsYaml: "mode: rule: broken" },
      }),
    ).toThrow("基础和 DNS 配置 YAML 解析失败");
    expect(() =>
      generateClashConfig({
        nodes: [],
        userConfig: { dnsYaml: "- just\n- a-list" },
      }),
    ).toThrow("基础和 DNS 配置必须是 YAML 对象");
    expect(() =>
      generateClashConfig({
        nodes: [],
        userConfig: { dnsYaml: "proxies: []" },
      }),
    ).toThrow("基础和 DNS 配置不能包含 proxies");
    expect(() =>
      generateClashConfig({
        nodes: [],
        userConfig: {
          dnsYaml: ["nameserver-policy:", "  +.example.com: 1.1.1.1", "dns: true"].join("\n"),
        },
      }),
    ).toThrow("基础和 DNS 配置中的 dns 必须是对象");
    expect(() =>
      generateClashConfig({
        nodes: [ssNode("Listener")],
        userConfig: {
          dnsYaml: "listeners: mixed",
          listenerPorts: { Listener: 12000 },
        },
      }),
    ).toThrow("基础和 DNS 配置中的 listeners 必须是数组");
    expect(() =>
      generateClashConfig({
        nodes: [],
        proxyProviders: { remote: { type: "http", url: "https://provider.example.com/sub.yaml" } },
        userConfig: { dnsYaml: "proxy-providers: file" },
      }),
    ).toThrow("基础和 DNS 配置中的 proxy-providers 必须是对象");

    const config = generateClashConfig({
      nodes: [
        ssNode(" Dup "),
        ssNode("Dup"),
        { ...ssNode("Numeric"), name: 123 } as unknown as ParsedNode,
      ],
      userConfig: {
        dnsYaml: [
          "nameserver-policy:",
          "  +.b.example: 8.8.8.8",
          "dns:",
          "  enable: true",
        ].join("\n"),
      },
    });

    expect(config.dns).toMatchObject({
      enable: true,
      "nameserver-policy": { "+.b.example": "8.8.8.8" },
    });
    expect(config.proxies?.map((node) => node.name)).toEqual(["Dup", "Dup (2)", "123"]);
  });

  it("reports YAML parser locations and tolerates sparse generated group metadata", () => {
    expect(() =>
      generateClashConfig({
        nodes: [],
        userConfig: { dnsYaml: "dns:\n  enable: [" },
      }),
    ).toThrow(/第 \d+ 行，第 \d+ 列/);

    const config = generateClashConfig({
      nodes: [
        { ...trojanNode("Trojan Fingerprint"), "client-fingerprint": "" } as ParsedNode,
        { ...ssNode("   "), name: null } as unknown as ParsedNode,
      ],
      userConfig: {
        dnsYaml: "global-client-fingerprint: chrome",
      },
      customProxyGroups: [
        { id: "bad-name", name: 123, emoji: "", groupType: "select", rules: [] } as never,
      ],
    });

    expect(config["global-client-fingerprint"]).toBe("chrome");
    expect(config.proxies?.find((node) => node.name === "Trojan Fingerprint")).toMatchObject({
      "client-fingerprint": "chrome",
    });
    expect(config.proxies?.some((node) => node.name === "未命名节点")).toBe(true);
  });

  it("orders generated rules while repairing stale custom rule order keys", () => {
    const customRules: NonNullable<Parameters<typeof normalizePersistedRuleOrder>[0]["customRules"]> = [
      { id: "rule-a", type: "DOMAIN-SUFFIX", value: "a.example", target: "Custom Target" },
      { id: "rule-b", type: "IP-CIDR", value: "10.0.0.0/8", target: "Missing Target", noResolve: true },
    ];
    const customRuleSets: NonNullable<Parameters<typeof normalizePersistedRuleOrder>[0]["customRuleSets"]> = [
      {
        id: "group-rule",
        name: "Group Rule",
        behavior: "domain",
        path: "https://rules.example/group.mrs",
        target: "Custom Target",
      },
    ];

    expect(generateRules({ enabledModules: [], customRules: [] })).toEqual(["MATCH,🚀 节点选择"]);
    expect(
      normalizePersistedRuleOrder({
        enabledModules: ["cn", "final"],
        customRules,
        customRuleSets,
        ruleOrder: [123 as unknown as string, " ", "custom-rule:rule-b", "custom-rule:rule-b", "custom-rule:rule-a"],
        availablePolicyTargets: ["Custom Target", "DIRECT"],
        fallbackPolicyTarget: "DIRECT",
      }),
    ).toEqual(["custom-rule:rule-b", "custom-rule:rule-a", "custom-rule-set:group-rule"]);

    const applied = resolveAppliedRuleOrder({
      enabledModules: ["cn", "final"],
      customRules,
      customRuleSets,
      ruleOrder: ["module:cn:geosite-cn", "special:match", "custom-rule:rule-b"],
      availablePolicyTargets: ["Custom Target", "DIRECT"],
      fallbackPolicyTarget: "DIRECT",
    });

    expect(applied).toContain("custom-rule:rule-a");
    expect(applied).toContain("custom-rule-set:group-rule");
    expect(
      generateRules({
        enabledModules: ["cn", "final"],
        customRules,
        customRuleSets,
        ruleOrder: applied,
        availablePolicyTargets: ["Custom Target", "DIRECT"],
        fallbackPolicyTarget: "DIRECT",
      }),
    ).toEqual(expect.arrayContaining(["IP-CIDR,10.0.0.0/8,DIRECT,no-resolve", "MATCH,DIRECT"]));
  });
});

describe("public source refresh extra branch coverage", () => {
  it("preserves user names, skips deleted fresh nodes, and records refresh rename maps", () => {
    const prepared = prepareSourceParsedNodes(
      [
        ssNode("Auto Origin", { server: "auto-refresh.example.com" }),
        ssNode("Display Match", { server: "display-refresh.example.com" }),
        ssNode("Shared Origin", { server: "shared-refresh.example.com" }),
        ssNode("Deleted Origin", { server: "deleted-refresh.example.com" }),
        ssNode("", { server: "blank-origin.example.com" }),
      ],
      { currentTag: "new", currentNameTemplate: "[{tag}] {name}" },
    );

    const result = mergeParsedSourceNodes(
      [
        ssNode("[new] Auto Origin"),
        ssNode("[old] Auto Origin", {
          server: "old-auto.example.com",
          [ORIGIN_NAME_KEY]: "Auto Origin",
          [SOURCE_IDS_KEY]: ["src", "other", "src", " "],
          _favorite: true,
        }),
        ssNode("Display Match", { server: "display-refresh.example.com" }),
        ssNode("Shared Custom", {
          server: "shared-refresh.example.com",
          [ORIGIN_NAME_KEY]: "Shared Origin",
          [SOURCE_IDS_KEY]: ["other"],
        }),
        ssNode("Removed Keep", {
          server: "removed.example.com",
          [ORIGIN_NAME_KEY]: "Removed Origin",
          [SOURCE_IDS_KEY]: ["src", "other"],
        }),
      ],
      prepared,
      ["", "  ", "[new] Deleted Origin"],
      {
        sourceId: "src",
        currentTag: "new",
        currentNameTemplate: "[{tag}] {name}",
        lastTag: "old",
        lastNameTemplate: "[{tag}] {name}",
        smartNodeMatchingEnabled: true,
      },
    );

    expect(result.renameMap.get("[old] Auto Origin")).toBe("[new] Auto Origin (2)");
    expect(result.nodes.map((node) => node.name)).toEqual(
      expect.arrayContaining(["[new] Auto Origin", "[new] Auto Origin (2)", "Display Match", "Shared Custom"]),
    );
    expect(result.nodes.some((node) => (node as unknown as Record<string, unknown>)[ORIGIN_NAME_KEY] === "Deleted Origin")).toBe(false);

    const refreshedAuto = result.nodes.find(
      (node) => (node as unknown as Record<string, unknown>)[ORIGIN_NAME_KEY] === "Auto Origin",
    ) as unknown as Record<string, unknown>;
    expect(refreshedAuto._favorite).toBe(true);
    expect(refreshedAuto[SOURCE_IDS_KEY]).toEqual(["other", "src"]);

    const shared = result.nodes.find((node) => node.name === "Shared Custom") as unknown as Record<string, unknown>;
    expect(shared[SOURCE_IDS_KEY]).toEqual(["other", "src"]);

    const detached = detachSourceNodesFromState(result.nodes, "src");
    expect(detached.nodes.some((node) => ((node as unknown as Record<string, unknown>)[SOURCE_IDS_KEY] as string[] | undefined)?.includes("src"))).toBe(false);
  });

  it("treats refresh as new when smart matching is disabled", () => {
    const result = mergeParsedSourceNodes(
      [
        ssNode("Manual Old", {
          [ORIGIN_NAME_KEY]: "Origin",
          [SOURCE_IDS_KEY]: ["src"],
        }),
        ssNode("Exact Other Source", {
          server: "exact.example.com",
          [ORIGIN_NAME_KEY]: "Exact Origin",
          [SOURCE_IDS_KEY]: ["other"],
        }),
      ],
      [
        ssNode("Origin", { server: "origin-new.example.com", [ORIGIN_NAME_KEY]: "Origin" }),
        ssNode("Exact Origin", { server: "exact.example.com", [ORIGIN_NAME_KEY]: "Exact Origin" }),
      ],
      [],
      {
        sourceId: "src",
        treatAsNewSource: true,
        smartNodeMatchingEnabled: false,
      },
    );

    expect(result.nodes.map((node) => node.name)).toEqual(
      expect.arrayContaining(["Origin", "Exact Other Source", "Exact Origin"]),
    );
    expect(result.renameMap.get("Manual Old")).toBe("Origin");
  });

  it("does not display-name match across different proxy types and ignores blank source ids", () => {
    const result = mergeParsedSourceNodes(
      [
        { ...trojanNode("Origin"), [SOURCE_IDS_KEY]: [] } as unknown as ParsedNode,
        { ...ssNode("Blank Source"), [ORIGIN_NAME_KEY]: "Blank Source", [SOURCE_IDS_KEY]: [" ", "other"] } as unknown as ParsedNode,
        { ...ssNode(""), [ORIGIN_NAME_KEY]: "", [SOURCE_IDS_KEY]: ["src"] } as unknown as ParsedNode,
      ],
      [
        ssNode("Origin", { server: "fresh-origin.example.com" }),
        ssNode("Display Deleted", { server: "deleted-display.example.com" }),
        ssNode("Blank Source", { server: "blank-source.example.com" }),
      ],
      ["Display Deleted"],
      {
        sourceId: "src",
        lastTag: "old",
        lastNameTemplate: "[{tag}] {name}",
        smartNodeMatchingEnabled: true,
      },
    );

    expect(result.nodes.map((node) => `${node.type}:${node.name}`)).toEqual(
      expect.arrayContaining(["ss:Origin", "ss:Blank Source"]),
    );
    const blankSource = result.nodes.find((node) => node.name === "Blank Source") as unknown as Record<string, unknown>;
    expect(blankSource[SOURCE_IDS_KEY]).toEqual(["other", "src"]);
    expect(result.nodes.some((node) => node.server === "deleted-display.example.com")).toBe(false);
  });
});
