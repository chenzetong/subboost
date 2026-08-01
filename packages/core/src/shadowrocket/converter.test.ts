import { describe, expect, it } from "vitest";
import { convertClashYaml } from "./converter";

const YAML = `
proxies:
  - { name: SS, type: ss, server: ss.example.com, port: 8388, cipher: aes-128-gcm, password: ss-secret, udp: true }
  - { name: VMess, type: vmess, server: vmess.example.com, port: 443, uuid: 11111111-1111-4111-8111-111111111111, alterId: 0, cipher: auto, tls: true }
  - { name: VLESS, type: vless, server: vless.example.com, port: 443, uuid: 22222222-2222-4222-8222-222222222222, tls: true, network: ws, ws-opts: { path: /ws, headers: { Host: cdn.example.com } } }
  - { name: Trojan, type: trojan, server: trojan.example.com, port: 443, password: trojan-secret, sni: peer.example.com }
  - { name: AnyTLS, type: anytls, server: anytls.example.com, port: 443, password: anytls-secret, sni: anytls-peer.example.com, client-fingerprint: chrome }
  - { name: HY2, type: hysteria2, server: hy2.example.com, port: 443, password: hy2-secret, obfs: salamander, obfs-password: mask }
  - { name: TUIC, type: tuic, server: tuic.example.com, port: 443, uuid: 33333333-3333-4333-8333-333333333333, password: tuic-secret }
proxy-groups:
  - name: Proxy
    type: select
    proxies: [SS, VMess, VLESS, Trojan, AnyTLS, HY2, TUIC]
rule-providers:
  anthropic:
    type: http
    behavior: domain
    format: mrs
    url: https://github.com/MetaCubeX/meta-rules-dat/raw/meta/geo/geosite/anthropic.mrs
  private-ip:
    type: http
    behavior: ipcidr
    format: mrs
    url: https://github.com/MetaCubeX/meta-rules-dat/raw/meta/geo/geoip/private.mrs
rules:
  - RULE-SET,anthropic,Proxy
  - RULE-SET,private-ip,DIRECT,no-resolve
  - MATCH,Proxy
`;

describe("convertClashYaml", () => {
  it("embeds common SubBoost node types including AnyTLS", () => {
    const result = convertClashYaml(YAML, {
      ruleProviderBaseUrl: "https://subboost.example/api/rules/shadowrocket",
    });

    expect(result.metrics.proxiesEmbedded).toBe(7);
    expect(result.conf).toContain("[Proxy]\n");
    expect(result.conf).toContain("SS = ss,ss.example.com,8388,password=ss-secret,method=aes-128-gcm,udp=1");
    expect(result.conf).toContain("VMess = vmess,vmess.example.com,443,password=11111111-1111-4111-8111-111111111111");
    expect(result.conf).toContain("VLESS = vless,vless.example.com,443,password=22222222-2222-4222-8222-222222222222,tls=true");
    expect(result.conf).toContain("Trojan = trojan,trojan.example.com,443,password=trojan-secret,peer=peer.example.com");
    expect(result.conf).toContain("AnyTLS = anytls,anytls.example.com,443,password=anytls-secret,peer=anytls-peer.example.com,fingerprint=chrome");
    expect(result.conf).toContain("HY2 = hysteria2,hy2.example.com,443,auth=hy2-secret");
    expect(result.conf).toContain("TUIC = tuic,tuic.example.com,443,password=tuic-secret");
    expect(result.diagnostics.some((item) => item.code === "ROUTING_ONLY")).toBe(false);
  });

  it("maps .mrs providers to fixed SubBoost text conversion routes", () => {
    const result = convertClashYaml(YAML, {
      ruleProviderBaseUrl: "https://subboost.example/api/rules/shadowrocket",
    });
    expect(result.conf).toContain("RULE-SET,https://subboost.example/api/rules/shadowrocket/geosite/anthropic,Proxy");
    expect(result.conf).toContain("RULE-SET,https://subboost.example/api/rules/shadowrocket/geoip/private,DIRECT,no-resolve");
    expect(result.conf).not.toContain("# SKIPPED RULE-SET");
    expect(result.metrics.providersMapped).toBe(2);
    expect(result.metrics.providersSkipped).toBe(0);
  });

  it("keeps MITM omission as informational diagnostics only", () => {
    const result = convertClashYaml(YAML, {
      ruleProviderBaseUrl: "https://subboost.example/api/rules/shadowrocket",
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "MITM_OMITTED", severity: "info" }));
    expect(result.conf).not.toContain("[MITM]");
  });

  it("comments a binary provider when no safe conversion origin is supplied", () => {
    const result = convertClashYaml(YAML);
    expect(result.conf).toContain("# SKIPPED RULE-SET,anthropic,Proxy");
    expect(result.metrics.providersSkipped).toBe(2);
  });
});
