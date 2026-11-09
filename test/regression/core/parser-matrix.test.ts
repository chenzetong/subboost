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
  it("covers tokenizer helpers and shared transport branches", () => {
    expect(parseBooleanish(" off ")).toBe(false);
    expect(parseBooleanish("")).toBeUndefined();
    expect(parseStringList(" a, ,b | c ")).toEqual(["a", "b | c"]);
    expect(parseStringList(" ")).toBeUndefined();
    expect(parseWsHeaders("Host: example.com| |X-Empty:")).toEqual({ Host: "example.com" });
    expect(parseWsHeaders("bad-json:")).toBeUndefined();
    expect(parseIntParam("12")).toBe(12);
    expect(parseIntParam("bad")).toBeUndefined();
    expect(isUuidLike(UUID)).toBe(true);
    expect(isUuidLike("")).toBe(false);
    expect(tokenizeConfigLine("Node=http,example.com,80,=ignored,host=example.com,flag")).toEqual({
      name: "Node",
      type: "http",
      host: "example.com",
      port: 80,
      params: { host: "example.com" },
      extras: ["flag"],
    });

    const common: Record<string, unknown> = {};
    applyCommonNodeParams(common, {
      "tls-cert-sha256": "cert",
      "tls-pubkey-sha256": "pub",
      "shadow-tls-version": "3",
      "shadow-tls-sni": "shadow.example.com",
      "skip-cert-verify": "false",
    });
    expect(common).toMatchObject({
      "tls-cert-sha256": "cert",
      "tls-pubkey-sha256": "pub",
      "shadow-tls-version": 3,
      "shadow-tls-sni": "shadow.example.com",
      "skip-cert-verify": false,
    });

    const wsNode: Record<string, unknown> = {};
    applyTransport(wsNode, {
      transport: "ws",
      host: "cdn.example.com",
      "ws-headers": "Edge: pop",
      path: "/ws",
    });
    expect(wsNode).toMatchObject({
      network: "ws",
      "ws-opts": { path: "/ws", headers: { Edge: "pop", Host: "cdn.example.com" } },
    });

    const grpcNode: Record<string, unknown> = {};
    applyTransport(grpcNode, { transport: "grpc", "service-name": "/svc", mode: "gun", authority: "auth.example.com" });
    expect(grpcNode).toMatchObject({
      network: "grpc",
      "grpc-opts": { "grpc-service-name": "svc", _grpcType: "gun", _grpcAuthority: "auth.example.com" },
    });

    const httpNode: Record<string, unknown> = {};
    applyTransport(httpNode, { transport: "http", method: "", path: "", host: "a.example.com,b.example.com" });
    expect(httpNode).toMatchObject({
      network: "http",
      "http-opts": { method: "GET", path: ["/"], headers: { Host: ["a.example.com", "b.example.com"] } },
    });

    const xhttpNode: Record<string, unknown> = {};
    applyTransport(xhttpNode, { transport: "xhttp", host: "front.example.com", path: "/x", mode: "packet-up" }, {
      allowedTransports: ["tcp", "xhttp"],
      protocolName: "测试",
    });
    expect(xhttpNode).toMatchObject({ network: "xhttp", "xhttp-opts": { path: "/x", host: "front.example.com", mode: "packet-up" } });
    expect(() => applyTransport({}, { transport: "bad" }, { protocolName: "测试" })).toThrow("不支持的 测试 传输层");
  });

  it("covers vmess utility fallback branches", () => {
    expect(normalizeHttpMethod("")).toBe("GET");
    expect(normalizeHttpMethod("post")).toBe("POST");
    expect(parseHeaderRecord({ "": "ignored", "x-list": [" a ", "", "b"], "x-num": 1 })).toEqual({
      "x-list": ["a", "b"],
      "x-num": ["1"],
    });
    expect(parseHeaderRecord({ bad: [] })).toBeUndefined();
    expect(splitList(" a,,b|c ")).toEqual(["a", "b|c"]);
    expect(splitList(" ")).toBeUndefined();
    expect(parseVmessBooleanish(0)).toBe(false);
    expect(parseVmessBooleanish(1)).toBe(true);
    expect(parseVmessBooleanish(2)).toBeUndefined();
    expect(parseVmessBooleanish("")).toBeUndefined();
    expect(parseObfsHeaderHost("type=http;Host: front.example.com")).toBe("front.example.com");
  });

  it("covers simple proxy URL, naked, Telegram, and SSH option branches", () => {
    const base64Authority = b64("proxy-user:proxy-pass@b64.example.com:8080");
    expect(parseHttp(`http://${base64Authority}?remarks=Base64&headers=Host: edge.example.com|X-Test: yes`)).toMatchObject({
      name: "Base64",
      username: "proxy-user",
      password: "proxy-pass",
      headers: { Host: "edge.example.com", "X-Test": "yes" },
    });
    expect(parseHttp("http://colon.example.com:8080:user:pass#Colon")).toMatchObject({
      name: "Colon",
      username: "user",
      password: "pass",
    });
    expect(parseSocks(`socks5+tls://user:pass@socks.example.com:1081?udp=no&tls-verification=false`)).toMatchObject({
      tls: true,
      udp: false,
      "skip-cert-verify": true,
    });
    expect(parseSsh("ssh://root@ssh.example.com?private-key=key&host-key=ed25519,rsa&host-key-algorithms=a,b&server-fingerprint=sha256&idle-timeout=30")).toMatchObject({
      username: "root",
      "private-key": "key",
      "host-key": ["ed25519", "rsa"],
      "host-key-algorithms": ["a", "b"],
      "idle-timeout": 30,
    });
    expect(() => parseSimpleProxy("[2001:db8::1]:bad", "http")).toThrow("无效的端口号");
    expect(() => parseSocks("http://not-socks.example.com:80")).toThrow("无效的 SOCKS 链接");
    expect(parseTelegramProxyLink("https://t.me/socks?server=tg.example.com&port=1080&user=u&pass=p&remark=TG")).toMatchObject({
      name: "TG",
      username: "u",
      password: "p",
    });
    expect(parseTelegramProxyLink("tg://https?server=https.example.com&port=443")).toMatchObject({
      type: "https",
      tls: true,
    });
    expect(() => parseTelegramProxyLink("tg://bad?server=x&port=1")).toThrow("无效的 Telegram 代理链接");
  });

  it("covers Netch protocol variants and optional fields", () => {
    expect(parseNetch(netch({
      Type: "ss",
      Hostname: "ss.example.com",
      Port: "8388",
      Password: "pw",
      Plugin: "v2ray-plugin",
      PluginOption: "mode=websocket;tls",
      EnableUDP: "0",
      EnableTFO: "1",
    }))).toMatchObject({
      type: "ss",
      udp: false,
      tfo: true,
      plugin: "v2ray-plugin",
      "plugin-opts": { mode: "websocket", tls: true },
    });

    expect(parseNetch(netch({
      Type: "ssr",
      Hostname: "ssr.example.com",
      Port: 8388,
      Password: "pw",
      Protocol: "auth_aes128_md5",
      ProtocolParam: "param",
      OBFS: "tls1.2_ticket_auth",
      OBFSParam: "front.example.com",
    }))).toMatchObject({ type: "ssr", "protocol-param": "param", "obfs-param": "front.example.com" });

    expect(parseNetch(netch({
      Type: "vmess",
      Hostname: "vmess.example.com",
      Port: 443,
      UserID: UUID,
      TransferProtocol: "ws",
      Host: "cdn.example.com",
      Edge: "edge",
      TLSSecure: true,
      AllowInsecure: 1,
    }))).toMatchObject({
      type: "vmess",
      network: "ws",
      "skip-cert-verify": true,
      "ws-opts": { headers: { Host: "cdn.example.com", Edge: "edge" } },
    });

    expect(parseNetch(netch({
      Type: "vmess",
      Hostname: "vmess-h2.example.com",
      Port: 443,
      UserID: UUID,
      TransferProtocol: "h2",
      Host: "h2.example.com",
      Path: "/h2",
    }))).toMatchObject({ network: "h2", "h2-opts": { host: ["h2.example.com"], path: "/h2" } });

    expect(parseNetch(netch({
      Type: "vmess",
      Hostname: "vmess-http.example.com",
      Port: 443,
      UserID: UUID,
      TransferProtocol: "tcp",
      FakeType: "http",
      Host: "a.example.com,b.example.com",
      Path: "/a,/b",
    }))).toMatchObject({ network: "http" });

    expect(parseNetch(netch({
      Type: "trojan",
      Hostname: "trojan.example.com",
      Port: 443,
      Password: "pw",
      TransferProtocol: "httpupgrade",
      Host: "front.example.com",
      AllowInsecure: true,
    }))).toMatchObject({ type: "trojan", network: "ws", "skip-cert-verify": true });

    expect(parseNetch(netch({
      Type: "snell",
      Hostname: "snell.example.com",
      Port: 443,
      Password: "psk",
      SnellVersion: 3,
      OBFS: "tls",
      Host: "front.example.com",
    }))).toMatchObject({ type: "snell", "obfs-opts": { mode: "tls", host: "front.example.com" } });

    expect(parseNetch(netch({ Type: "socks", Hostname: "socks.example.com", Port: 1080, Username: "u", Password: "p" }))).toMatchObject({
      type: "socks5",
      username: "u",
      password: "p",
    });
    expect(parseNetch(netch({ Type: "https", Hostname: "http.example.com", Port: 443, Username: "u" }))).toMatchObject({
      type: "https",
      tls: true,
      username: "u",
    });
    expect(() => parseNetch(netch({ Type: "trojan", Hostname: "x", Port: 443, Password: "p", TLSSecure: false }))).toThrow("必须启用 TLS");
  });

  it("covers config-line parser and subscription preprocessors", () => {
    expect(parseConfigLine("http=HTTP,example.com,8080,username=u,password=p,tls=yes,obfs=http,obfs-host=front,obfs-uri=/o")).toMatchObject({
      type: "http",
      username: "u",
    });
    expect(parseConfigLine(`Hy2=hysteria2,hy.example.com,443,password=p,obfs=salamander,obfs-param=seed,auth-str=auth,sni=sni.example.com,mport=1000-2000`)).toMatchObject({
      type: "hysteria2",
      sni: "sni.example.com",
    });
    expect(parseConfigLine(`tuic=Tuic,tuic.example.com,443,${UUID},password,congestion-controller=bbr,udp-relay-mode=native,sni=sni.example.com`)).toMatchObject({
      type: "tuic",
      "congestion-controller": "bbr",
      "udp-relay-mode": "native",
    });
    expect(parseConfigLine("WG=wireguard,wg.example.com,51820,private-key=priv,public-key=pub,pre-shared-key=pre,ip=10.0.0.2,ipv6=fd00::2")).toMatchObject({
      type: "wireguard",
      "pre-shared-key": "pre",
    });
    expect(() => parseConfigLine("bad line")).toThrow("无效的配置行格式");

    expect(preprocessSubscriptionContent("<html><head></head><body>blocked</body></html>")).toEqual({
      content: "",
      errors: ["检测到 HTML 页面内容，疑似错误页或拦截页，已停止解析"],
      applied: [],
    });
    expect(preprocessSubscriptionContent(b64("ss://node"))).toMatchObject({ content: "ss://node", applied: ["base64"] });
    const ssd = `ssd://${b64(JSON.stringify({
      airport: "Airport",
      port: 8388,
      encryption: "aes-128-gcm",
      password: "pw",
      servers: { a: { server: "ssd.example.com", remarks: "SSD A", plugin: "v2ray-plugin", plugin_options: "tls;host=a" } },
    }))}`;
    expect(preprocessSubscriptionContent(ssd)).toMatchObject({ applied: ["ssd"] });
    expect(preprocessSubscriptionContent('{"ModeFileNameType":1,"Server":["not-json",{"Type":"http","Hostname":"h.example.com","Port":80}]}')).toMatchObject({
      applied: ["netch-json"],
    });
    expect(preprocessSubscriptionContent("[General]\nfoo=bar")).toMatchObject({
      content: "[General]\nfoo=bar",
      applied: [],
    });
    expect(preprocessSubscriptionContent("[Proxy]\nNode = http, example.com, 80\n[Rule]\nFINAL,Node")).toMatchObject({
      applied: ["full-config"],
      content: "[Proxy]\nNode = http, example.com, 80",
    });
  });

  it("covers additional VMess and VLESS transport branches", () => {
    expect(parseVMess(`vmess://${UUID}@uri-ws.example.com:443?type=websocket&path=/ws?ed=2048&host=a.example.com,b.example.com&edge=edge&ua=agent#WS`)).toMatchObject({
      network: "ws",
      "ws-opts": {
        path: "/ws",
        "max-early-data": 2048,
        headers: { Host: "a.example.com", Edge: "edge" },
      },
    });
    expect(parseVMess(`vmess://${UUID}@uri-http.example.com:443?type=http&path=/a,/b&host=h1,h2#HTTP`)).toMatchObject({
      network: "http",
      "http-opts": { path: ["/a", "/b"], headers: { Host: ["h1", "h2"] } },
    });
    expect(() => parseVMess(`vmess://${UUID}@bad.example.com:443?type=bad#Bad`)).toThrow("不支持的 VMess 传输层");

    expect(parseVLESS(`vless://${UUID}@ws.example.com:443?type=ws&path=/ws?ed=1024&host=front.example.com#WS`)).toMatchObject({
      network: "ws",
      "ws-opts": { path: "/ws", headers: { Host: "front.example.com" } },
    });
    expect(parseVLESS(`vless://${UUID}@h2.example.com:443?type=h2&path=/h2&sni=front.example.com&security=tls#H2`)).toMatchObject({
      network: "h2",
      "h2-opts": { host: ["front.example.com"], path: "/h2" },
    });
    expect(parseVLESS(`vless://${UUID}@xhttp.example.com:443?type=xhttp&xhttp-path=/x&xhttp-host=front.example.com&mode=packet-up#XHTTP`)).toMatchObject({
      network: "xhttp",
      "xhttp-opts": { path: "/x", host: "front.example.com", mode: "packet-up" },
    });
    expect(() => parseVLESS(`vless://${UUID}@bad.example.com:443?type=bad#Bad`)).toThrow("不支持的 VLESS 传输层");
  });

  it("covers extra parser alias, fallback, and rejection edges", () => {
    expect(parseVMess(`vmess://${b64(`auto:${UUID}@sr.example.com:443`)}?remarks=SR&obfs=websocket&tls=1&host=front.example.com&ech=`)).toMatchObject({
      name: "SR",
      network: "ws",
      tls: true,
      "ech-opts": { enable: true },
      "ws-opts": { path: "/", headers: { Host: "front.example.com" } },
    });

    expect(parseVMess(`vmess://${b64("Quantum = vmess, quantum.example.com, 443, auto, " + UUID + ", obfs=wss, obfs-header=Host: front.example.com, obfs-path=/q, tls-verification=false")}`)).toMatchObject({
      name: "Quantum",
      network: "ws",
      "skip-cert-verify": true,
      "ws-opts": { path: "/q", headers: { Host: "front.example.com" } },
    });

    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "DingTalk HTTP",
      add: "dt.example.com",
      port: 443,
      id: UUID,
      net: "tcp",
      type: "http",
      host: "dingtalk.com",
      path: "/a,/b",
      method: "m-search",
      headers: { Edge: "pop" },
      tls: "tls",
      alpn: "h2,http/1.1",
      authenticatedLength: "0",
      globalPadding: "1",
      packetEncoding: "xudp",
    }))}`)).toMatchObject({
      name: "DingTalk HTTP",
      network: "http",
      "packet-encoding": "xudp",
      "authenticated-length": false,
      "global-padding": true,
      alpn: ["h2", "http/1.1"],
      "http-opts": {
        method: "M-SEARCH",
        path: ["/a", "/b"],
        headers: expect.objectContaining({ Edge: ["pop"], "User-Agent": [expect.stringContaining("DingTalk")] }),
      },
    });
    expect(() => parseVMess(`vmess://${b64(JSON.stringify({ add: "ech.example.com", port: 80, id: UUID, net: "tcp", ech: "cfg" }))}`)).toThrow("VMess 启用 ECH 需要 TLS");

    expect(parseVLESS(`vless://${UUID}@xhttp.example.com:443?type=xhttp&xhttp_path=/x&xhttp_host=front.example.com&xhttp_mode=packet-up&xhttp_headers=${encodeURIComponent('{"X-Test":"yes"}')}&noGrpcHeader=off&xPaddingBytes=1024&scMaxEachPostBytes=2048&maxConcurrency=4&downloadPath=/download&downloadHost=download.example.com&downloadHeaders=X-Down: yes#XHTTP`)).toMatchObject({
      name: "XHTTP",
      network: "xhttp",
      "xhttp-opts": {
        path: "/x",
        host: "front.example.com",
        mode: "packet-up",
        headers: { "X-Test": "yes" },
        "no-grpc-header": false,
        "x-padding-bytes": "1024",
        "sc-max-each-post-bytes": 2048,
        "reuse-settings": { "max-concurrency": "4" },
        "download-settings": {
          path: "/download",
          host: "download.example.com",
          headers: { "X-Down": "yes" },
        },
      },
    });
    expect(parseVLESS(`vless://${UUID}@h2-bool.example.com:443?h2=1&sni=front.example.com&security=tls#H2Bool`)).toMatchObject({
      network: "h2",
      "h2-opts": { host: ["front.example.com"], path: "/" },
    });
    expect(parseVLESS(`vless://${UUID}@http.example.com:80?type=tcp&headerType=http&path=&method=&host=#HTTP`)).toMatchObject({
      network: "http",
      "http-opts": { method: "GET", path: ["/"] },
    });
    expect(() => parseVLESS(`vless://${UUID}@ech.example.com:443?security=reality&ech=cfg`)).toThrow("VLESS 启用 ECH 需要 security=tls");

    expect(parseNetch(netch({ Type: "ss", Hostname: "ss-no-plugin.example.com", Port: 8388, Password: "pw", PluginOption: ";" }))).toMatchObject({
      type: "ss",
    });
    expect(parseNetch(netch({ Type: "ssr", Hostname: "ssr-default.example.com", Port: 8388, Password: "pw" }))).toMatchObject({
      type: "ssr",
      protocol: "origin",
      obfs: "plain",
    });
    expect(parseNetch(netch({ Type: "vmess", Hostname: "grpc.example.com", Port: 443, UserID: UUID, TransferProtocol: "grpc", Path: "/svc" }))).toMatchObject({
      network: "grpc",
      "grpc-opts": { "grpc-service-name": "svc" },
    });
    expect(() => parseNetch(netch({ Type: "vmess", Hostname: "bad.example.com", Port: 443, UserID: UUID, TransferProtocol: "quic" }))).toThrow("不支持的 Netch VMess");
    expect(parseNetch(netch({ Type: "trojan", Hostname: "trojan-grpc.example.com", Port: 443, Password: "pw", TransferProtocol: "grpc", Path: "/svc" }))).toMatchObject({
      network: "grpc",
      "grpc-opts": { "grpc-service-name": "svc" },
    });
    expect(parseNetch(netch({ Type: "snell", Hostname: "snell-plain.example.com", Port: 443, Password: "psk" }))).toMatchObject({
      type: "snell",
    });
    expect(parseNetch(netch({ Type: "socks", Hostname: "socks-empty.example.com", Port: 1080 }))).toMatchObject({
      type: "socks5",
    });
    expect(parseNetch(netch({ Type: "http", Hostname: "http-auth.example.com", Port: 8080, Username: "u", Password: "p" }))).toMatchObject({
      type: "http",
      username: "u",
      password: "p",
    });

    expect(parseHttp(`http://${b64("b64-no-auth.example.com:8080")}?remarks=QueryName`)).toMatchObject({
      name: "QueryName",
      server: "b64-no-auth.example.com",
    });
    expect(parseHttp("http://headers.example.com?headers=NoColon|X-Empty:&allow-insecure=maybe")).toMatchObject({
      name: "HTTP-headers.example.com:80",
    });
    expect(parseSocks("socks4://user@socks4.example.com")).toMatchObject({
      name: "SOCKS-socks4.example.com:1080",
      type: "socks4",
      username: "user",
    });
    expect(() => parseTelegramProxyLink("tg://socks?port=1080")).toThrow("缺少服务器地址");
    expect(() => parseTelegramProxyLink("tg://socks?server=tg.example.com&port=bad")).toThrow("无效的端口号");
  });

  it("covers SS, SSR, and platform parser edge branches", () => {
    expect(normalizeSsPlugin(undefined, undefined)).toEqual({ plugin: undefined, pluginOpts: undefined });
    expect(normalizeSsPlugin("custom-plugin", { raw: true })).toEqual({
      plugin: "custom-plugin",
      pluginOpts: { raw: true },
    });
    expect(normalizeSsPlugin("v2ray-plugin", undefined)).toEqual({
      plugin: "v2ray-plugin",
      pluginOpts: undefined,
    });
    expect(normalizeSsPlugin("gost-plugin", { tls: 0, mux: "yes", untouched: 2 })).toEqual({
      plugin: "gost-plugin",
      pluginOpts: { tls: false, mux: true, untouched: 2 },
    });
    expect(normalizeSsPlugin("simple-obfs", { obfs: "http", "obfs-host": "front.example.com" })).toEqual({
      plugin: "obfs",
      pluginOpts: { mode: "http", host: "front.example.com" },
    });

    const ssUserInfo = b64("aes-128-gcm:pw");
    expect(parseSS(`ss://${ssUserInfo}@[2001:db8::1]:8388?uot=&tfo=1#IPv6`)).toMatchObject({
      name: "IPv6",
      server: "2001:db8::1",
      "udp-over-tcp": true,
      tfo: true,
    });
    expect(parseSS(`ss://${ssUserInfo}@plugin.example.com:8388?v2ray-plugin=${encodeURIComponent(b64(JSON.stringify({ tls: "1", mode: "websocket" })))}`)).toMatchObject({
      plugin: "v2ray-plugin",
      "plugin-opts": { tls: true, mode: "websocket" },
    });
    expect(() => parseSS(`ss://${b64("missing-colon")}@ss.example.com:8388`)).toThrow("无法解析加密方式和密码");
    expect(() => parseSS(`ss://${b64("aes-128-gcm:pw")}`)).toThrow("无效的 SS 链接格式");
    expect(() => parseSS(`ss://${b64("aes-128-gcm:pw@ss.example.com")}`)).toThrow("无法解析服务器端口");

    expect(() => parseSSR("http://bad")).toThrow("无效的 SSR 链接");
    expect(() => parseSSR("ssr://")).toThrow("无效的 SSR 链接");
    expect(() => parseSSR("ssr://bad")).toThrow("无效的 SSR 链接格式");
    expect(() => parseSSR(`ssr://${b64("too:few")}`)).toThrow("无效的 SSR 链接格式");
    expect(() => parseSSR(`ssr://${b64(`:8388:origin:aes-256-cfb:plain:${b64("pw")}`)}`)).toThrow("缺少服务器地址");
    expect(() => parseSSR(`ssr://${b64(`ssr.example.com:0:origin:aes-256-cfb:plain:${b64("pw")}`)}`)).toThrow("无效的端口号");
    expect(parseSSR(`ssr://${b64(`[2001:db8::2]:8388:auth_aes128_md5:aes-256-cfb:tls1.2_ticket_auth:${b64("pw")}/?remarks=${b64("Plain Remark")}&flag&protoparam=${b64("proto")}&obfsparam=${b64("front.example.com")}`)}`)).toMatchObject({
      name: "Plain Remark",
      server: "2001:db8::2",
      "protocol-param": "proto",
      "obfs-param": "front.example.com",
    });

    expect(() =>
      parsePlatformProxyLine("No Endpoint WG = wireguard, section-name=Office", {
        sections: new Map([["WireGuard Office", ["peer = (public-key = public)"]]]),
      })
    ).toThrow("缺少有效 endpoint");
    expect(() =>
      parsePlatformProxyLine("No Section Name WG = wireguard, private-key=private")
    ).toThrow("Surge WireGuard 缺少 section-name");
    expect(parsePlatformProxyLine("AnyTLS Security = anytls, anytls.example.com, 443, password=secret, security=reality")).toMatchObject({
      name: "AnyTLS Security",
      type: "anytls",
      server: "anytls.example.com",
    });
    expect(parsePlatformProxyLine("AnyTLS Servername = anytls, anytls.example.com, 443, password=secret, tls-name=front.example.com")).toMatchObject({
      type: "anytls",
      server: "anytls.example.com",
    });
    expect(parsePlatformProxyLine("SSH FP = ssh, ssh.example.com, 22, username=root, tls-fingerprint=sha256:abc")).toMatchObject({
      type: "ssh",
      server: "ssh.example.com",
    });
  });

  it("covers additional platform, simple proxy, VMess, and VLESS fallback branches", () => {
    expect(
      parsePlatformProxyLine(
        "Surge VMess = vmess, vmess.example.com, 443, username=11111111-1111-4111-8111-111111111111, vmess-aead=true, ws=true, ws-path=/ws?ed=2048, ws-headers=Host:cdn.example.com|User-Agent:UA, tls=true, sni=v.example.com, server-cert-fingerprint-sha256=fp, skip-cert-verify=true, udp-relay=true, port-hopping=1000-1002;2000"
      )
    ).toMatchObject({
      name: "Surge VMess",
      type: "vmess",
      network: "ws",
      ports: "1000-1002,2000",
      "ws-opts": {
        path: "/ws",
        "max-early-data": 2048,
      },
    });

    expect(
      parsePlatformProxyLine('WG Endpoint Only = wireguard, peers=[{endpoint="wg-only.example.com:51820"}]')
    ).toMatchObject({
      name: "WG Endpoint Only",
      type: "wireguard",
      server: "wg-only.example.com",
      port: 51820,
    });

    expect(parsePlatformProxyLine("Direct = direct, example.com, 443")).toBeNull();
    expect(() =>
      parsePlatformProxyLine('AnyTLS WS = anytls, anytls.example.com, 443, "secret", transport=ws')
    ).toThrow("AnyTLS 平台配置不支持 network=ws");

    expect(parseSimpleProxy("naked.example.com:8080[refresh-url]{Named}", "http")).toMatchObject({
      name: "Named",
      server: "naked.example.com",
      port: 8080,
    });
    expect(parseSimpleProxy("naked.example.com:8080:user:p%40ss:tail", "http")).toMatchObject({
      username: "user",
      password: "p%40ss:tail",
    });
    expect(parseHttp(`http://${b64("\u0000bad")}?remarks=RawToken`)).toMatchObject({
      name: `HTTP-${b64("\u0000bad")}:80`,
    });
    expect(parseHttp(`http://${b64("decoded-without-port")}?remarks=NoPort`)).toMatchObject({
      name: `HTTP-${b64("decoded-without-port")}:80`,
    });
    expect(parseSocks("socks://useronly@socks.example.com?udp-relay=yes&tls_name=socks-sni.example.com")).toMatchObject({
      username: "useronly",
      udp: true,
      sni: "socks-sni.example.com",
    });
    expect(parseSocks(`socks://${b64("decoded-user:decoded-pass")}@decoded-auth.example.com:1080`)).toMatchObject({
      username: "decoded-user",
      password: "decoded-pass",
    });
    expect(parseSsh("ssh://root:ssh-pass@ssh-auth.example.com:22?allow-insecure=yes")).toMatchObject({
      username: "root",
      password: "ssh-pass",
      "skip-cert-verify": true,
    });
    expect(parseTelegramProxyLink("tg://http?server=http-tg.example.com&port=8080&remarks=HTTP%20TG")).toMatchObject({
      type: "http",
      name: "HTTP TG",
    });

    expect(parseVMess(`vmess://${b64(JSON.stringify({
      ps: "Bare WS",
      add: "bare-ws.example.com",
      port: 443,
      id: UUID,
      aid: 0,
      net: "ws",
      path: "/",
    }))}`)).toMatchObject({
      name: "Bare WS",
      network: "ws",
    });
    expect(parseVMess(`vmess://grpc+tls:${UUID}-0@std-grpc.example.com:443?serviceName=/svc&mode=gun&authority=auth.example.com#StdGrpc`)).toMatchObject({
      name: "StdGrpc",
      network: "grpc",
      "grpc-opts": {
        "grpc-service-name": "/svc",
        _grpcType: "gun",
        _grpcAuthority: "auth.example.com",
      },
    });
    expect(parseVMess(`vmess1://${UUID}@kit-ws.example.com:443/ws?network=websocket&host=front.example.com&tls=1#KitWS`)).toMatchObject({
      name: "KitWS",
      network: "ws",
      tls: true,
    });
    expect(() => parseVMess(`vmess://tcp:${UUID}-0@bad.example.com:0`)).toThrow("VMess 配置缺少必要字段");

    expect(() => parseVLESS("http://not-vless.example.com")).toThrow("无效的 VLESS 链接");
    expect(parseVLESS(`vless://${b64url(`prefix:${UUID}@sr-flow.example.com:443`)}?obfs=websocket&obfsParam=front.example.com&tls=1&xtls=1#SRFlow`)).toMatchObject({
      name: "SRFlow",
      flow: "xtls-rprx-direct",
      network: "ws",
      "ws-opts": { headers: { Host: "front.example.com" } },
    });
    expect(parseVLESS(`vless://${b64url(`prefix:${UUID}@sr-flow2.example.com:443`)}?obfs=websocket&tls=1&xtls=2#SRFlow2`)).toMatchObject({
      flow: "xtls-rprx-vision",
    });
    expect(parseVLESS(`vless://${UUID}@reality.example.com:443?security=reality&pbk=${"A".repeat(43)}&sid=abcd&spx=/spider#Reality`)).toMatchObject({
      tls: true,
      "client-fingerprint": "chrome",
      "reality-opts": {
        "public-key": "A".repeat(43),
        "short-id": "abcd",
        "_spider-x": "/spider",
      },
    });
    expect(parseVLESS(`vless://${UUID}@local.subboost.test:443?type=xhttp&headers=${encodeURIComponent('{"bad":1}')}#XMin`)).toMatchObject({
      name: "XMin",
      network: "xhttp",
      "xhttp-opts": { path: "/" },
    });
    expect(parseVLESS(`vless://${UUID}@alias-xhttp.example.com:443?type=xhttp&xhttp-path=%20%20&xhttpPath=/alias&xhttp-host=%20&xhttpHost=alias.example.com&xhttp-mode=%20&xhttpMode=stream-up&download-headers=BadJson%7CDown:%20yes#XAlias`)).toMatchObject({
      network: "xhttp",
      "xhttp-opts": {
        path: "/alias",
        host: "alias.example.com",
        mode: "stream-up",
        "download-settings": { headers: { Down: "yes" } },
      },
    });
  });

});
