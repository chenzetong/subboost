import { describe, expect, it } from "vitest";
import { parseClashYaml } from "../../../packages/core/src/parser/clash-yaml";
import { canonicalizeParsedNode, pickAliasValue } from "../../../packages/core/src/parser/canonical-fields";
import { parseConfigLine } from "../../../packages/core/src/parser/config-line-parser";
import {
  applyCommonNodeParams,
  applyTransport,
  inferSkipCertVerify,
  isUuidLike,
  parseWsHeaders,
  tokenizeConfigLine,
} from "../../../packages/core/src/parser/config-line-tokenizer";
import { parsePlatformProxyLine } from "../../../packages/core/src/parser/platform/parse-platform-proxy-line";
import {
  parseLineBasedSubscriptionContent,
  parseSubscriptionContentByRegistry,
  splitNodeLinkSegments,
} from "../../../packages/core/src/parser/content-parsers";
import { preprocessSubscriptionContent } from "../../../packages/core/src/parser/preprocess";
import { parseHysteria2 } from "../../../packages/core/src/parser/protocols/hysteria2";
import { parseNetch } from "../../../packages/core/src/parser/protocols/netch";
import { normalizeSsPlugin, parseSS } from "../../../packages/core/src/parser/protocols/ss";
import { parseSSR } from "../../../packages/core/src/parser/protocols/ssr";
import {
  parseHttp,
  parseSimpleProxy,
  parseSocks,
  parseSsh,
  parseTelegramProxyLink,
} from "../../../packages/core/src/parser/protocols/simple-proxy";
import { parseVMess } from "../../../packages/core/src/parser/protocols/vmess";
import { parseVLESS } from "../../../packages/core/src/parser/protocols/vless";

const UUID = "11111111-1111-4111-8111-111111111111";

function b64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function ssr(main: string, query = ""): string {
  return `ssr://${b64(`${main}${query ? `/?${query}` : ""}`)}`;
}

function netch(value: Record<string, unknown>): string {
  return `netch://${b64(JSON.stringify(value))}`;
}

