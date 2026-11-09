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
  describe("simple proxy parser edge cases", () => {
    it("parses base64 authorities, bool aliases, JSON headers, and query remarks", () => {
      const token = b64url("proxyUser:proxyPass@base64.example.com:8080");
      const node = parseHttp(
        `http://${token}?remarks=Query%20Name&skip-cert-verify=off&headers=${encodeURIComponent(
          JSON.stringify({ "User-Agent": "SubBoost", "X-Test": "yes" })
        )}`
      );

      expect(node).toMatchObject({
        name: "Query Name",
        type: "http",
        server: "base64.example.com",
        port: 8080,
        username: "proxyUser",
        password: "proxyPass",
        "skip-cert-verify": false,
        headers: {
          "User-Agent": "SubBoost",
          "X-Test": "yes",
        },
      });
    });

    it("parses socks auth fallback, naked IPv6 defaults, and SSH key query options", () => {
      expect(
        parseSocks(
          `socks5+tls://${b64url("sockUser:sockPass")}@socks.example.com?udp=off&sni=socks.example.com`
        )
      ).toMatchObject({
        name: "SOCKS-socks.example.com:443",
        type: "socks5",
        server: "socks.example.com",
        port: 443,
        username: "sockUser",
        password: "sockPass",
        udp: false,
        tls: true,
        sni: "socks.example.com",
      });

      expect(parseSimpleProxy("solo@[2001:db8::1]:1081{IPv6 Socks}", "socks5")).toMatchObject({
        name: "IPv6 Socks",
        type: "socks5",
        server: "2001:db8::1",
        port: 1081,
        username: "solo",
      });

      expect(
        parseSsh(
          "ssh://admin@ssh.example.com?private-key=key&host-key=ssh-rsa%20aaa,ssh-ed25519%20bbb&idle-timeout=30&host-key-algorithms=rsa,ed25519&server-fingerprint=sha256:abc&allowInsecure=yes"
        )
      ).toMatchObject({
        name: "SSH-ssh.example.com:22",
        type: "ssh",
        server: "ssh.example.com",
        port: 22,
        username: "admin",
        "private-key": "key",
        "host-key": ["ssh-rsa aaa", "ssh-ed25519 bbb"],
        "idle-timeout": 30,
        "host-key-algorithms": ["rsa", "ed25519"],
        "server-fingerprint": "sha256:abc",
        "skip-cert-verify": true,
      });
    });

    it("parses Telegram HTTP links and rejects unsupported simple proxy input", () => {
      expect(
        parseTelegramProxyLink("https://t.me/http?server=tg.example.com&port=443&user=u&pass=p&remarks=TG%20HTTP")
      ).toMatchObject({
        name: "TG HTTP",
        type: "http",
        server: "tg.example.com",
        port: 443,
        username: "u",
        password: "p",
      });

      expect(() => parseSimpleProxy("ftp://example.com:21")).toThrow("不支持的协议");
      expect(() => parseTelegramProxyLink("tg://mtproto?server=tg.example.com&port=443")).toThrow(
        "无效的 Telegram 代理链接"
      );
    });

    it("handles compact standard URL and naked proxy edge formats", () => {
      expect(parseHttp("http://colon.example.com:8080:user:p%40ss#Colon")).toMatchObject({
        name: "Colon",
        server: "colon.example.com",
        port: 8080,
        username: "user",
        password: "p@ss",
      });

      expect(parseHttp("http://plain.example.com?headers=bad|:skip|X-Test:yes&tls-verification=true")).toMatchObject({
        name: "HTTP-plain.example.com:80",
        port: 80,
        headers: { "X-Test": "yes" },
      });

      expect(parseSocks(`socks://${b64url("encoded-only.example.com:1080")}?remark=Encoded`)).toMatchObject({
        name: "Encoded",
        server: "encoded-only.example.com",
        port: 1080,
      });

      expect(parseSimpleProxy("useronly@naked.example.com{UserOnly}", "socks5")).toMatchObject({
        name: "UserOnly",
        server: "naked.example.com",
        port: 1080,
        username: "useronly",
      });

      expect(() => parseHttp("http://:8080:user:pass")).toThrow("缺少服务器地址");
      expect(() => parseHttp("http://bad-port.example.com:not-a-port:user:pass")).toThrow("无效的端口号");
      expect(() => parseTelegramProxyLink("tg://socks?port=1080")).toThrow("缺少服务器地址");
      expect(() => parseTelegramProxyLink("tg://socks?server=tg.example.com&port=0")).toThrow("无效的端口号");
    });
  });

  describe("platform proxy parser edge cases", () => {
    it("normalizes platform-specific proxy lines and WireGuard section fallbacks", () => {
      expect(
        parsePlatformProxyLine("http=http.example.com:8080, tag=QX HTTP, tls-verification=false")
      ).toMatchObject({
        name: "QX HTTP",
        type: "http",
        server: "http.example.com",
        port: 8080,
        "skip-cert-verify": true,
      });

      expect(
        parsePlatformProxyLine("AnyTLS TCP = anytls, anytls.example.com, 443, password=secret, network=tcp")
      ).toMatchObject({
        name: "AnyTLS TCP",
        type: "anytls",
        server: "anytls.example.com",
        port: 443,
      });

      expect(
        parsePlatformProxyLine("Office WG = wireguard, section-name=Office", {
          sections: new Map([
            [
              "WireGuard Office",
              [
                "private-key = private",
                "mtu = not-a-number",
                "keepalive = nope",
                "dns-server = , ",
                "peer = (public-key = public, endpoint = \"wg.example.com:51820\", client-id = \"\")",
              ],
            ],
          ]),
        })
      ).toMatchObject({
        name: "Office WG",
        type: "wireguard",
        server: "wg.example.com",
        port: 51820,
        "private-key": "private",
      });
    });

    it("rejects malformed platform lines with the existing public errors", () => {
      expect(() => parsePlatformProxyLine("Broken HTTP = http, , 8080")).toThrow(
        "surge 代理行缺少 server/port 或端口无效"
      );
      expect(() =>
        parsePlatformProxyLine("Bad WG = wireguard, section-name=Bad", {
          sections: new Map([["WireGuard Bad", ['peer = (public-key = public, endpoint = "bad")']]]),
        })
      ).toThrow("WireGuard section Bad 缺少有效 endpoint");
    });
  });

  describe("VMess parser edge cases", () => {
    it("parses standard, Shadowrocket, URI, Kitsunebi, JSON, and Quantumult forms", () => {
      expect(
        parseVMess(
          `vmess://ws+tls:${UUID}-0@std.example.com:443?host=cdn.example.com&path=/ws%3Fed%3D1024&tls=1&alpn=h2,http/1.1&ech=#Std`
        )
      ).toMatchObject({
        name: "Std",
        type: "vmess",
        server: "std.example.com",
        port: 443,
        network: "ws",
        tls: true,
        "ech-opts": { enable: true },
        "ws-opts": {
          path: "/ws",
          "max-early-data": 1024,
        },
      });

      expect(
        parseVMess(
          `vmess://${b64(`auto:${UUID}@sr.example.com:443`)}?obfs=websocket&tls=1&obfsParam=cdn.example.com&path=/sr&allowInsecure=1&ech=ZWNoLWNvbmZpZw%3D%3D#SR`
        )
      ).toMatchObject({
        name: "SR",
        network: "ws",
        tls: true,
        servername: "cdn.example.com",
        "skip-cert-verify": true,
        "ech-opts": { enable: true, config: "ZWNoLWNvbmZpZw==" },
      });

      expect(
        parseVMess(
          `vmess://${UUID}@uri.example.com:443?type=grpc&serviceName=svc&security=tls&packet-encoding=xudp&authenticated-length=false&global-padding=true&fp=chrome&ech=#Uri`
        )
      ).toMatchObject({
        name: "Uri",
        network: "grpc",
        tls: true,
        "packet-encoding": "xudp",
        "authenticated-length": false,
        "global-padding": true,
        "client-fingerprint": "chrome",
        "grpc-opts": {
          "grpc-service-name": "svc",
        },
      });

      expect(
        parseVMess(`vmess1://${UUID}@kit.example.com:443/kit?network=h2&tls=true&sni=kit-sni.example.com#Kit`)
      ).toMatchObject({
        name: "Kit",
        network: "h2",
        servername: "kit-sni.example.com",
        "h2-opts": {
          path: "/kit",
        },
      });

      expect(
        parseVMess(
          `vmess://${b64(
            JSON.stringify({
              ps: "Json HTTP",
              add: "json.example.com",
              port: 443,
              id: UUID,
              aid: 0,
              scy: "auto",
              net: "tcp",
              type: "http",
              host: "dingtalk.com,front.example.com",
              path: "/a,/b",
              tls: "tls",
              headers: { Host: ["custom.example.com"] },
              method: "post",
            })
          )}`
        )
      ).toMatchObject({
        name: "Json HTTP",
        network: "http",
        "http-opts": {
          method: "POST",
          path: ["/a", "/b"],
          headers: {
            Host: ["custom.example.com"],
          },
        },
      });

      const quantumult = [
        "Quan = vmess",
        "quan.example.com",
        "443",
        "auto",
        `"${UUID}"`,
        "obfs=wss",
        "obfs-host=cdn.example.com",
        'obfs-path="/quan"',
        "tls-verification=false",
      ].join(", ");
      expect(parseVMess(`vmess://${b64(quantumult)}#HashName`)).toMatchObject({
        name: "HashName",
        server: "quan.example.com",
        network: "ws",
        tls: true,
        "skip-cert-verify": true,
      });
    });

    it("rejects malformed VMess branches with meaningful errors", () => {
      expect(() => parseVMess("vmess://tcp:broken")).toThrow("无效的 VMess JSON 格式");
      expect(() =>
        parseVMess(`vmess://${b64(JSON.stringify({ add: "bad.example.com", port: 443, id: UUID, net: "udp" }))}`)
      ).toThrow("不支持的 VMess 传输层");
    });
  });

  describe("VLESS, SS, and config-line parser edge cases", () => {
    it("parses VLESS xhttp, Shadowrocket websocket, h2 domain fronting, and rejects invalid variants", () => {
      const headers = encodeURIComponent("Host:cdn.example.com|X-Test:yes");
      expect(
        parseVLESS(
          `vless://${UUID}@xhttp.example.com:443?security=tls&type=xhttp&xhttp-path=/x&xhttp-host=cdn.example.com&xhttp-headers=${headers}&no-grpc-header=off&x-padding-bytes=128&sc-max-each-post-bytes=4096&max-concurrency=2&download-path=/dl&download-host=down.example.com&download-headers=${headers}&alpn=h2,http/1.1&allowInsecure=yes&ech=ZWNo#XHTTP`
        )
      ).toMatchObject({
        name: "XHTTP",
        network: "xhttp",
        tls: true,
        "skip-cert-verify": true,
        "ech-opts": { enable: true, config: "ZWNo" },
        "xhttp-opts": {
          path: "/x",
          host: "cdn.example.com",
          headers: { Host: "cdn.example.com", "X-Test": "yes" },
          "no-grpc-header": false,
          "sc-max-each-post-bytes": 4096,
          "reuse-settings": { "max-concurrency": "2" },
          "download-settings": {
            path: "/dl",
            host: "down.example.com",
            headers: { Host: "cdn.example.com", "X-Test": "yes" },
          },
        },
      });

      expect(
        parseVLESS(
          `vless://${b64url(`${UUID}@sr-vless.example.com:443`)}?obfs=websocket&obfsParam=cdn.example.com&tls=1&xtls=2#SR`
        )
      ).toMatchObject({
        name: "SR",
        network: "ws",
        flow: "xtls-rprx-vision",
        "client-fingerprint": "chrome",
        "ws-opts": {
          headers: {
            Host: "cdn.example.com",
          },
        },
      });

      expect(
        parseVLESS(`vless://${UUID}@front.example.com:443?security=tls&type=h2&sni=sni.example.com&path=/h2#H2`)
      ).toMatchObject({
        network: "h2",
        "h2-opts": {
          host: ["sni.example.com"],
          path: "/h2",
        },
      });

      expect(() => parseVLESS(`vless://${UUID}@bad.example.com:443?security=tls&type=udp`)).toThrow(
        "不支持的 VLESS 传输层"
      );
      expect(() => parseVLESS(`vless://${UUID}@bad.example.com:443?security=reality&ech=bad`)).toThrow(
        "VLESS 启用 ECH 需要 security=tls"
      );
    });

    it("normalizes SS plugin variants and parser query flags", () => {
      expect(normalizeSsPlugin("v2ray-plugin", { mux: "0", tls: 1 })).toEqual({
        plugin: "v2ray-plugin",
        pluginOpts: { mux: false, tls: true },
      });
      expect(normalizeSsPlugin("simple-obfs", { obfs: "http", "obfs-host": "cdn.example.com" })).toEqual({
        plugin: "obfs",
        pluginOpts: { mode: "http", host: "cdn.example.com" },
      });

      expect(
        parseSS(
          `ss://${b64("aes-128-gcm:secret")}@ss.example.com:8388/?plugin=${encodeURIComponent(
            "obfs-local;obfs=tls;obfs-host=cdn.example.com;flag;empty="
          )}&uot&tfo=off#SS`
        )
      ).toMatchObject({
        name: "SS",
        type: "ss",
        server: "ss.example.com",
        port: 8388,
        plugin: "obfs",
        "plugin-opts": {
          mode: "tls",
          host: "cdn.example.com",
        },
        "udp-over-tcp": true,
      });

      expect(
        parseSS(
          `ss://${b64("aes-128-gcm:secret@[2001:db8::2]:8388")}?v2ray-plugin=${encodeURIComponent(
            b64(JSON.stringify({ mode: "websocket", tls: "0", mux: "1" }))
          )}#V2Ray`
        )
      ).toMatchObject({
        name: "V2Ray",
        server: "2001:db8::2",
        plugin: "v2ray-plugin",
        "plugin-opts": {
          mode: "websocket",
          tls: false,
          mux: true,
        },
      });
    });

    it("parses config-line optional branches across protocol builders", () => {
      expect(
        parseConfigLine(
          `Cfg VLESS = vless, cfg-vless.example.com, 443, ${UUID}, tls=true, pbk=pub, sid=abc, flow=xtls-rprx-vision, packet-encoding=xudp, fp=chrome, ws=true, ws-path=/ws?ed=512, host=cdn.example.com`
        )
      ).toMatchObject({
        type: "vless",
        tls: true,
        flow: "xtls-rprx-vision",
        "packet-encoding": "xudp",
        "reality-opts": {
          "public-key": "pub",
          "short-id": "abc",
        },
        network: "ws",
      });

      expect(
        parseConfigLine(
          "Cfg HY = hysteria, hy.example.com, 8443, auth=token, sni=hy.example.com, skip-cert-verify=false, alpn=h3, up=20 Mbps, down=100 Mbps, ports=1000-1002, obfs-param=mask, obfs=enabled"
        )
      ).toMatchObject({
        type: "hysteria",
        "auth-str": "token",
        sni: "hy.example.com",
        alpn: ["h3"],
        up: "20 Mbps",
        down: "100 Mbps",
        ports: "1000-1002",
        obfs: "mask",
        _obfs: "enabled",
      });

      expect(
        parseConfigLine(
          "Cfg TUIC = tuic-v5, tuic.example.com, 443, token=tok, sni=tuic.example.com, alpn=h3, congestion-controller=bbr, udp-relay-mode=native, skip-cert-verify=true, disable-sni=true"
        )
      ).toMatchObject({
        type: "tuic",
        version: 5,
        token: "tok",
        sni: "tuic.example.com",
        alpn: ["h3"],
        "congestion-controller": "bbr",
        "udp-relay-mode": "native",
        "skip-cert-verify": true,
        "disable-sni": true,
      });
    });

    it("parses extra config-line branches and rejects missing required secrets", () => {
      expect(parseConfigLine("Cfg Socks TLS = socks5-tls, socks.example.com, 443, username=u")).toMatchObject({
        type: "socks5",
        tls: true,
        username: "u",
      });

      expect(
        parseConfigLine(
          "Cfg Snell = snell, snell.example.com, 443, password=psk, version=4, obfs=http, obfs-host=cdn.example.com, obfs-uri=/front, udp-relay=false"
        )
      ).toMatchObject({
        type: "snell",
        version: 4,
        udp: false,
        "obfs-opts": {
          mode: "http",
          host: "cdn.example.com",
          path: "/front",
        },
      });

      expect(
        parseConfigLine(
          "Cfg WireGuard = wireguard, wg.example.com, 51820, privatekey=private, publickey=public, presharedkey=pre, interface-ip=10.0.0.2, interface-ipv6=fd00::2, section-name=Office, mtu=1420"
        )
      ).toMatchObject({
        type: "wireguard",
        "private-key": "private",
        "public-key": "public",
        "pre-shared-key": "pre",
        ip: "10.0.0.2",
        ipv6: "fd00::2",
        "section-name": "Office",
        mtu: 1420,
      });

      expect(() => parseConfigLine("Cfg VMess = vmess, vmess.example.com, 443")).toThrow(
        "vmess 配置行缺少 uuid"
      );
      expect(() => parseConfigLine("Cfg VLESS = vless, vless.example.com, 443")).toThrow(
        "vless 配置行缺少 uuid"
      );
      expect(() => parseConfigLine("Cfg HY2 = hysteria2, hy2.example.com, 443")).toThrow(
        "hysteria2 配置行缺少 password"
      );
      expect(() => parseConfigLine("Cfg WG = wireguard, wg.example.com, 51820")).toThrow(
        "wireguard 配置行缺少 private-key"
      );
      expect(() => parseConfigLine("Cfg Unknown = unknown, example.com, 443")).toThrow(
        "不支持的配置行协议"
      );
    });
  });

});
