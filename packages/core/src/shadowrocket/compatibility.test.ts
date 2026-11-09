import { describe, expect, it } from "vitest";
import { convertClashConfig, convertClashYaml, parseClashYaml } from "./converter";
import { convertProxy } from "./node-converter";
import { describeProviderFailure, resolveProvider } from "./provider-map";
import { convertMetaCubeXRuleList } from "./rule-list";
import type { ClashProxy, Diagnostic, RuleProvider } from "./types";

describe("Shadowrocket compatibility after upstream updates", () => {
  it.each(["", "   ", "proxies: [", "null", "[]", "hello", "---\na: 1\n---\nb: 2"])("rejects invalid profile %j", (source) => {
    expect(() => parseClashYaml(source)).toThrow();
  });

  it("uses the shared Mihomo schema for aliases and numeric credentials", () => {
    const result = convertClashYaml(`
defaults: &node {type: ss, server: example.test, port: 8388, cipher: aes-128-gcm, password: 0123}
proxies: [{<<: *node, name: SS}]
rules: [MATCH,PROXY]
`, { embedNodes: true });
    expect(result.conf).toContain("SS = ss,example.test,8388,password=123");
  });

  it("keeps routing-only defaults fail-closed for unsupported UDP and adds a final rule", () => {
    const result = convertClashConfig({});
    expect(result.conf).toContain("udp-policy-not-supported-behaviour = REJECT");
    expect(result.conf).toContain("FINAL,DIRECT");
    expect(result.conf).toContain("ipv6 = false");
    expect(result.conf).not.toContain("[Proxy]\n");
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "FINAL_ADDED" })]));
  });

  it("preserves explicit DNS routes, IPv6 choice, IMS exceptions and supported hosts", () => {
    const result = convertClashConfig({
      ipv6: false,
      dns: {
        ipv6: true,
        nameserver: ["system", "dhcp://en0", "https://dns.test/query", "https://dns.test/query#proxy", 123, null, ""],
        fallback: ["tls://dns.test", "https://fallback.test/query"],
        "proxy-server-nameserver": ["https://proxy.test/query"],
        "nameserver-policy": { "example.test": "1.1.1.1" },
        "fake-ip-filter": ["ims.test", "stun.example.test"],
      },
      hosts: { "one.test": "1.1.1.1", "two.test": ["2.2.2.2", "::1"], "number.test": 123, "bad.test": {} },
    });
    expect(result.conf).toContain("dns-server = https://dns.test/query#no-h3, https://dns.test/query#proxy, 123");
    expect(result.conf).toContain("proxy-dns-server = https://proxy.test/query#proxy");
    expect(result.conf).toContain("ipv6 = true");
    expect(result.conf).toContain("always-real-ip = ims.test");
    expect(result.conf).toContain("two.test = 2.2.2.2, ::1");
    expect(result.conf).toContain("number.test = 123");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["HOST_SKIPPED", "DNS_POLICY_FLATTENED"]));
    expect(convertClashConfig({ ipv6: true, hosts: { bad: null } }).conf).not.toContain("[Host]");
    expect(convertClashConfig({ ipv6: true }).conf).toContain("ipv6 = true");
  });

  it("diagnoses unsupported groups and providers without emitting invalid lists", () => {
    const result = convertClashConfig({
      proxies: [{ name: "unsupported", type: "wireguard", server: "example.test", port: 443 }],
      "proxy-groups": [
        {}, { name: "bad", type: "unknown" }, { name: "empty", type: "" },
        { name: "a,b", type: "fallback", proxies: ["DIRECT"], use: ["remote"], url: "https://test.test", interval: 60, tolerance: 10 },
        { name: "🐟 漏网之鱼", proxies: ["DIRECT"] },
      ],
      "rule-providers": { Binary: { format: "mrs", url: "https://example.test/a.mrs" }, Plain: { url: "https://example.test/a.yaml" } },
      rules: ["RULE-SET,binary,PROXY,no-resolve", "RULE-SET,Plain", "RULE-SET", "DOMAIN,test.test,Missing,no-resolve", "DOMAIN", "FINAL", "MATCH,PROXY"],
    }, { embedNodes: true });
    expect(result.conf).not.toContain("[Proxy]\n");
    expect(result.conf).toContain("a,b = fallback,DIRECT,url=https://test.test,interval=60,tolerance=10");
    expect(result.conf).toContain("# SKIPPED RULE-SET,binary,PROXY,no-resolve");
    expect(result.conf).toContain("FINAL,PROXY");
    expect(result.conf).not.toContain("FINAL,DIRECT");
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "UNSUPPORTED_GROUP", "UNSAFE_GROUP_NAME", "PROVIDER_GROUP_NOT_EXPANDED", "UNKNOWN_POLICY", "MULTIPLE_FINAL",
    ]));
    expect(convertClashConfig({ "proxy-groups": [{ name: "🐟 漏网之鱼" }] }).conf).toContain("FINAL,🐟 漏网之鱼");
    expect(convertClashConfig({ "proxy-groups": [{ name: "Custom" }] }).conf).toContain("FINAL,Custom");
  });

  it.each([
    [{ url: "https://example.test/direct.list", behavior: "classical" }, undefined, "https://example.test/direct.list"],
    [{ url: "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Test/Test.list" }, undefined, "https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Shadowrocket/Test/Test.list"],
    [{ url: "https://example.test/geoip/cn.mrs" }, "https://app.test/rules/", "https://app.test/rules/geoip/cn"],
    [{ url: "https://example.test/geosite/test.mrs" }, "https://app.test/rules", "https://app.test/rules/geosite/test"],
    [{ url: "https://example.test/", path: "geo/test.mrs", behavior: "domain" }, "https://app.test/rules", "https://app.test/rules/geosite/test"],
    [{ url: "https://example.test/", behavior: "ipcidr" }, "https://app.test/rules", "https://app.test/rules/geoip/fallback"],
    [{ url: "http://[/test.mrs", behavior: "domain" }, "https://app.test/rules", "https://app.test/rules/geosite/test"],
  ] as [RuleProvider, string | undefined, string][])("resolves compatible list %j", (provider, base, expected) => {
    expect(resolveProvider("fallback", provider, base)).toEqual([{ url: expected }]);
  });

  it("rejects missing and unconvertible providers with useful diagnostics", () => {
    for (const provider of [undefined, {}, { path: "local.mrs" }, { url: "https://example.test/" }, { url: "https://example.test/", behavior: "domain" }]) {
      expect(resolveProvider("invalid/name", provider, "https://app.test/rules")).toEqual([]);
    }
    expect(describeProviderFailure(undefined)).toContain("找不到");
    expect(describeProviderFailure({ path: "a.mrs" })).toContain("二进制");
    expect(describeProviderFailure({})).toContain("没有可用");
  });

  const base = { name: "Node", server: "example.test", port: 443, password: "test", uuid: "test-uuid", cipher: "aes-128-gcm" };
  it.each([
    [{ type: "ss", plugin: "obfs-local", "plugin-opts": { mode: "http", host: "cdn.test" } }, "obfs=http,obfs-host=cdn.test"],
    [{ type: "ss", plugin: "v2ray-plugin", "plugin-opts": { tls: true, path: "/ws" } }, "path=/ws,tls=true"],
    [{ type: "ss", plugin: "v2ray-plugin" }, "obfs=websocket"],
    [{ type: "ss", plugin: "custom-plugin" }, "plugin=custom-plugin"],
    [{ type: "vmess", tls: false, alterId: 1, network: "grpc", "grpc-opts": { serviceName: "service" } }, "grpc-service-name=service"],
    [{ type: "vmess", network: "grpc", "grpc-opts": { "grpc-service-name": "service" } }, "grpc-service-name=service"],
    [{ type: "vless", tls: false, flow: "xtls-rprx-vision", "reality-opts": { "public-key": "key", "short-id": "abcd" } }, "reality-pk=key,reality-sid=abcd"],
    [{ type: "vless", tls: false, network: "h2", "h2-opts": { host: ["a.test", "b.test"], path: "/h2" } }, "obfs-host=a.test|b.test"],
    [{ type: "trojan", network: "http", "http-opts": { path: ["/first", "/second"], headers: { host: "cdn.test" } } }, "path=/first,obfs-host=cdn.test"],
    [{ type: "trojan", network: "http", "http-opts": { path: "/one", headers: { Host: "cdn.test" } } }, "path=/one,obfs-host=cdn.test"],
    [{ type: "trojan", network: "ws", "ws-opts": { headers: { host: "cdn.test" } } }, "obfs-host=cdn.test"],
    [{ type: "trojan", network: "custom" }, "obfs=custom"],
    [{ type: "anytls", udp: false, tfo: true, servername: "peer.test", alpn: ["h2", "http/1.1"], "skip-cert-verify": false, fingerprint: "safari" }, "allowInsecure=0,fingerprint=safari,tfo=1"],
    [{ type: "hy2", password: undefined, auth: "auth-test" }, "auth=auth-test"],
    [{ type: "tuic", password: undefined, token: "token-test" }, "password=token-test"],
  ] as [Partial<ClashProxy>, string][])("preserves transport options %j", (patch, expected) => {
    const diagnostics: Diagnostic[] = [];
    expect(convertProxy({ ...base, ...patch }, diagnostics)).toContain(expected);
    expect(diagnostics).toEqual([]);
  });

  it.each([
    [{}, "INVALID_PROXY"], [{ type: "ss" }, "INVALID_PROXY"],
    [{ ...base, name: "" }, "INVALID_PROXY"], [{ ...base, server: "" }, "INVALID_PROXY"],
    [{ ...base, port: null }, "INVALID_PROXY"], [{ ...base, type: "ss", password: "" }, "INVALID_PROXY_SECRET"],
    [{ ...base, type: "wireguard" }, "UNSUPPORTED_PROXY"], [{ ...base }, "UNSUPPORTED_PROXY"],
  ] as [ClashProxy, string][])("rejects unusable nodes %j", (proxy, code) => {
    const diagnostics: Diagnostic[] = [];
    expect(convertProxy(proxy, diagnostics)).toBeUndefined();
    expect(diagnostics[0].code).toBe(code);
  });

  it("skips malformed list entries while keeping supported domain markers", () => {
    const result = convertMetaCubeXRuleList([
      "// comment", "domain:", "full:", "keyword:", "+.", "*.", "/regex/", "bad..test", "singlelabel",
      "invalid.test/999", "bad#hash.test", "256.1.1.1/32", "::1/129", "::1/x", "1.1.1.1/33", "1.1.1.1/32/extra",
      "*.Example.test.", "domain:...example.test.", "valid_1-!+@.test\t# comment",
    ].join("\n"), "geosite");
    expect(result.content).toBe("DOMAIN-SUFFIX,Example.test\nDOMAIN-SUFFIX,example.test\nDOMAIN,valid_1-!+@.test\n");
    expect(convertMetaCubeXRuleList("# none\ninvalid", "geoip").content).toBe("");
  });
});
