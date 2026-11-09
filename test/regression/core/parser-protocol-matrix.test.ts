import { describe, expect, it } from "vitest";
import { looksLikeConfigLine, parseConfigLine } from "../../../packages/core/src/parser/config-line-parser";
import {
  applyCommonNodeParams,
  applyTransport,
  isUuidLike,
  parseBooleanish,
  parseIntParam,
  parseStringList,
  parseWsHeaders,
  tokenizeConfigLine,
} from "../../../packages/core/src/parser/config-line-tokenizer";
import { parseNetch } from "../../../packages/core/src/parser/protocols/netch";
import {
  parseHeaderRecord,
  normalizeHttpMethod,
  parseBooleanish as parseVmessBooleanish,
  parseObfsHeaderHost,
  splitList,
} from "../../../packages/core/src/parser/protocols/vmess-utils";
import { parseHttp, parseSimpleProxy, parseSocks, parseSsh, parseTelegramProxyLink } from "../../../packages/core/src/parser/protocols/simple-proxy";
import { normalizeSsPlugin, parseSS } from "../../../packages/core/src/parser/protocols/ss";
import { parseSSR } from "../../../packages/core/src/parser/protocols/ssr";
import { parseVMess } from "../../../packages/core/src/parser/protocols/vmess";
import { parseVLESS } from "../../../packages/core/src/parser/protocols/vless";
import { preprocessSubscriptionContent } from "../../../packages/core/src/parser/preprocess";
import { parsePlatformProxyLine } from "../../../packages/core/src/parser/platform/parse-platform-proxy-line";
import {
  isMihomoSupportedProxyNode,
  isStandardBase64String,
  normalizeMihomoRealityPublicKey,
  normalizeMihomoVlessForGeneration,
  sanitizeMihomoProxyNode,
} from "../../../packages/core/src/mihomo/proxy-sanitizer";

const UUID = "11111111-1111-4111-8111-111111111111";
const REALITY_PUBLIC_KEY = "A".repeat(43);

function b64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function netch(payload: Record<string, unknown>): string {
  return `netch://${b64(JSON.stringify(payload))}`;
}

