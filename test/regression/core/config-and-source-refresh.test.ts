import { describe, expect, it } from "vitest";
import { buildGenerateOptionsFromConfig } from "../../../packages/core/src/subscription/config-utils";
import {
  mergeParsedSourceNodes,
  prepareSourceParsedNodes,
} from "../../../packages/core/src/subscription/source-node-refresh";
import { ORIGIN_NAME_KEY, SOURCE_IDS_KEY } from "../../../packages/core/src/subscription/node-source-state";
import {
  isMihomoSupportedProxyNode,
  normalizeMihomoVlessForGeneration,
  sanitizeMihomoProxyNode,
} from "../../../packages/core/src/mihomo/proxy-sanitizer";
import { parsePlatformProxyLine } from "../../../packages/core/src/parser/platform/parse-platform-proxy-line";
import type { ParsedNode } from "../../../packages/core/src/types/node";

const REALITY_PUBLIC_KEY = "B".repeat(43);
const WIREGUARD_KEY = `${"C".repeat(43)}=`;

function ssNode(name: string, patch: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "ss",
    server: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "node"}.example.com`,
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
    ...patch,
  } as ParsedNode;
}

describe("public core config and refresh branch coverage", () => {
  it("normalizes persisted config edge cases without accepting malformed entries", () => {
    const options = buildGenerateOptionsFromConfig(
      {
        template: "minimal",
        customProxyGroups: [
          {
            id: "ip-group",
            name: "IP Group",
            emoji: "I",
            groupType: "load-balance",
            strategy: "round-robin",
          },
          {
            id: "auto",
            name: "Auto",
            emoji: "",
            groupType: "url-test",
            advanced: {
              sourceIds: [" src-a ", 99],
              regions: ["TW", "", "unknown"],
              excludedMembers: [{ kind: "node", name: "Gone" }],
            },
          },
          { id: "skip-enabled", name: "Skip Enabled", emoji: "", groupType: "fallback" },
        ],
        customRuleSets: [
          {
            id: "geoip",
            name: "GeoIP",
            behavior: "ipcidr",
            path: "https://rules.example.com/geoip.mrs",
            target: "IP Group",
            noResolve: false,
          },
          { id: "bad", name: "Bad", behavior: "bad", path: "https://rules.example.com/bad.mrs", target: "IP Group" },
        ],
        dialerProxyGroups: [
          { id: "select-chain", name: "Select Chain", type: "select", relayNodes: [123, " Relay "], targetNodes: [] },
          { id: "disabled", name: "Disabled", type: "url-test", enabled: false },
        ],
        listenerPorts: { "": 1234, " Valid Listener ": 65535, bad: "7890" },
        proxyGroupNameOverrides: { "": "skip", " Auto ": " Auto Renamed ", invalid: 123 },
        mixedPort: 65535,
        allowLan: false,
        autoSelectStrategy: "url-test",
        cnIpNoResolve: true,
        experimentalCnUseCnRuleSet: false,
        ruleProviderBaseUrl: "https://rules.example.com/base/",
      },
      { nodes: [ssNode("Node", { _sourceIds: ["keep"], _originName: "Node" })] }
    );

    expect(options.template).toBe("minimal");
    expect(options.userConfig).toMatchObject({
      mixedPort: 65535,
      allowLan: false,
      autoSelectStrategy: "url-test",
      cnIpNoResolve: true,
      experimentalCnUseCnRuleSet: false,
      listenerPorts: { "Valid Listener": 65535 },
      ruleProviderBaseUrl: "https://rules.example.com/base/",
    });
    expect(options.proxyGroupNameOverrides).toEqual({ Auto: "Auto Renamed" });
    expect(options.customProxyGroups?.[0]).toMatchObject({
      groupType: "load-balance",
      strategy: "round-robin",
    });
    expect(options.customRuleSets?.[0]).toMatchObject({
      id: "geoip",
      behavior: "ipcidr",
      path: "https://rules.example.com/geoip.mrs",
      target: "IP Group",
    });
    expect(options.dialerProxyGroups).toEqual([
      { id: "select-chain", name: "Select Chain", type: "select", relayNodes: ["Relay"], targetNodes: [] },
      { id: "disabled", name: "Disabled", type: "url-test", relayNodes: [], targetNodes: [], enabled: false },
    ]);
    expect(options.customProxyGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ip-group",
          name: "IP Group",
          groupType: "load-balance",
          strategy: "round-robin",
        }),
        expect.objectContaining({
          id: "auto",
          name: "Auto",
          groupType: "url-test",
          advanced: {
            sourceIds: ["src-a"],
            regions: ["tw"],
            excludedMembers: [{ kind: "node", name: "Gone" }],
          },
        }),
        expect.objectContaining({
          id: "skip-enabled",
          name: "Skip Enabled",
          groupType: "fallback",
          advanced: {},
        }),
      ]),
    );
  });

  it("covers source refresh deletion, duplicate, and smart content matching edges", () => {
    const deletedByDisplay = prepareSourceParsedNodes([ssNode("Alpha")], {
      currentTag: "New",
      currentNameTemplate: "[{tag}]{name}",
    });
    expect(
      mergeParsedSourceNodes([], deletedByDisplay, ["[New]Alpha"], {
        sourceId: "source-a",
        currentTag: "New",
        currentNameTemplate: "[{tag}]{name}",
      }).nodes
    ).toEqual([]);

    const blankOrigin = prepareSourceParsedNodes([ssNode("   ")], {});
    const existing = [
      ssNode("Display Candidate", {
        [ORIGIN_NAME_KEY]: "",
        [SOURCE_IDS_KEY]: ["source-a"],
      }),
      ssNode("Display Candidate", {
        type: "trojan",
        password: "secret",
      }),
      ssNode("Same Content", {
        server: "same-content.example.com",
      }),
      ssNode("Taken Twice", {
        [ORIGIN_NAME_KEY]: "Taken",
      }),
      ssNode("Taken Twice 2", {
        [ORIGIN_NAME_KEY]: "Taken",
      }),
    ];
    const fresh = prepareSourceParsedNodes(
      [
        ssNode("Display Candidate"),
        ssNode("Fresh Same Content", { server: "same-content.example.com" }),
        ssNode("Taken"),
      ],
      {}
    );

    const result = mergeParsedSourceNodes([...existing, ...blankOrigin], fresh, [], {
      sourceId: "source-a",
      lastNameTemplate: "{name}",
      currentNameTemplate: "{name}",
    });

    expect(result.nodes.map((node) => node.name)).toContain("Display Candidate");
    expect(result.nodes.find((node) => node.name === "Same Content")).toMatchObject({
      [ORIGIN_NAME_KEY]: "Fresh Same Content",
      [SOURCE_IDS_KEY]: ["source-a"],
    });
    expect(result.nodes.filter((node) => node.name.startsWith("Taken"))).toHaveLength(1);
  });

  it("sanitizes and rejects Mihomo proxy edge values conservatively", () => {
    expect(isMihomoSupportedProxyNode({ type: "wireguard", name: "WG", "private-key": "bad" })).toBe(false);
    expect(
      isMihomoSupportedProxyNode({
        type: "wireguard",
        name: "WG",
        server: "wg.example.com",
        port: 51820,
        "private-key": WIREGUARD_KEY,
        "public-key": undefined,
        "pre-shared-key": WIREGUARD_KEY,
      })
    ).toBe(true);

    const sanitized = sanitizeMihomoProxyNode({
      name: "VLESS",
      type: "vless",
      server: "vless.example.com",
      port: 443,
      uuid: "11111111-1111-4111-8111-111111111111",
      encryption: "mlkem768x25519plus.native.0rtt.valid.token",
      "reality-opts": {
        "public-key": REALITY_PUBLIC_KEY,
        "short-id": "",
      },
      "xhttp-opts": {
        mode: "auto",
        "download-settings": {
          "reality-opts": {
            "public-key": "",
          },
          "ech-opts": {
            enable: 0,
            config: Buffer.from("ech").toString("base64"),
            "query-server-name": " dl.example.com ",
          },
        },
      },
    });

    expect(sanitized).toMatchObject({
      tls: true,
      "client-fingerprint": "chrome",
      encryption: "mlkem768x25519plus.native.0rtt.valid.token",
      "reality-opts": {
        "public-key": REALITY_PUBLIC_KEY,
      },
      "xhttp-opts": {
        "download-settings": {
          "reality-opts": { "public-key": "" },
          "ech-opts": {
            enable: 0,
            config: Buffer.from("ech").toString("base64"),
            "query-server-name": " dl.example.com ",
          },
        },
      },
    });
    expect((sanitized["reality-opts"] as Record<string, unknown>)).not.toHaveProperty("short-id");

    expect(
      normalizeMihomoVlessForGeneration({
        name: "Bad Reality",
        type: "vless",
        uuid: "11111111-1111-4111-8111-111111111111",
        "reality-opts": {
          "public-key": "bad",
        },
      })
    ).toHaveProperty("_subboost-invalid-mihomo-node", true);
  });

  it("parses platform proxy fallbacks for optional WireGuard and fingerprint branches", () => {
    expect(
      parsePlatformProxyLine("SSH FP = ssh, ssh.example.com, 22, username=root, private-key=key, tls-fingerprint=SHA256:abc")
    ).toMatchObject({
      type: "ssh",
    });

    expect(
      parsePlatformProxyLine("Any TCP = anytls, any.example.com, 443, password=p, servername=front.example.com")
    ).toMatchObject({
      type: "anytls",
    });

    const parsed = parsePlatformProxyLine("Office WG = wireguard, section-name=Office", {
      sections: new Map([
        [
          " wireguard office ",
          [
            " = ignored",
            "private-key = private",
            "peer = (public-key = public, pre-shared-key = pre, endpoint = wg.example.com:51820, client-id = \"[7/8/9]\", allowed-ips = \"0.0.0.0/0, ::/0\")",
          ],
        ],
      ]),
    });

    expect(parsed).toMatchObject({
      type: "wireguard",
      name: "Office WG",
      server: "wg.example.com",
      port: 51820,
      "private-key": "private",
      "public-key": "public",
      "pre-shared-key": "pre",
      reserved: [7, 8, 9],
      "allowed-ips": ["0.0.0.0/0", "::/0"],
    });
  });
});
