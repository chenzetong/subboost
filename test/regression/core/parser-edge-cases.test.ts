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
  it("covers platform parser WireGuard and AnyTLS edge branches", () => {
    expect(parsePlatformProxyLine("")).toBeNull();
    expect(parsePlatformProxyLine("not a proxy line")).toBeNull();

    expect(
      parsePlatformProxyLine(
        'Loon WG = wireguard, interface-ip = "10.0.0.2", interface-ipv6 = "fd00::2", private-key = "priv", peers = [{public-key = "pub", preshared-key = "pre", endpoint = "[2001:db8::1]:51820", allowed-ips = "0.0.0.0/0, ::/0", reserved = "[1,2,3]"}], mtu = 1280, keepalive = 15, dns = "1.1.1.1", dnsv6 = "2606:4700:4700::1111"',
      ),
    ).toMatchObject({
      type: "wireguard",
      reserved: [1, 2, 3],
    });

    expect(
      parsePlatformProxyLine("Full Section WG = wireguard, section-name=Office", {
        sections: new Map([
          [
            " WireGuard Office ",
            [
              "# comment",
              "self-ip = 10.0.0.2",
              "self-ip-v6 = fd00::2",
              "private-key = private",
              "mtu = 1280",
              "keepalive = 25",
              "dns-server = 1.1.1.1, 8.8.8.8",
              'peer = (public-key = "public", pre-shared-key = "pre", endpoint = "[2001:db8::2]:51820", allowed-ips = "0.0.0.0/0, ::/0", reserved = "[4,5,6]")',
            ],
          ],
        ]),
      }),
    ).toMatchObject({
      type: "wireguard",
      server: "2001:db8::2",
      mtu: 1280,
      "persistent-keepalive": 25,
      "allowed-ips": ["0.0.0.0/0", "::/0"],
      peers: [expect.objectContaining({ "pre-shared-key": "pre", reserved: [4, 5, 6] })],
    });

    expect(() =>
      parsePlatformProxyLine("No Peer WG = wireguard, section-name=Office", {
        sections: new Map([["WireGuard Office", ["private-key = private"]]]),
      }),
    ).toThrow("缺少有效 endpoint");

    expect(() =>
      parsePlatformProxyLine("Invalid Endpoint WG = wireguard, section-name=Office", {
        sections: new Map([["WireGuard Office", ['peer = (endpoint = "wg.example.com:0", client-id = "bad")']]]),
      }),
    ).toThrow("缺少有效 endpoint");

    expect(() =>
      parsePlatformProxyLine("Empty Endpoint WG = wireguard, section-name=Office", {
        sections: new Map([["WireGuard Office", ['peer = (endpoint = "", reserved = "")']]]),
      }),
    ).toThrow("缺少有效 endpoint");

    expect(
      parsePlatformProxyLine("Client Id WG = wireguard, section-name=Office", {
        sections: new Map([["WireGuard Office", ['peer = (endpoint = "wg-client.example.com:51820", client-id = "7/8/9")']]]),
      }),
    ).toMatchObject({
      type: "wireguard",
      reserved: [7, 8, 9],
      peers: [expect.objectContaining({ reserved: [7, 8, 9] })],
    });

    expect(
      parsePlatformProxyLine(
        "Plain WS = vmess, ws-plain.example.com, 443, username=11111111-1111-4111-8111-111111111111, ws=true, tls=true",
      ),
    ).toMatchObject({
      type: "vmess",
      network: "ws",
    });

    expect(parsePlatformProxyLine("AnyTLS Plain = anytls, anytls.example.com, 443, password=secret")).toMatchObject({
      type: "anytls",
      server: "anytls.example.com",
    });
    expect(
      parsePlatformProxyLine(
        "SSH Fingerprint = ssh, ssh.example.com, 22, username=root, tls-fingerprint=SHA256:abc",
      ),
    ).toMatchObject({
      type: "ssh",
    });
    expect(
      parsePlatformProxyLine(
        "AnyTLS Reality = anytls, anytls.example.com, 443, password=secret, security=reality",
      ),
    ).toMatchObject({
      type: "anytls",
      server: "anytls.example.com",
    });
    expect(() =>
      parsePlatformProxyLine('AnyTLS WS = anytls, anytls.example.com, 443, "secret", transport=ws'),
    ).toThrow("AnyTLS 平台配置不支持 network=ws");
    expect(parsePlatformProxyLine("HTTP TLS = http, http-tls.example.com, 443, tls=true")).toMatchObject({
      name: "HTTP TLS",
      type: "http",
      server: "http-tls.example.com",
    });
    expect(parsePlatformProxyLine('WG Empty Reserved = wireguard, peers=[{endpoint="wg-reserved.example.com:51820", reserved=""}]')).toMatchObject({
      name: "WG Empty Reserved",
      type: "wireguard",
      server: "wg-reserved.example.com",
    });
  });

  it("covers config-line tokenizer and protocol-specific config branches", () => {
    expect(isUuidLike(undefined)).toBe(false);
    expect(inferSkipCertVerify({ "allow_insecure": "yes" })).toBe(true);
    expect(inferSkipCertVerify({ "tls-verification": "true" })).toBeUndefined();
    expect(parseWsHeaders("Host: edge.example.com|NoColon|Empty:")).toEqual({ Host: "edge.example.com" });
    expect(tokenizeConfigLine("Loose=http, example.com , 80 , username = user , password = , flag")).toMatchObject({
      params: { username: "user", password: "" },
      extras: ["flag"],
    });

    const common: Record<string, unknown> = {};
    applyCommonNodeParams(common, {
      sni: "plain-sni.example.com",
      "tls-cert-sha256": "",
      tls_cert_sha256: "cert-under",
      "shadow-tls-version": "bad",
      "shadow-tls-password": "shadow-secret",
      "shadow-tls-sni": "",
      tfo: "yes",
      "disable-sni": "off",
      "block-quic": "yes",
      "udp-port": "9000",
      "tls-fingerprint": "chrome",
    });
    expect(common).toMatchObject({
      sni: "plain-sni.example.com",
      tfo: true,
      "disable-sni": false,
      "block-quic": true,
      "udp-port": 9000,
      "tls-fingerprint": "chrome",
      "tls-cert-sha256": "cert-under",
      "shadow-tls-password": "shadow-secret",
    });

    const hy2Common: Record<string, unknown> = { type: "hysteria2" };
    applyCommonNodeParams(hy2Common, { fingerprint: "sha256:hy2" });
    expect(hy2Common).toMatchObject({ fingerprint: "sha256:hy2" });

    const tcpNode: Record<string, unknown> = {};
    applyTransport(tcpNode, { transport: "tcp", path: "/ignored" });
    expect(tcpNode).toEqual({ network: "tcp" });

    const bareWsNode: Record<string, unknown> = {};
    applyTransport(bareWsNode, { transport: "ws", path: "/bare" });
    expect(bareWsNode).toMatchObject({ network: "ws", "ws-opts": { path: "/bare" } });

    const h2Node: Record<string, unknown> = {};
    applyTransport(h2Node, { transport: "h2", path: "/h2" });
    expect(h2Node).toMatchObject({ network: "h2", "h2-opts": { path: "/h2" } });

    expect(parseConfigLine("Tuic UUID=tuic,tuic.example.com,443,uuid=11111111-1111-4111-8111-111111111111,password=p,peer=peer.example.com,alpn=h3")).toMatchObject({
      uuid: UUID,
      password: "p",
      sni: "peer.example.com",
      alpn: ["h3"],
    });
    expect(parseConfigLine("WG Section=wireguard,wg.example.com,51820,private-key=priv,section-name=Office,udp=off,mtu=1280")).toMatchObject({
      "section-name": "Office",
      udp: false,
      mtu: 1280,
    });
    expect(parseConfigLine("HTTPS TLS=https,https.example.com,443,headers=Host: edge.example.com")).toMatchObject({
      type: "https",
      headers: { Host: "edge.example.com" },
    });
    expect(parseConfigLine("SS Bare Obfs=ss,ss.example.com,8388,password=p,obfs=http")).toMatchObject({
      plugin: "obfs",
      "plugin-opts": { mode: "http" },
    });
    expect(parseConfigLine("Snell Bare=snell,snell.example.com,443,psk=secret,version=bad,obfs=tls")).toMatchObject({
      type: "snell",
      psk: "secret",
      "obfs-opts": { mode: "tls" },
    });
    expect(parseConfigLine("VLESS Reality No Sid=vless,vless.example.com,443,uuid=11111111-1111-4111-8111-111111111111,public-key=pub")).toMatchObject({
      "reality-opts": { "public-key": "pub" },
      "client-fingerprint": "chrome",
    });
    expect(parseConfigLine("AnyTLS Full=anytls,anytls.example.com,443,password=secret,fp=chrome,alpn=h3,h2")).toMatchObject({
      type: "anytls",
      "client-fingerprint": "chrome",
      alpn: ["h3"],
    });
    expect(parseConfigLine("Hy Bare=hysteria,hy.example.com,443")).toMatchObject({
      type: "hysteria",
      protocol: "udp",
    });
    expect(parseConfigLine("Tuic Token=tuic,tuic.example.com,443,token=tok")).toMatchObject({
      token: "tok",
    });
    expect(() => parseConfigLine("Tuic Missing Combo=tuic,tuic.example.com,443,uuid=11111111-1111-4111-8111-111111111111")).toThrow(
      "tuic 配置行缺少 token 或 uuid/password",
    );
  });

  it("covers SS and SSR plugin, fallback, and validation branches", () => {
    expect(normalizeSsPlugin("v2ray-plugin", { mux: 0, tls: 1, mode: "websocket" })).toEqual({
      plugin: "v2ray-plugin",
      pluginOpts: { mux: false, tls: true, mode: "websocket" },
    });
    expect(normalizeSsPlugin("gost-plugin", undefined)).toEqual({ plugin: "gost-plugin", pluginOpts: undefined });
    expect(normalizeSsPlugin("obfs-local", { obfs_host: " front.example.com " })).toEqual({
      plugin: "obfs",
      pluginOpts: { host: "front.example.com" },
    });

    expect(
      parseSS(
        `ss://aes-128-gcm:pw@[2001:db8::8]:8388?plugin=${encodeURIComponent("v2ray-plugin;path=\\z;=ignored;empty=;")}&uot=off&tfo=#IPv6`,
      ),
    ).toMatchObject({
      name: "IPv6",
      server: "2001:db8::8",
      tfo: true,
      plugin: "v2ray-plugin",
      "plugin-opts": { path: "\\z", empty: true },
    });
    expect(parseSS(`ss://${b64("aes-128-gcm:pw@[2001:db8::9]:8388")}`)).toMatchObject({
      server: "2001:db8::9",
    });
    expect(
      parseSS(
        `ss://${b64("aes-128-gcm:pw")}@json-plugin.example.com:8388?v2ray-plugin=${encodeURIComponent(
          b64(JSON.stringify({ mux: "false", tls: "on" })),
        )}`,
      ),
    ).toMatchObject({
      plugin: "v2ray-plugin",
      "plugin-opts": { mux: false, tls: true },
    });
    expect(
      parseSS(
        `ss://${b64("aes-128-gcm:pw")}@plugin-empty.example.com:8388?plugin=${encodeURIComponent("obfs-local;;;")}`,
      ),
    ).toMatchObject({
      plugin: "obfs",
    });
    expect(() => parseSS(`ss://${b64("aes-128-gcm:pw@bad.example.com:0")}`)).toThrow("无效的端口号");
    expect(() => parseSS(`ss://${b64("aes-128-gcm:pw")}@missing-port.example.com#Bad`)).toThrow(
      "无法解析服务器端口",
    );
    expect(() => parseSS("ss://not-valid-base64")).toThrow("无效的 SS 链接格式");

    expect(parseSSR(ssr("[2001:db8::1]:8388:origin:aes-256-cfb:plain:" + b64url("pw"), `remarks=${b64url("plain-name")}&flag`))).toMatchObject({
      name: "plain-name",
      server: "2001:db8::1",
      password: "pw",
    });
    expect(parseSSR(ssr("[2001:db8::10]:8388::::" + b64url("pw"), `flag&=ignored&&remarks=${b64url("plain name")}`))).toMatchObject({
      name: "plain name",
      server: "2001:db8::10",
      cipher: "aes-256-cfb",
      protocol: "origin",
      obfs: "plain",
    });
    expect(parseSSR(ssr("fallback.example.com:8388:::plain:" + b64url("pw"), "protoparam=not-base64&obfsparam="))).toMatchObject({
      cipher: "aes-256-cfb",
      protocol: "origin",
      "protocol-param": expect.any(String),
    });
    expect(() => parseSSR("ssr://")).toThrow("无效的 SSR 链接");
    expect(() => parseSSR(`ssr://${b64("bad:format")}`)).toThrow("无效的 SSR 链接格式");
    expect(() => parseSSR(ssr(":8388:origin:aes-256-cfb:plain:" + b64url("pw")))).toThrow("缺少服务器地址");
    expect(() => parseSSR(ssr("bad.example.com:70000:origin:aes-256-cfb:plain:" + b64url("pw")))).toThrow("无效的端口号");
  });

  it("covers simple proxy and VLESS fallback branches", () => {
    expect(parseSimpleProxy("user@auth-only.example.com:8080", "http")).toMatchObject({
      username: "user",
      server: "auth-only.example.com",
    });
    expect(parseSimpleProxy("plain.example.com:8080:user:p:ass", "http")).toMatchObject({
      username: "user",
      password: "p:ass",
    });
    expect(() => parseSimpleProxy("user@[2001:db8::12]", "http")).toThrow("缺少服务器地址");
    const jsonObjectHeaders = parseHttp("http://headers.example.com:80?headers=%7B%22Bad%22%3A%7B%7D%7D&allow-insecure=");
    expect(jsonObjectHeaders).toMatchObject({ server: "headers.example.com" });
    expect(jsonObjectHeaders).not.toHaveProperty("headers");
    expect(parseHttp("https://http.example.com:443?allow-insecure=yes&headers=Host: edge.example.com|Bad")).toMatchObject({
      type: "https",
      tls: true,
      "skip-cert-verify": true,
      headers: { Host: "edge.example.com" },
    });
    expect(parseSimpleProxy("user:p%3Aass@[2001:db8::10]:8080", "http")).toMatchObject({
      server: "2001:db8::10",
      password: "p%3Aass",
    });
    expect(parseSimpleProxy(`http://${b64("bare.example.com:8080")}?remarks=QueryName`, "http")).toMatchObject({
      name: "QueryName",
      server: "bare.example.com",
      port: 8080,
    });
    expect(
      parseHttp(
        `http://${b64("user:pw@[2001:db8::8]:8080")}?remarks=IPv6%20Base64&headers=Host: edge.example.com||X-Test: ok&skip-cert-verify=`,
      ),
    ).toMatchObject({
      name: "IPv6 Base64",
      server: "2001:db8::8",
      port: 8080,
      username: "user",
      password: "pw",
      headers: { Host: "edge.example.com", "X-Test": "ok" },
    });
    expect(parseSimpleProxy("http://colon.example.com:8080::", "http")).toMatchObject({
      server: "colon.example.com",
      port: 8080,
    });
    expect(() => parseSimpleProxy("[2001:db8::11]:bad", "http")).toThrow("无效的端口号");
    expect(parseSocks(`socks5://${b64("user:pass")}@socks.example.com:1080`)).toMatchObject({
      username: "user",
      password: "pass",
    });
    expect(() => parseSocks("http://socks.example.com:1080")).toThrow("无效的 SOCKS 链接");
    expect(() => parseSocks("socks.example.com:1080")).toThrow("无效的 SOCKS 链接");
    expect(parseSsh("ssh://ssh.example.com:22?private-key=&host-key=ssh-ed25519%20AAA&allow-insecure=yes")).toMatchObject({
      "host-key": ["ssh-ed25519 AAA"],
      "skip-cert-verify": true,
    });
    expect(() => parseSsh("ssh://:22")).toThrow("缺少服务器地址");
    expect(() => parseSimpleProxy("custom://example.com:80", "http")).toThrow("不支持的协议");
    expect(() => parseTelegramProxyLink("https://t.me/?server=proxy.example.com&port=1080")).toThrow("无效的 Telegram 代理链接");

    expect(parseVLESS(`vless://${b64url(`${UUID}@sr-http.example.com:443`)}?obfs=http&obfsParam=front.example.com&tls=1#SRHttp`)).toMatchObject({
      network: "http",
      "http-opts": { headers: { Host: ["front.example.com"] } },
    });
    expect(parseVLESS(`vless://${UUID}@grpc-empty.example.com:443?type=grpc&security=tls#GrpcEmpty`)).toMatchObject({
      "grpc-opts": { "grpc-service-name": "" },
    });
    expect(parseVLESS(`vless://${UUID}@xhttp-download.example.com:443?type=xhttp&downloadHeaders=NoColon|X-Down: yes&downloadHost=down.example.com#XDown`)).toMatchObject({
      "xhttp-opts": {
        "download-settings": {
          host: "down.example.com",
          headers: { "X-Down": "yes" },
        },
      },
    });
    expect(parseVLESS(`vless://${UUID}@xhttp-json-headers.example.com:443?type=xhttp&xhttpHeaders=${encodeURIComponent('{"X-Test":"yes"}')}&downloadHeaders=${encodeURIComponent('{"X-Down":"ok"}')}#XJsonHeaders`)).toMatchObject({
      "xhttp-opts": {
        headers: { "X-Test": "yes" },
        "download-settings": { headers: { "X-Down": "ok" } },
      },
    });
    expect(parseVLESS(`vless://${UUID}@tcp-empty.example.com:443?type=&security=&encryption=&host=front.example.com#TcpEmpty`)).toMatchObject({
      network: "tcp",
      server: "tcp-empty.example.com",
    });
    expect(() => parseVLESS(`vless://${UUID}@bad-transport.example.com:443?type=quic#BadTransport`)).toThrow(
      "不支持的 VLESS 传输层",
    );
    expect(parseVLESS(`vless://${b64url(`prefix:${UUID}@sr-xtls-direct.example.com:443`)}?obfs=websocket&tls=1&xtls=1#SRXtlsDirect`)).toMatchObject({
      flow: "xtls-rprx-direct",
      network: "ws",
    });
    expect(parseVLESS(`vless://${b64url(`prefix:${UUID}@sr-xtls-vision.example.com:443`)}?obfs=websocket&tls=1&xtls=2#SRXtlsVision`)).toMatchObject({
      flow: "xtls-rprx-vision",
      network: "ws",
    });
    expect(parseVLESS(`vless://${UUID}@ech-tls.example.com:443?security=tls&ech=#EchTls`)).toMatchObject({
      "ech-opts": { enable: true },
    });
    expect(parseVLESS(`vless://${UUID}@xhttp-json-object.example.com:443?type=xhttp&xhttpHeaders=${encodeURIComponent('{"Bad":1}')}&downloadHeaders=${encodeURIComponent('{"AlsoBad":1}')}#XJsonObject`)).toMatchObject({
      "xhttp-opts": { path: "/" },
    });
    expect(parseVLESS(`vless://${UUID}@boolish.example.com:443?allowInsecure=maybe&tls-verification=maybe#Boolish`)).toMatchObject({
      name: "Boolish",
      tls: false,
      network: "tcp",
    });
    expect(parseVLESS(`vless://${UUID}@header-http.example.com:443?headerType=http&security=tls&sni=front.example.com&path=/a,/b#HeaderHttp`)).toMatchObject({
      network: "http",
      "http-opts": {
        path: ["/a", "/b"],
        headers: { Host: ["front.example.com"] },
      },
    });
    expect(parseVLESS(`vless://${UUID}@fronted-http.example.com:443?type=http&security=tls&sni=cdn.example.com&path=,,#FrontedHttp`)).toMatchObject({
      network: "http",
      "http-opts": {
        path: ["/"],
        headers: { Host: ["cdn.example.com"] },
      },
    });
    expect(parseVLESS(`vless://${UUID}@fronted-h2.example.com:443?h2=1&security=tls&sni=cdn.example.com#FrontedH2`)).toMatchObject({
      network: "h2",
      "h2-opts": {
        host: ["cdn.example.com"],
        path: "/",
      },
    });
    expect(parseVLESS(`vless://${UUID}@empty-method.example.com:443?type=http&security=tls&sni=front.example.com&method=&path=#EmptyMethod`)).toMatchObject({
      network: "http",
      "http-opts": {
        method: "GET",
        path: ["/"],
        headers: { Host: ["front.example.com"] },
      },
    });
    expect(parseVLESS(`vless://${UUID}@grpc-mode.example.com:443?type=grpc&mode=gun&authority=grpc.example.com&path=/svc#GrpcMode`)).toMatchObject({
      "grpc-opts": {
        "grpc-service-name": "svc",
        _grpcType: "gun",
        _grpcAuthority: "grpc.example.com",
      },
    });
    expect(parseVLESS(`vless://${UUID}@upgrade.example.com:443?type=httpupgrade&security=tls&path=/up?ed=321&host=cdn.example.com#Upgrade`)).toMatchObject({
      network: "ws",
      "ws-opts": {
        path: "/up",
        "max-early-data": 321,
        "v2ray-http-upgrade": true,
      },
    });
    expect(parseVLESS(`vless://${UUID}@xhttp-full.example.com:443?type=xhttp&security=tls&xhttpHeaders=X-A:%201&noGrpcHeader=on&scMaxEachPostBytes=123&maxConcurrency=3&downloadHeaders=X-D:%202#XFull`)).toMatchObject({
      network: "xhttp",
      "xhttp-opts": {
        headers: { "X-A": "1" },
        "no-grpc-header": true,
        "sc-max-each-post-bytes": 123,
        "reuse-settings": { "max-concurrency": "3" },
        "download-settings": { headers: { "X-D": "2" } },
      },
    });
    expect(parseVLESS(`vless://${b64url(`${UUID}@sr-empty.example.com:443`)}?obfs=websocket&obfsParam=&tls=0#SREmpty`)).toMatchObject({
      name: "SREmpty",
      tls: false,
      "ws-opts": { path: "/" },
    });
    expect(parseVLESS(`vless://${b64url(`${UUID}@sr-plain.example.com:443`)}?obfs=websocket&obfsParam=plain-front.example.com&tls=1#SRPlain`)).toMatchObject({
      name: "SRPlain",
      "ws-opts": { headers: { Host: "plain-front.example.com" } },
    });
    expect(parseVLESS(`vless://${b64url(`${UUID}@sr-json-object.example.com:443`)}?obfs=websocket&obfsParam=${encodeURIComponent('{"Bad":1}')}&tls=1#SRJsonObject`)).toMatchObject({
      name: "SRJsonObject",
      "ws-opts": { path: "/" },
    });
    expect(() => parseVLESS("http://not-vless.example.com")).toThrow("无效的 VLESS 链接");
    expect(() => parseVLESS("vless://@missing.example.com:443")).toThrow("VLESS 配置缺少必要字段");
    expect(() => parseVLESS(`vless://${UUID}@bad-port.example.com:70000`)).toThrow("无效的端口号");
  });

  it("covers Hysteria2 and Netch remaining protocol branches", () => {
    expect(parseHysteria2("hysteria2://secret@[2001:db8::20]:2000-2002?hop-interval=10-20&alpn=h3,h2&obfs=salamander&obfs-password=obfs&up=50&down=1gbps#HYRange")).toMatchObject({
      name: "HYRange",
      server: "2001:db8::20",
      ports: "2000-2002",
      "hop-interval": "10-20",
      "obfs-password": "obfs",
      alpn: ["h3", "h2"],
      up: "50 mbps",
      down: "1gbps",
    });
    expect(parseHysteria2("hy2://[2001:db8::21]?auth=query-secret&ports=3000,3001&hopInterval=5&allow_insecure=true")).toMatchObject({
      server: "2001:db8::21",
      password: "query-secret",
      ports: "3000,3001",
      "hop-interval": 5,
      "skip-cert-verify": true,
    });
    expect(parseHysteria2("hysteria2://secret@hy2-default.example.com?hop_interval=bad&peer=peer.example.com")).toMatchObject({
      server: "hy2-default.example.com",
      port: 443,
      sni: "peer.example.com",
    });
    expect(() => parseHysteria2("hysteria2://?auth=secret")).toThrow("Hysteria2 配置缺少必要字段");

    expect(parseNetch(netch({
      Type: "SS",
      Hostname: "ss-plugin.example.com",
      Port: "8388",
      Password: "pw",
      Plugin: "obfs-local",
      PluginOption: "=ignored;flag;mode=tls",
      EnableUDP: 1,
      EnableTFO: 0,
    }))).toMatchObject({
      type: "ss",
      udp: true,
      tfo: false,
      plugin: "obfs-local",
      "plugin-opts": { flag: true, mode: "tls" },
    });
    expect(parseNetch(netch({
      Type: "VMess",
      Hostname: "vmess-edge.example.com",
      Port: 443,
      UserID: UUID,
      TransferProtocol: "ws",
      Path: "/ws",
      Edge: "edge-value",
      TLSSecure: true,
      AllowInsecure: true,
    }))).toMatchObject({
      network: "ws",
      "skip-cert-verify": true,
      "ws-opts": { path: "/ws", headers: { Edge: "edge-value" } },
    });
    expect(parseNetch(netch({
      Type: "VMess",
      Hostname: "vmess-h2-empty-host.example.com",
      Port: 443,
      UserID: UUID,
      TransferProtocol: "h2",
    }))).toMatchObject({
      network: "h2",
      "h2-opts": { path: "/" },
    });
    expect(parseNetch(netch({
      Type: "SOCKS5",
      Hostname: "socks-password.example.com",
      Port: 1080,
      Password: "pw",
    }))).toMatchObject({
      type: "socks5",
      password: "pw",
    });
  });
});