describe("public core parser branch sweep", () => {
  it("covers preprocess failure paths and multi-pass source conversions", () => {
    expect(preprocessSubscriptionContent("prefix <head></head><body>blocked")).toMatchObject({
      content: "",
      errors: ["检测到 HTML 页面内容，疑似错误页或拦截页，已停止解析"],
      applied: [],
    });

    expect(preprocessSubscriptionContent(Buffer.from("\u0001bad").toString("base64"))).toMatchObject({
      applied: [],
    });

    expect(preprocessSubscriptionContent("ssd://bad")).toMatchObject({
      content: "",
      errors: [expect.stringContaining("SSD 订阅预处理失败")],
      applied: [],
    });

    expect(preprocessSubscriptionContent(`ssd://${b64(JSON.stringify({ servers: [null, { server: "", port: 0 }] }))}`)).toMatchObject({
      content: "",
      errors: ["SSD 订阅预处理失败: SSD 订阅中未找到可转换的服务器条目"],
      applied: [],
    });

    const ssdArray = `ssd://${b64(JSON.stringify({
      airport: "Airport",
      port: 8388,
      encryption: "aes-128-gcm",
      password: "pw",
      servers: [
        { server: "array.example.com", remarks: "%E8%8A%82%E7%82%B9", plugin: "obfs-local" },
        { server: "plugin.example.com", plugin: "v2ray-plugin", plugin_options: "mode=websocket;tls" },
      ],
    }))}`;
    const ssdResult = preprocessSubscriptionContent(ssdArray);
    expect(ssdResult.applied).toEqual(["ssd"]);
    expect(ssdResult.content).toContain("array.example.com:8388");
    expect(ssdResult.content).toContain("plugin=");

    expect(preprocessSubscriptionContent('{"ModeFileNameType":1,"Server":"bad"}')).toMatchObject({
      content: "",
      errors: ["Netch 配置缺少 Server 列表"],
      applied: [],
    });
    expect(preprocessSubscriptionContent('{"Server":[null,0,"bad"]}')).toMatchObject({
      content: "",
      errors: ["Netch 配置中未找到可转换的服务器条目"],
      applied: [],
    });
    expect(preprocessSubscriptionContent('{"ModeFileNameType":1,"Server":[')).toMatchObject({
      content: "",
      errors: [expect.stringContaining("Unexpected end")],
      applied: [],
    });

    const nested = b64(`ssd://${b64(JSON.stringify({
      port: 8388,
      encryption: "aes-128-gcm",
      password: "pw",
      servers: [{ server: "nested.example.com" }],
    }))}`);
    expect(preprocessSubscriptionContent(nested)).toMatchObject({
      applied: ["base64", "ssd"],
    });
  });

  it("covers additional SS and VLESS parser alias and rejection branches", () => {
    expect(parseSS(`ss://aes-128-gcm:plain%3Apw@plain.example.com:8388?plugin=${encodeURIComponent("v2ray-plugin;path=/a\\;b;tls=1;mux=no;raw\\=key=value")}&uot=&tfo=bad#Plain`)).toMatchObject({
      name: "Plain",
      server: "plain.example.com",
      password: "plain:pw",
      "udp-over-tcp": true,
      plugin: "v2ray-plugin",
      "plugin-opts": {
        path: "/a;b",
        tls: true,
        mux: false,
      },
    });
    expect(parseSS(`ss://${b64("aes-128-gcm:pw@payload.example.com:8388")}?v2ray-plugin=${encodeURIComponent('{"mode":"websocket","tls":1}')}`)).toMatchObject({
      server: "payload.example.com",
    });
    expect(() => parseSS("ss://%%%%")).toThrow("无效的 SS 链接格式");
    expect(() => parseSS(`ss://${b64("aes-128-gcm:pw@payload.example.com")}`)).toThrow("无法解析服务器端口");
    expect(() => parseSS(`ss://${b64("aes-128-gcm@payload.example.com:8388")}`)).toThrow("无法解析加密方式和密码");

    expect(parseVLESS(`vless://${UUID}@tcp-default.example.com:443?type=none&h2=0&allowInsecure=0&tls-verification=true&alpn=,,#TCP`)).toMatchObject({
      name: "TCP",
      port: 443,
      network: "tcp",
    });
    expect(parseVLESS(`vless://${UUID}@direct-flow.example.com:443?flow=xtls-rprx-vision&packetEncoding=xudp&pcs=public-client&pqv=2#DirectFlow`)).toMatchObject({
      flow: "xtls-rprx-vision",
      "packet-encoding": "xudp",
      pcs: "public-client",
      pqv: "2",
    });
    expect(parseVLESS(`vless://${UUID}@front.example.com:443?type=tcp&headerType=http&security=tls&sni=sni.example.com&path=&host=&method=#Front`)).toMatchObject({
      network: "http",
      "http-opts": {
        method: "GET",
        path: ["/"],
        headers: { Host: ["sni.example.com"] },
      },
    });
    expect(parseVLESS(`vless://${UUID}@upgrade.example.com:443?type=httpupgrade&security=tls&path=/up%3Fed%3D256&host=front.example.com#Upgrade`)).toMatchObject({
      network: "ws",
      "ws-opts": {
        path: "/up",
        "max-early-data": 256,
        "v2ray-http-upgrade": true,
      },
    });
    expect(parseVLESS(`vless://${UUID}@grpc.example.com:443?type=grpc&path=/svc&mode=gun&authority=auth.example.com#Grpc`)).toMatchObject({
      network: "grpc",
      "grpc-opts": {
        "grpc-service-name": "svc",
        _grpcType: "gun",
        _grpcAuthority: "auth.example.com",
      },
    });
    expect(parseVLESS(`vless://${UUID}@xhttp-all.example.com:443?type=xhttp&xhttpPath=/x&xhttpHost=front.example.com&xhttpMode=packet-up&xhttpHeaders=${encodeURIComponent("NoColon|X-Empty:|X-Test: yes")}&no_grpc_header=yes&x_padding_bytes=512&sc_max_each_post_bytes=4096&maxConnections=8&cMaxReuseTimes=3&hMaxRequestTimes=4&hMaxReusableSecs=5&downloadPath=/down&downloadHost=down.example.com&downloadHeaders=${encodeURIComponent('{"X-Down":"yes"}')}#XAll`)).toMatchObject({
      network: "xhttp",
      "xhttp-opts": {
        path: "/x",
        host: "front.example.com",
        headers: { "X-Test": "yes" },
        "no-grpc-header": true,
        "x-padding-bytes": "512",
        "sc-max-each-post-bytes": 4096,
        "reuse-settings": {
          "max-connections": "8",
          "c-max-reuse-times": "3",
          "h-max-request-times": "4",
          "h-max-reusable-secs": "5",
        },
        "download-settings": {
          path: "/down",
          host: "down.example.com",
          headers: { "X-Down": "yes" },
        },
      },
    });
    expect(parseVLESS(`vless://${b64url(`prefix:${UUID}@sr-json.example.com:443`)}?obfs=websocket&obfsParam=${encodeURIComponent('{"Host":"json.example.com"}')}&tls=1#SRJson`)).toMatchObject({
      network: "ws",
      "ws-opts": { headers: { Host: "json.example.com" } },
    });
    expect(parseVLESS(`vless://${b64url(`prefix:${UUID}@sr-bad-header.example.com:443`)}?obfs=websocket&obfsParam=${encodeURIComponent('{"bad":1}')}&tls=1#SRBadHeader`)).toMatchObject({
      network: "ws",
      "ws-opts": { path: "/" },
    });
    expect(() => parseVLESS(`vless://${UUID}@bad-port.example.com:70000#BadPort`)).toThrow("无效的端口号");
    expect(() => parseVLESS("vless://missing.example.com:443#Missing")).toThrow("VLESS 配置缺少必要字段");
  });

  it("covers Mihomo proxy sanitizer support, cleanup, and invalid-generation branches", () => {
    expect(isStandardBase64String("YWJjZA==")).toBe(true);
    expect(isStandardBase64String("abc")).toBe(false);
    expect(normalizeMihomoRealityPublicKey(` ${REALITY_PUBLIC_KEY} `)).toBe(REALITY_PUBLIC_KEY);
    expect(normalizeMihomoRealityPublicKey("short")).toBeNull();

    expect(isMihomoSupportedProxyNode(null)).toBe(false);
    expect(isMihomoSupportedProxyNode({ type: "socks4" })).toBe(false);
    expect(isMihomoSupportedProxyNode({ type: "ss", cipher: "aes-128-gcm", password: "pw", plugin: "v2ray-plugin", "plugin-opts": { mode: "http" } })).toBe(false);
    expect(isMihomoSupportedProxyNode({ type: "ssh", server: "ssh.example.com", port: 22 })).toBe(false);
    expect(isMihomoSupportedProxyNode({
      type: "wireguard",
      server: "wg.example.com",
      port: 51820,
      "private-key": "A".repeat(43) + "=",
      "public-key": "bad",
    })).toBe(false);

    expect(sanitizeMihomoProxyNode({
      name: "HTTPS",
      type: "https",
      server: "https.example.com",
      port: 443,
      tls: "maybe",
      alpn: " h2 | http/1.1 ",
      "ws-opts": { path: "/ws?ed=512" },
    })).toMatchObject({
      type: "http",
      tls: true,
      alpn: ["h2", "http/1.1"],
      "ws-opts": {
        path: "/ws",
        "max-early-data": 512,
      },
    });

    expect(sanitizeMihomoProxyNode({
      name: "VMess",
      type: "vmess",
      server: "vmess.example.com",
      port: 443,
      uuid: UUID,
      fingerprint: "sha256:" + "a".repeat(64),
    })).toMatchObject({
      fingerprint: "a".repeat(64),
    });

    expect(sanitizeMihomoProxyNode({
      name: "WG",
      type: "wireguard",
      server: "wg.example.com",
      port: 51820,
      "private-key": "bad",
      "public-key": "A".repeat(43) + "=",
      "pre-shared-key": undefined,
      reserved: "1, 2, 3",
    })).toMatchObject({
      "public-key": "A".repeat(43) + "=",
      reserved: [1, 2, 3],
    });

    const sshSanitized = sanitizeMihomoProxyNode({
      name: "SSH",
      type: "ssh",
      server: "ssh.example.com",
      port: 22,
      "private-key": "bad",
      "private-key-passphrase": "secret",
      "host-key": ["bad", "ssh-ed25519 " + "A".repeat(44) + " comment"],
      "server-fingerprint": "bad",
    });
    expect(sshSanitized).not.toHaveProperty("private-key");
    expect(sshSanitized).not.toHaveProperty("private-key-passphrase");
    expect(sshSanitized["host-key"]).toHaveLength(1);
    expect(sshSanitized).not.toHaveProperty("server-fingerprint");

    expect(normalizeMihomoVlessForGeneration({
      type: "vless",
      uuid: UUID,
      server: "bad-reality.example.com",
      port: 443,
      "reality-opts": { "public-key": "bad" },
    })).toHaveProperty("_subboost-invalid-mihomo-node", true);

    expect(normalizeMihomoVlessForGeneration({
      type: "vless",
      uuid: UUID,
      server: "reality.example.com",
      port: 443,
      tls: false,
      "reality-opts": { "public-key": REALITY_PUBLIC_KEY, "short-id": "bad value" },
      network: "xhttp",
      "xhttp-opts": {
        mode: "packet-up",
        "ech-opts": { enable: "yes", config: "bad" },
        "download-settings": {
          "reality-opts": { "public-key": "" },
        },
      },
    })).toMatchObject({
      tls: true,
      "client-fingerprint": "chrome",
      "reality-opts": { "public-key": REALITY_PUBLIC_KEY },
      "xhttp-opts": {
        "download-settings": {
          "reality-opts": { "public-key": "" },
        },
      },
    });

    expect(normalizeMihomoVlessForGeneration({
      type: "vless",
      uuid: UUID,
      server: "stream-one.example.com",
      port: 443,
      network: "xhttp",
      "xhttp-opts": {
        mode: "stream-one",
        "download-settings": {},
      },
    })).toHaveProperty("_subboost-invalid-mihomo-node", true);

    expect(isMihomoSupportedProxyNode({
      type: "vless",
      uuid: UUID,
      server: "stream-one-supported-check.example.com",
      port: 443,
      network: "xhttp",
      "xhttp-opts": {
        mode: "stream-one",
        "download-settings": { path: "/download" },
      },
    })).toBe(false);

    const emptyContainers = sanitizeMihomoProxyNode({
      name: "Empty Containers",
      type: "vless",
      server: "empty.example.com",
      port: 443,
      uuid: UUID,
      alpn: ",",
      fingerprint: " ",
      encryption: "",
      "ech-opts": "bad",
      "ws-opts": {},
    });
    expect(emptyContainers).toMatchObject({
      type: "vless",
      server: "empty.example.com",
    });
    expect(emptyContainers).not.toHaveProperty("alpn");
    expect(emptyContainers).not.toHaveProperty("fingerprint");
    expect(emptyContainers).not.toHaveProperty("encryption");
    expect(emptyContainers).not.toHaveProperty("ech-opts");
    expect(emptyContainers).not.toHaveProperty("ws-opts");

    expect(sanitizeMihomoProxyNode({
      name: "None Encryption",
      type: "vless",
      server: "none.example.com",
      port: 443,
      uuid: UUID,
      encryption: "none",
    })).toHaveProperty("encryption", "none");

    const wgReservedFallback = sanitizeMihomoProxyNode({
      name: "WG Reserved Fallback",
      type: "wireguard",
      server: "wg.example.com",
      port: 51820,
      "private-key": "A".repeat(43) + "=",
      reserved: "1,2",
    });
    expect(wgReservedFallback).not.toHaveProperty("reserved");

    expect(normalizeMihomoVlessForGeneration({
      name: "Download Reality Non Object",
      type: "vless",
      uuid: UUID,
      server: "download-reality.example.com",
      port: 443,
      network: "xhttp",
      "xhttp-opts": {
        "download-settings": {
          "reality-opts": "bad",
        },
      },
    })).toHaveProperty("_subboost-invalid-mihomo-node", true);

    expect(normalizeMihomoVlessForGeneration({
      name: "Download Reality Missing Key",
      type: "vless",
      uuid: UUID,
      server: "download-missing.example.com",
      port: 443,
      network: "xhttp",
      "xhttp-opts": {
        "download-settings": {
          "reality-opts": {},
        },
      },
    })).toHaveProperty("_subboost-invalid-mihomo-node", true);
  });

  it("covers additional parser fallbacks through real protocol inputs", () => {
    expect(looksLikeConfigLine(" # comment = http,example.com,80")).toBe(false);
    expect(() => tokenizeConfigLine("=http,example.com,80")).toThrow("无效的配置行格式");
    expect(() => tokenizeConfigLine("Name=http,example.com")).toThrow("配置行缺少类型/地址/端口");
    expect(() => tokenizeConfigLine("Name=http,example.com,70000")).toThrow("配置行中的地址或端口无效");
    expect(tokenizeConfigLine("'Quoted Name'=http,'quoted.example.com',80,allow_insecure=yes,allow-insecure=no")).toMatchObject({
      name: "Quoted Name",
      host: "quoted.example.com",
      params: {
        allow_insecure: "yes",
        "allow-insecure": "no",
      },
    });

    expect(parseConfigLine("Socks TLS=socks5-tls,socks.example.com,1080,username=u,password=p")).toMatchObject({
      type: "socks5",
      tls: true,
    });
    expect(parseConfigLine("Snell=snell,snell.example.com,443,password=psk,version=3,obfs=http,obfs-host=front,obfs-uri=/o,udp-relay=off")).toMatchObject({
      type: "snell",
      version: 3,
      udp: false,
      "obfs-opts": { mode: "http", host: "front", path: "/o" },
    });
    expect(parseConfigLine("Hy=hysteria,hy.example.com,443,auth,protocol=wechat-video,peer=hy-sni,alpn=h3,h2,up=10,downmbps=20,ports=1000-2000,obfs-param=seed,obfs=ignored")).toMatchObject({
      type: "hysteria",
      protocol: "wechat-video",
      sni: "hy-sni",
      alpn: ["h3"],
      up: "10",
      down: "20",
      ports: "1000-2000",
      obfs: "seed",
      _obfs: "ignored",
    });
    expect(parseConfigLine(`Tuic Cred=tuic,tuic.example.com,443,uuid=${UUID},password=p,disable-sni=yes,allow-insecure=no`)).toMatchObject({
      type: "tuic",
      uuid: UUID,
      password: "p",
      "disable-sni": true,
    });
    expect(parseConfigLine("Tuic5=tuic-v5,tuic5.example.com,443,token=tok,congestioncontrol=bbr,udprelaymode=quic")).toMatchObject({
      type: "tuic",
      version: 5,
      token: "tok",
      "congestion-controller": "bbr",
      "udp-relay-mode": "quic",
    });
    expect(parseConfigLine("WG Minimal=wireguard,wg.example.com,51820,privatekey=priv,publickey=pub,presharedkey=pre,interface-ip=10.0.0.2,interface-ipv6=fd00::2,udp=off,mtu=1280")).toMatchObject({
      type: "wireguard",
      udp: false,
      mtu: 1280,
      ip: "10.0.0.2",
      ipv6: "fd00::2",
    });
    expect(() => parseConfigLine("AnyTLS Bad=anytls,anytls.example.com,443,password=p,transport=ws")).toThrow("anytls 配置行不支持 transport=ws");
    expect(() => parseConfigLine("AnyTLS Reality=anytls,anytls.example.com,443,password=p,public-key=pub")).toThrow("anytls 配置行不支持 Reality");
    expect(() => parseConfigLine("Tuic Missing=tuic,tuic.example.com,443")).toThrow("tuic 配置行缺少 token");
    expect(() => parseConfigLine("WG Missing=wireguard,wg.example.com,51820")).toThrow("wireguard 配置行缺少 private-key");
    expect(() => parseConfigLine("Unknown=unknown,example.com,80")).toThrow("不支持的配置行协议");

    expect(() => parseVMess("vmess://missing-query")).toThrow("无效的 VMess JSON 格式");
    expect(() => parseVMess(`vmess://${b64("bad-basic")}?remarks=Bad`)).toThrow("VMess 配置缺少必要字段");
    expect(() => parseVMess(`vmess://bad:${UUID}-0@bad.example.com:443`)).toThrow("不支持的 VMess 传输层");
    expect(parseVMess(`vmess://${b64(`auto:${UUID}@fallback-name.example.com:443`)}?obfs=websocket`)).toMatchObject({
      name: "VMess fallback-name.example.com:443",
      network: "ws",
    });
    expect(() =>
      parseVMess(`vmess://quic+tls:${UUID}-0@quic.example.com:443?type=none&security=aes-128-gcm&key=secret&sni=front.example.com#Quic`)
    ).toThrow("不支持的 VMess 传输层");
    expect(parseVMess(`vmess1://${UUID}@kit-ech.example.com:443?tls=1&ech=a2l0LWNvbmZpZw%3D%3D#KitECH`)).toMatchObject({
      name: "KitECH",
      "ech-opts": { enable: true, config: "a2l0LWNvbmZpZw==" },
    });
    expect(parseVMess(`vmess://${b64(` = vmess, quantum-name.example.com, 443, auto, ${UUID}, obfs=http, tls-verification=false`)}`)).toMatchObject({
      name: "VMess 节点",
      network: "http",
      "skip-cert-verify": true,
    });
    expect(parseVMess(`vmess://${UUID}@uri-id.example.com:443?id=${UUID}&type=none&security=tls&remark=Remark`)).toMatchObject({
      name: "Remark",
      network: "tcp",
      tls: true,
    });
    expect(parseVMess(`vmess://${UUID}@ws-empty.example.com:443?type=ws&security=tls#WsEmpty`)).toMatchObject({
      name: "WsEmpty",
      network: "ws",
    });

    expect(parseHttp("http://user@http-user.example.com?skip-cert-verify=off&headers=%7B%22Bad%22%3A1%7D")).toMatchObject({
      username: "user",
      "skip-cert-verify": false,
    });
    expect(parseHttp("http://encoded.example.com:8080:u%3Aser:p%40ss")).toMatchObject({
      username: "u:ser",
      password: "p@ss",
    });
    expect(parseSimpleProxy("useronly@naked-auth.example.com", "http")).toMatchObject({
      username: "useronly",
      port: 80,
    });
    expect(parseSocks(`socks5://${b64("decoded:auth")}@socks-auth.example.com:1080`)).toMatchObject({
      username: "decoded",
      password: "auth",
    });
    expect(() => parseHttp("http://:80")).toThrow("缺少服务器地址");
    expect(() => parseSimpleProxy("missing-port.example.com", "http")).toThrow("无效的代理格式");
    expect(() => parseTelegramProxyLink("https://example.com/socks?server=x&port=1")).toThrow("无效的 Telegram 代理链接");
    expect(() => parseTelegramProxyLink("https://t.me/http?server=tg.example.com&port=")).toThrow("无效的端口号");

    expect(parseVLESS(`vless://${UUID}@vless-bool.example.com:443?allow_insecure=yes&pcs=one&pqv=two&alpn=h3,h2#Bool`)).toMatchObject({
      "skip-cert-verify": true,
      pcs: "one",
      pqv: "two",
      alpn: ["h3", "h2"],
    });
    expect(parseVLESS(`vless://${UUID}@vless-domain.example.com:443?type=h2&security=tls&sni=front.example.com#Domain`)).toMatchObject({
      network: "h2",
      "h2-opts": { host: ["front.example.com"], path: "/" },
    });
    expect(parseVLESS(`vless://${b64url(`prefix:${UUID}@sr-plain.example.com:443`)}?obfs=websocket&obfsParam=plain.example.com&tls=1#SRPlain`)).toMatchObject({
      network: "ws",
      "ws-opts": { headers: { Host: "plain.example.com" } },
    });
    expect(parseVLESS(`vless://${UUID}@local.subboost.test:443?type=xhttp&xhttp-headers=&download-headers=#XEmpty`)).toMatchObject({
      network: "xhttp",
      "xhttp-opts": { path: "/" },
    });

    expect(preprocessSubscriptionContent("")).toEqual({ content: "", errors: [], applied: [] });
    expect(preprocessSubscriptionContent("not base64 !!!")).toEqual({ content: "not base64 !!!", errors: [], applied: [] });
    expect(preprocessSubscriptionContent(`ssd://${b64(JSON.stringify({
      port: 8388,
      encryption: "aes-128-gcm",
      password: "pw",
      servers: [{ server: "fallback-tag.example.com" }],
    }))}`)).toMatchObject({
      applied: ["ssd"],
      content: expect.stringContaining("SSD-1"),
    });
    expect(preprocessSubscriptionContent('{"Server":["{\\"Type\\":\\"http\\",\\"Hostname\\":\\"string.example.com\\",\\"Port\\":80}"]}')).toMatchObject({
      applied: ["netch-json"],
      content: expect.stringContaining("netch://"),
    });
    expect(preprocessSubscriptionContent("[WireGuard Office]\nprivate-key = priv\npeer = (endpoint = wg.example.com:51820)\n[Rule]\nFINAL,DIRECT")).toMatchObject({
      applied: ["full-config"],
      content: expect.stringContaining("[WireGuard Office]"),
    });
    expect(preprocessSubscriptionContent("[Proxy]\n   \n")).toMatchObject({
      content: "[Proxy]",
      errors: [],
      applied: [],
    });
  });
});
