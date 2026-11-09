import { describe, expect, it } from "vitest";
import {
  parseHttp,
  parseSimpleProxy,
  parseSocks,
  parseSsh,
  parseTelegramProxyLink,
} from "@subboost/core/parser/protocols/simple-proxy";
import { parseVMess } from "@subboost/core/parser/protocols/vmess";
import { parseVLESS } from "@subboost/core/parser/protocols/vless";
import { normalizeSsPlugin, parseSS } from "@subboost/core/parser/protocols/ss";
import { parseNetch } from "@subboost/core/parser/protocols/netch";
import { preprocessSubscriptionContent } from "@subboost/core/parser/preprocess";
import { parseConfigLine } from "@subboost/core/parser/config-line-parser";
import { parsePlatformProxyLine } from "@subboost/core/parser/platform/parse-platform-proxy-line";
import {
  SUBBOOST_TEMPLATE_CONFIG_SCHEMA,
  validateSubBoostTemplateConfig,
} from "@subboost/core/templates/config-template";

const UUID = "11111111-1111-4111-8111-111111111111";

function b64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function netchLink(value: Record<string, unknown>): string {
  return `netch://${b64(JSON.stringify(value))}`;
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe("public core branch coverage regressions", () => {
  describe("Netch and subscription preprocessors", () => {
    it("parses Netch protocol families and error branches", () => {
      expect(
        parseNetch(
          netchLink({
            Type: "SS",
            Hostname: "ss.netch.example.com",
            Port: "8388",
            Remark: "",
            Password: "secret",
            Plugin: "obfs-local",
            PluginOption: "mode=tls;;host=cdn.example.com;flag",
            EnableUDP: 0,
            EnableTFO: 1,
          })
        )
      ).toMatchObject({
        name: "SS-ss.netch.example.com:8388",
        type: "ss",
        udp: false,
        tfo: true,
        plugin: "obfs-local",
        "plugin-opts": {
          mode: "tls",
          host: "cdn.example.com",
          flag: true,
        },
      });

      expect(
        parseNetch(
          netchLink({
            Type: "SSR",
            Hostname: "ssr.example.com",
            Port: 8388,
            Password: "secret",
            Protocol: "auth_sha1_v4",
            ProtocolParam: "param",
            OBFS: "tls1.2_ticket_auth",
            OBFSParam: "obfs.example.com",
          })
        )
      ).toMatchObject({
        type: "ssr",
        protocol: "auth_sha1_v4",
        "protocol-param": "param",
        obfs: "tls1.2_ticket_auth",
        "obfs-param": "obfs.example.com",
      });

      expect(
        parseNetch(
          netchLink({
            Type: "VMess",
            Hostname: "vmess.netch.example.com",
            Port: 443,
            UserID: UUID,
            TransferProtocol: "websocket",
            Host: "cdn.example.com",
            Edge: "edge",
            Path: "/ws",
            TLSSecure: true,
            ServerName: "sni.example.com",
            AllowInsecure: true,
          })
        )
      ).toMatchObject({
        type: "vmess",
        network: "ws",
        tls: true,
        servername: "sni.example.com",
        "skip-cert-verify": true,
        "ws-opts": {
          headers: {
            Host: "cdn.example.com",
            Edge: "edge",
          },
        },
      });

      expect(
        parseNetch(
          netchLink({
            Type: "Trojan",
            Hostname: "trojan.example.com",
            Port: 443,
            Password: "secret",
            TransferProtocol: "httpupgrade",
            Host: "cdn.example.com",
            Path: "/upgrade",
          })
        )
      ).toMatchObject({
        type: "trojan",
        network: "ws",
        "ws-opts": {
          "v2ray-http-upgrade": true,
          "v2ray-http-upgrade-fast-open": true,
        },
      });

      expect(
        parseNetch(
          netchLink({
            Type: "Snell",
            Hostname: "snell.example.com",
            Port: 443,
            Password: "psk",
            SnellVersion: "4",
            OBFS: "tls",
            Host: "cdn.example.com",
          })
        )
      ).toMatchObject({
        type: "snell",
        version: 4,
        "obfs-opts": {
          mode: "tls",
          host: "cdn.example.com",
        },
      });

      expect(() => parseNetch(netchLink({ Type: "Trojan", Hostname: "bad.example.com", Port: 443 }))).toThrow(
        "Netch Trojan 缺少 password"
      );
    });

    it("preprocesses SSD, Netch JSON, full config, base64, HTML, and error content", () => {
      expect(
        preprocessSubscriptionContent(
          `ssd://${b64(
            JSON.stringify({
              airport: "Airport",
              port: 8388,
              encryption: "aes-128-gcm",
              password: "default",
              servers: {
                one: { server: "ssd-one.example.com", remarks: "One" },
                two: {
                  server: "ssd-two.example.com",
                  port: 443,
                  password: "override",
                  plugin: "obfs-local",
                  plugin_options: "obfs=tls;obfs-host=cdn.example.com",
                },
                broken: { server: "", port: 0 },
              },
            })
          )}`
        )
      ).toMatchObject({
        applied: ["ssd"],
        errors: [],
      });

      expect(
        preprocessSubscriptionContent(
          JSON.stringify({
            ModeFileNameType: "txt",
            Server: [
              JSON.stringify({ Type: "Socks5", Hostname: "socks.example.com", Port: 1080, Username: "u" }),
              { Type: "HTTP", Hostname: "http.example.com", Port: 8080 },
              "not json",
            ],
          })
        )
      ).toMatchObject({
        applied: ["netch-json"],
        errors: [],
      });

      expect(
        preprocessSubscriptionContent(
          "[General]\nloglevel=notify\n\n[Proxy]\nNode = http, example.com, 8080\n\n[WireGuard Office]\nprivate-key = key\npeer = (endpoint = \"wg.example.com:51820\")"
        )
      ).toMatchObject({
        applied: ["full-config"],
        errors: [],
      });

      expect(preprocessSubscriptionContent(b64("ss://example"))).toMatchObject({
        content: "ss://example",
        applied: ["base64"],
      });
      expect(preprocessSubscriptionContent("<html><head></head><body>blocked</body></html>").errors[0]).toContain(
        "HTML 页面内容"
      );
      expect(preprocessSubscriptionContent(`ssd://${b64(JSON.stringify({ servers: [] }))}`).errors[0]).toContain(
        "SSD 订阅预处理失败"
      );
    });
  });

  describe("template config validation", () => {
    function validTemplateConfig(): Record<string, unknown> {
      return {
        schema: SUBBOOST_TEMPLATE_CONFIG_SCHEMA,
        template: "standard",
        enabledProxyGroups: ["select", "auto", "cn", "global", "final", "select"],
        hiddenProxyGroups: ["cn"],
        customProxyGroups: [
          {
            id: "custom-stream",
            name: "Custom Stream",
            emoji: "",
            groupType: "load-balance",
          },
        ],
        customRuleSets: [
          {
            id: "stream-rule",
            name: "Stream Rule",
            behavior: "domain",
            path: "https://rules.example.com/stream.mrs",
            target: "Custom Stream",
            noResolve: false,
          },
        ],
        customRules: [
          {
            type: "DOMAIN-SUFFIX",
            value: "example.com",
            target: "Custom Stream",
            noResolve: true,
          },
        ],
        dialerProxyGroups: [
          {
            id: "dialer-a",
            name: "Dialer A",
            type: "select",
            relayNodes: ["Relay"],
            targetNodes: ["Target"],
            enabled: false,
          },
        ],
        builtinRuleEdits: {
          "module:cn:geolocation-cn": {
            target: "Custom Stream",
            enabled: false,
          },
        },
        proxyGroupNameOverrides: {
          select: "Select Override",
          empty: "",
        },
        ruleOrder: ["missing", "custom-rule:missing"],
        dnsYaml: "",
        mixedPort: 7890,
        allowLan: false,
        testUrl: "https://connectivitycheck.gstatic.com/generate_204",
        testInterval: 300,
        ruleProviderBaseUrl: "https://rules.example.com",
        cnIpNoResolve: false,
        experimentalCnUseCnRuleSet: true,
      };
    }

    it("normalizes a complete template config with optional branches", () => {
      const result = validateSubBoostTemplateConfig(validTemplateConfig());
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.config.enabledProxyGroups).toEqual(["select", "auto", "cn", "global", "final"]);
      expect(result.config.customProxyGroups[0]).toMatchObject({
        groupType: "load-balance",
        strategy: "consistent-hashing",
      });
      expect(result.config.proxyGroupAdvancedModeEnabled).toBe(true);
      expect(result.config).not.toHaveProperty("allRulesOrderEditingEnabled");
      expect(result.config.cnIpNoResolve).toBe(false);
      expect(result.config.experimentalCnUseCnRuleSet).toBe(true);
    });

    it("rejects invalid template config branches without mutating successful cases", () => {
      for (const [patch, expected] of [
        [{}, "模板配置必须是对象"],
        [{ schema: "wrong" }, "模板配置 schema 无效"],
        [{ template: "other" }, "模板类型无效"],
        [{ enabledProxyGroups: ["unknown"] }, "enabledProxyGroups 包含未知代理组"],
        [{ hiddenProxyGroups: ["select", "auto", "cn", "global", "final"] }, "至少需要一个可见代理组"],
        [{ customProxyGroups: [{ id: "", name: "Bad", emoji: "", groupType: "select" }] }, "customProxyGroups.id 不能为空"],
        [{ proxyGroupAdvanced: [] }, "proxyGroupAdvanced 必须是对象"],
        [{ proxyGroupAdvanced: { missing: {} } }, "proxyGroupAdvanced 包含未知代理组"],
        [{ dialerProxyGroups: [{ id: "bad", name: "Bad", type: "bad", relayNodes: [], targetNodes: [] }] }, "dialerProxyGroups.type 无效"],
        [{ customRuleSets: [{ id: "bad", name: "Bad", behavior: "domain", path: "bad.txt", target: "DIRECT" }] }, "customRuleSets.path 无效"],
        [{ builtinRuleEdits: { "module:missing:rule": { enabled: false } } }, "builtinRuleEdits 包含未知内置规则"],
        [{ proxyGroupNameOverrides: [] }, "proxyGroupNameOverrides 必须是对象"],
        [{ testUrl: "ftp://example.com" }, "testUrl 必须是 http(s) URL"],
        [{ mixedPort: 70000 }, "mixedPort 必须在 1 到 65535 之间"],
      ] as const) {
        const input = patch === record(patch) && Object.keys(patch).length === 0 ? null : { ...validTemplateConfig(), ...patch };
        const result = validateSubBoostTemplateConfig(input);
        expect(result).toMatchObject({ ok: false, error: expected });
      }
    });

    it("rejects malformed nested template config records", () => {
      for (const patch of [
        { customRules: "bad" },
        { customRules: [null] },
        { customRules: [{ type: "BAD", value: "example.com", target: "DIRECT" }] },
        { customRules: [{ type: "DOMAIN", value: "", target: "DIRECT" }] },
        { customRules: [{ type: "DOMAIN", value: "example.com", target: "DIRECT", noResolve: "yes" }] },
        { customProxyGroups: "bad" },
        { customProxyGroups: [null] },
        { customProxyGroups: [{ id: "custom", name: "", emoji: "", groupType: "select" }] },
        { customProxyGroups: [{ id: "custom", name: "Custom", emoji: "", groupType: "bad" }] },
        { customRuleSets: "bad" },
        { customRuleSets: [null] },
        { customRuleSets: [{ id: "bad", name: "Bad", behavior: "domain", path: "bad.txt", target: "DIRECT" }] },
        { proxyGroupAdvanced: [] },
        { proxyGroupAdvanced: { missing: {} } },
        { dialerProxyGroups: "bad" },
        { dialerProxyGroups: [null] },
        { dialerProxyGroups: [{ id: "dialer", name: "Dialer", type: "select", relayNodes: [123], targetNodes: [] }] },
        { builtinRuleEdits: [] },
        { builtinRuleEdits: { "module:missing:rule": { enabled: false } } },
        { builtinRuleEdits: { "module:cn:geolocation-cn": "bad" } },
        { proxyGroupNameOverrides: { select: 123 } },
        { ruleOrder: [123] },
        { dnsYaml: 123 },
        { allowLan: "false" },
        { testInterval: 0 },
        { ruleProviderBaseUrl: "ftp://rules.example.com" },
      ]) {
        expect(validateSubBoostTemplateConfig({ ...validTemplateConfig(), ...patch }).ok).toBe(false);
      }
    });
  });
});