describe("public core parser remaining edge branches", () => {
  it("covers VMess client dialect fallbacks through real URI inputs", () => {
    expect(() => parseVMess(`vmess://${b64("aes-128-gcm:" + UUID + "@shadow.example.com:443")}`)).toThrow(
      "无效的 VMess JSON 格式",
    );
    expect(parseVMess(`vmess://tcp:${UUID}-0@standard.example.com:443`)).toMatchObject({
      name: "standard.example.com:443",
      network: "tcp",
      tls: false,
    });
    expect(() => parseVMess(`vmess://quic:${UUID}-0@quic.example.com:443?security=aes-128-gcm&type=dtls&key=quic-key#Quic`)).toThrow(
      "不支持的 VMess 传输层",
    );
    expect(parseVMess(`vmess://${UUID}@upgrade.example.com:443?type=httpupgrade&security=tls&path=/up%3Fed%3D128#Upgrade`)).toMatchObject({
      name: "Upgrade",
      network: "ws",
      "ws-opts": {
        path: "/up",
        "max-early-data": 128,
        "v2ray-http-upgrade": true,
      },
    });
    expect(parseVMess(`vmess1://${UUID}@kit-path.example.com:443/ws?network=ws&tls=1#KitPath`)).toMatchObject({
      name: "KitPath",
      network: "ws",
      "ws-opts": { path: "/ws" },
    });
    expect(parseVMess(`vmess1://${UUID}@kit-ech.example.com:443?network=ws&tls=1&ech=YWJj#KitEch`)).toMatchObject({
      name: "KitEch",
      "ech-opts": { enable: true, config: "YWJj" },
    });
    expect(parseVMess(`vmess://${b64("QX=vmess,quantum.example.com,443,auto," + UUID + ",obfs=wss,obfs-header=Host: q.example.com,obfs-path=/q,tls-verification=false")}`)).toMatchObject({
      name: "QX",
      network: "ws",
      tls: true,
      "skip-cert-verify": true,
      "ws-opts": { path: "/q", headers: { Host: "q.example.com" } },
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "Headers Object",
      add: "headers-object.example.com",
      port: 443,
      id: UUID,
      net: "tcp",
      type: "http",
      headers: { Host: ["preset.example.com"], Edge: true },
      host: "ignored.example.com",
      edge: "ignored-edge",
    }))}`)).toMatchObject({
      network: "http",
      "http-opts": {
        headers: {
          Host: ["preset.example.com"],
          Edge: ["true"],
        },
      },
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "H2 No Host",
      add: "h2-no-host.example.com",
      port: 443,
      id: UUID,
      net: "h2",
      tls: "tls",
    }))}`)).toMatchObject({
      network: "h2",
      "h2-opts": { path: "/" },
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "WS Defaults",
      add: "ws-defaults.example.com",
      port: 443,
      id: UUID,
      net: "ws",
      path: "/",
      tls: "tls",
    }))}`)).toMatchObject({
      network: "ws",
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "WS Edge",
      add: "ws-edge.example.com",
      port: 443,
      id: UUID,
      net: "ws",
      path: "/",
      edge: "edge-value",
      tls: "tls",
    }))}`)).toMatchObject({
      "ws-opts": { headers: { Edge: "edge-value" } },
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "GRPC Empty",
      add: "grpc-empty.example.com",
      port: 443,
      id: UUID,
      net: "grpc",
      tls: "tls",
    }))}`)).toMatchObject({
      "grpc-opts": { "grpc-service-name": "" },
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "Default Cipher",
      add: "default-cipher.example.com",
      port: 443,
      id: UUID,
      net: "tcp",
    }))}`)).toMatchObject({
      cipher: "auto",
      tls: false,
      network: "tcp",
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "Default Network",
      add: "default-network.example.com",
      port: 443,
      id: UUID,
    }))}`)).toMatchObject({
      cipher: "auto",
      tls: false,
      network: "tcp",
    });
    expect(parseVMess(`vmess://${UUID}@uri-extra.example.com:443?type=websocket&security=tls&edge=edge-value&authenticated-length=1&global-padding=1&packet-encoding=xudp#UriExtra`)).toMatchObject({
      name: "UriExtra",
      network: "ws",
      "ws-opts": { headers: { Edge: "edge-value" } },
    });
    expect(parseVMess(`vmess://${UUID}@uri-grpc.example.com:443?type=grpc&security=tls&path=/svc#UriGrpc`)).toMatchObject({
      network: "grpc",
      "grpc-opts": { "grpc-service-name": "svc" },
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "DingTalk HTTP",
      add: "dingtalk.example.com",
      port: 443,
      id: UUID,
      net: "tcp",
      type: "http",
      tls: "tls",
      host: "dtliving.dingtalk.com",
      path: "/",
      headers: { Existing: ["yes"] },
    }))}`)).toMatchObject({
      network: "http",
      "http-opts": {
        headers: expect.objectContaining({
          Existing: ["yes"],
          Host: ["dtliving.dingtalk.com"],
          "User-Agent": expect.any(Array),
        }),
      },
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "None Network",
      add: "none-network.example.com",
      port: 443,
      id: UUID,
      net: "none",
    }))}`)).toMatchObject({
      network: "tcp",
    });
    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "Websocket Alias",
      add: "websocket-alias.example.com",
      port: 443,
      id: UUID,
      net: "websocket",
      path: "/ws?ed=64",
    }))}`)).toMatchObject({
      network: "ws",
      "ws-opts": { "max-early-data": 64 },
    });
    expect(() => parseVMess(`vmess://${b64(JSON.stringify({
      ps: "Bad Network",
      add: "bad-network.example.com",
      port: 443,
      id: UUID,
      net: "quic",
    }))}`)).toThrow("不支持的 VMess 传输层");
    expect(() => parseVMess("trojan://example.com:443")).toThrow("无效的 VMess 链接");
    expect(() => parseVMess("vmess://not-base64")).toThrow("无效的 VMess JSON 格式");
    expect(() => parseVMess("vmess1://missing-port")).toThrow("无效的 Kitsunebi VMess 链接");
  });

  it("covers preprocess and Clash YAML repair branches", () => {
    expect(preprocessSubscriptionContent("   ")).toMatchObject({
      content: "",
      applied: [],
    });
    expect(preprocessSubscriptionContent("<!doctype html><html><body>blocked</body></html>")).toMatchObject({
      content: "",
      errors: ["检测到 HTML 页面内容，疑似错误页或拦截页，已停止解析"],
      applied: [],
    });
    expect(preprocessSubscriptionContent(`ssd://${b64("not-json")}`)).toMatchObject({
      content: "",
      errors: [expect.stringContaining("SSD 订阅预处理失败")],
      applied: [],
    });
    expect(preprocessSubscriptionContent(`ssd://${b64(JSON.stringify({
      port: 8388,
      encryption: "aes-128-gcm",
      password: "pw",
    }))}`)).toMatchObject({
      content: "",
      errors: ["SSD 订阅预处理失败: SSD 订阅中未找到可转换的服务器条目"],
      applied: [],
    });
    expect(preprocessSubscriptionContent(`ssd://${b64(JSON.stringify({
      port: 8388,
      encryption: "aes-128-gcm",
      password: "pw",
      servers: [],
    }))}`)).toMatchObject({
      content: "",
      errors: ["SSD 订阅预处理失败: SSD 订阅中未找到可转换的服务器条目"],
      applied: [],
    });
    expect(preprocessSubscriptionContent(`ssd://${b64(JSON.stringify({
      port: 8388,
      encryption: "aes-128-gcm",
      password: "pw",
      servers: [{ server: 123 }, { server: "missing-password.example.com", password: "" }],
    }))}`)).toMatchObject({
      content: "",
      errors: ["SSD 订阅预处理失败: SSD 订阅中未找到可转换的服务器条目"],
      applied: [],
    });
    expect(preprocessSubscriptionContent(`ssd://${b64(JSON.stringify({
      airport: "Air",
      port: 8388,
      encryption: "aes-128-gcm",
      password: "pw",
      servers: {
        a: { server: "ssd-object.example.com", plugin: "obfs-local" },
        b: { server: "bad.example.com", port: 0 },
      },
    }))}`)).toMatchObject({
      applied: ["ssd"],
      content: expect.stringContaining("ssd-object.example.com"),
    });
    expect(preprocessSubscriptionContent(JSON.stringify({
      Server: [
        JSON.stringify({ Type: "SS", Hostname: "ss.example.com", Port: 8388 }),
        { Type: "HTTP", Hostname: "http.example.com", Port: 80 },
        123,
      ],
    }))).toMatchObject({
      applied: ["netch-json"],
      content: expect.stringContaining("netch://"),
    });
    expect(preprocessSubscriptionContent(JSON.stringify({
      ModeFileNameType: "Netch",
      Server: [
        { Type: "SOCKS5", Hostname: "socks.example.com", Port: 1080, Remark: "Mode" },
      ],
    }))).toMatchObject({
      applied: ["netch-json"],
      content: expect.stringContaining("netch://"),
    });
    const nestedPlain = b64("not base64 !!!");
    expect(preprocessSubscriptionContent(nestedPlain)).toMatchObject({
      applied: ["base64"],
      content: "not base64 !!!",
    });
    expect(preprocessSubscriptionContent(`ssd://${b64(JSON.stringify({
      port: 8388,
      encryption: "aes-128-gcm",
      password: "pw",
      servers: [{ server: "malformed-tag.example.com", remarks: "%E0%A4%A" }],
    }))}`)).toMatchObject({
      applied: ["ssd"],
      content: expect.stringContaining("malformed-tag.example.com"),
    });
    expect(preprocessSubscriptionContent("{\"Server\":[\"{bad json\"]}")).toMatchObject({
      content: "",
      errors: ["Netch 配置中未找到可转换的服务器条目"],
      applied: [],
    });
    expect(preprocessSubscriptionContent("[Server_Remote]\nRemote = http, remote.example.com, 80\n[WireGuard Office]\npeer = (endpoint = wg.example.com:51820)\n[General]\nskip=true")).toMatchObject({
      applied: ["full-config"],
      content: expect.stringContaining("[WireGuard Office]"),
    });
    expect(preprocessSubscriptionContent("proxies:\n\t- name: Tabbed\n\t  type: ss\n\t  server: tab.example.com\n\t  port: 8388\n\t  cipher: aes-128-gcm\n\t  password: pw")).toMatchObject({
      content: expect.stringContaining("Tabbed"),
    });
    expect(preprocessSubscriptionContent("[Proxy]\n   ")).toMatchObject({
      applied: [],
      content: "[Proxy]",
    });

    expect(parseClashYaml("")).toMatchObject({ totalFailed: 1, errors: ["空的配置文件"] });
    expect(parseClashYaml("just-a-scalar")).toMatchObject({
      nodes: [],
      errors: ["无法识别为 Clash YAML（缺少 proxies 或节点字段）"],
    });
    expect(parseClashYaml("proxy-providers: {}")).toMatchObject({
      nodes: [],
      errors: ["节点解析失败: 缺少节点类型"],
    });
    expect(parseClashYaml("proxy-providers:\n  remote:\n    type: http\n    url: https://provider.example.com/sub.yaml")).toMatchObject({
      errors: expect.arrayContaining([
        "节点解析失败: 缺少节点类型",
        "检测到 proxy-providers 配置，由于浏览器限制无法自动拉取，请直接粘贴节点内容",
      ]),
    });
    expect(parseClashYaml("- bad\n- name: Bad\n  type: ss\n  server: bad.example.com\n  port: 0")).toMatchObject({
      nodes: [],
      errors: [expect.stringContaining('节点 "Bad" 解析失败')],
    });
    expect(
      parseClashYaml(`
proxies:
  - name: ss-A
      type: ss
      server: repaired.example.com
      port: 8388
      cipher: aes-128-gcm
      password: pw
`),
    ).toMatchObject({
      nodes: [expect.objectContaining({ name: "ss-A", server: "repaired.example.com" })],
      totalParsed: 1,
    });
    expect(
      parseClashYaml(`
proxies:
  - name: VLESS
    type: vless
    server: vless.example.com
    port: 443
    uuid: ${UUID}
    tls: true
    reality-opts:
      public-key: ${"A".repeat(43)}
      short-id: 1234
    network: ws
    ws-opts:
      path: /ws?ed=256
`),
    ).toMatchObject({
      nodes: [
        expect.objectContaining({
          "reality-opts": expect.objectContaining({ "short-id": "1234" }),
          "ws-opts": expect.objectContaining({ "max-early-data": 256 }),
        }),
      ],
    });
    expect(
      parseClashYaml(`
proxies:
  - name: Defaults VMess
    type: vmess
    server: defaults-vmess.example.com
    port: 443
  - name: Defaults VLESS
    type: vless
    server: defaults-vless.example.com
    port: 443
  - name: Defaults HY2
    type: hy2
    server: defaults-hy2.example.com
    port: 443
`),
    ).toMatchObject({
      nodes: [
        expect.objectContaining({ name: "Defaults VMess", uuid: "", cipher: "auto" }),
        expect.objectContaining({ name: "Defaults VLESS", uuid: "" }),
        expect.objectContaining({ name: "Defaults HY2", password: "" }),
      ],
    });
    expect(
      parseClashYaml(`
proxies:
  - 123
  - name: Empty Ws
    type: vmess
    server: empty-ws.example.com
    port: 443
    uuid: ${UUID}
    network: ws
    ws-opts:
      path: ""
  - name: Hysteria Ports
    type: hy2
    server: hy2.example.com
    port: 443
    password: secret
    ports: 1000-2000
  - name: VLESS Empty Reality
    type: vless
    server: empty-reality.example.com
    port: 443
    uuid: ${UUID}
    tls: true
    reality-opts:
      short-id: ""
  - name: Unknown Future
    type: future-proto
    server: future.example.com
    port: 9443
`),
    ).toMatchObject({
      nodes: [
        expect.objectContaining({ name: "Empty Ws", type: "vmess" }),
        expect.objectContaining({ name: "Hysteria Ports", type: "hysteria2", ports: "1000-2000" }),
        expect.objectContaining({ name: "VLESS Empty Reality", type: "vless" }),
        expect.objectContaining({ name: "Unknown Future", type: "future-proto" }),
      ],
    });
    expect(
      parseClashYaml(`
proxies:
  - name: VMess Preset Early Data
    type: vmess
    server: preset-ed.example.com
    port: 443
    uuid: ${UUID}
    network: ws
    ws-opts:
      path: /ws?ed=512
      max-early-data: 99
`),
    ).toMatchObject({
      nodes: [
        expect.objectContaining({
          "ws-opts": expect.objectContaining({
            path: "/ws",
            "max-early-data": 99,
          }),
        }),
      ],
    });
    expect(parseClashYaml("proxies:\n  - name: [")).toMatchObject({
      nodes: [],
      totalFailed: 1,
      errors: [expect.stringContaining("YAML 解析错误")],
    });
  });
});
