import { describe, expect, it } from "vitest";
import { parsePlatformProxyLine } from "../../../packages/core/src/parser/platform/parse-platform-proxy-line";
import { parseHttp, parseSimpleProxy, parseSocks, parseSsh } from "../../../packages/core/src/parser/protocols/simple-proxy";
import { parseVMess } from "../../../packages/core/src/parser/protocols/vmess";
import { parseVLESS } from "../../../packages/core/src/parser/protocols/vless";

const UUID = "11111111-1111-4111-8111-111111111111";

function b64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

describe("public core parser extra branch coverage", () => {
  it("covers platform parser fallbacks and WireGuard optional fields", () => {
    expect(parsePlatformProxyLine("   ")).toBeNull();
    expect(parsePlatformProxyLine("not a platform proxy line")).toBeNull();

    expect(() =>
      parsePlatformProxyLine("Office WG = wireguard, section-name=Missing", {
        sections: new Map([["WireGuard Other", ["peer = (endpoint = \"wg.example.com:51820\")"]]]),
      })
    ).toThrow("未找到 WireGuard section");

    expect(
      parsePlatformProxyLine("Office WG = wireguard, section-name=Office", {
        sections: new Map([
          [
            " wireguard office ",
            [
              "; comment",
              "self-ip = 10.0.0.2",
              "self-ip-v6 = fd00::2",
              "private-key = private",
              "dns-server = 1.1.1.1, 2606:4700:4700::1111",
              "mtu = 1420",
              "keepalive = 25",
              "peer = (public-key = public, pre-shared-key = pre, endpoint = \"[2001:db8::1]:51820\", allowed-ips = \"0.0.0.0/0, ::/0\", reserved = \"1/2/3\")",
            ],
          ],
        ]),
      })
    ).toMatchObject({
      name: "Office WG",
      type: "wireguard",
      server: "2001:db8::1",
      port: 51820,
      ip: "10.0.0.2",
      ipv6: "fd00::2",
      "private-key": "private",
      "public-key": "public",
      "pre-shared-key": "pre",
      mtu: 1420,
      "persistent-keepalive": 25,
      reserved: [1, 2, 3],
      dns: ["1.1.1.1", "2606:4700:4700::1111"],
      "allowed-ips": ["0.0.0.0/0", "::/0"],
    });

    expect(
      parsePlatformProxyLine(
        "Loon WG = wireguard, interface-ip = 10.0.0.2, private-key = private, peers = [{ public-key = public, endpoint = wg.example.com:51820, allowed-ips = \"10.0.0.0/8\", preshared-key = pre, reserved = \"[4,5,6]\" }], dns = 1.1.1.1, dnsv6 = 2606:4700:4700::1111, mtu = 1280, keepalive = 20"
      )
    ).toMatchObject({
      name: "Loon WG",
      type: "wireguard",
      server: "wg.example.com",
      port: 51820,
      reserved: [4, 5, 6],
      dns: ["1.1.1.1", "2606:4700:4700::1111"],
    });

    expect(parsePlatformProxyLine("AnyTLS TCP = anytls, any.example.com, 443, password=p, servername=front.example.com")).toMatchObject({
      type: "anytls",
    });
  });

  it("covers simple proxy parsing defaults, malformed auth, and Telegram variants", () => {
    expect(parseHttp("http://plain.example.com?headers=%7B%22bad%22%3A1%7D&allow_insecure=no")).toMatchObject({
      name: "HTTP-plain.example.com:80",
      "skip-cert-verify": false,
    });

    expect(parseSocks(`socks5://${b64url("encoded-user:encoded-pass")}@socks.example.com:1080`)).toMatchObject({
      name: "SOCKS-socks.example.com:1080",
      username: "encoded-user",
      password: "encoded-pass",
    });

    expect(parseSocks(`socks5://${b64("\u0000bad")}@raw.example.com:1080`)).toMatchObject({
      username: b64("\u0000bad"),
    });

    expect(parseSsh("ssh://ssh.example.com?host-key=,,;&idle-timeout=abc&allow-insecure=off")).toMatchObject({
      type: "ssh",
      server: "ssh.example.com",
      "skip-cert-verify": false,
    });

    expect(parseSimpleProxy("user@[2001:db8::8]:80{IPv6 Default}", "http")).toMatchObject({
      name: "IPv6 Default",
      server: "2001:db8::8",
      port: 80,
      username: "user",
    });
    expect(() => parseSimpleProxy("bad-format", "http")).toThrow("无效的代理格式");
  });

  it("covers VMess parser style fallbacks and transport branches", () => {
    expect(() => parseVMess(`vmess://${b64("auto:not-a-uuid@example.com:443")}`)).toThrow(
      "无效的 VMess JSON 格式"
    );
    expect(() => parseVMess(`vmess://${b64("Name = vmess, only, four")}`)).toThrow("无效的 Quantumult VMess 配置");
    expect(() => parseVMess(`vmess1://bad-format`)).toThrow("无效的 Kitsunebi VMess 链接");
    expect(parseVMess(`vmess://tcp:${UUID}-0@std.example.com:443`)).toMatchObject({
      name: "std.example.com:443",
      server: "std.example.com",
      port: 443,
      network: "tcp",
    });

    expect(parseVMess(`vmess://${UUID}@uri.example.com:443?type=httpupgrade&path=/u&host=cdn.example.com#Upgrade`)).toMatchObject({
      name: "Upgrade",
      network: "ws",
      "ws-opts": {
        path: "/u",
        "v2ray-http-upgrade": true,
        "v2ray-http-upgrade-fast-open": true,
      },
    });

    expect(() => parseVMess(`vmess://quic+tls:${UUID}-0@quic.example.com:443?type=wechat-video&security=none&key=seed#QUIC`)).toThrow(
      "不支持的 VMess 传输层"
    );

    expect(parseVMess(`vmess1://${UUID}@kit.example.com:443?network=tcp`)).toMatchObject({
      name: "kit.example.com:443",
      network: "tcp",
    });
  });

  it("covers VLESS shadowrocket, header, and transport fallback branches", () => {
    expect(parseVLESS(`vless://${b64url(`${UUID}@sr.example.com:443`)}?obfs=http&obfsParam=${encodeURIComponent('{"Host":"front.example.com"}')}&tls=1#SR`)).toMatchObject({
      name: "SR",
      network: "http",
      "http-opts": {
        headers: { Host: ['{"Host":"front.example.com"}'] },
      },
    });

    expect(parseVLESS(`vless://${UUID}@grpc.example.com:443?type=grpc&path=/svc&mode=multi&authority=auth.example.com#GRPC`)).toMatchObject({
      network: "grpc",
      "grpc-opts": {
        "grpc-service-name": "svc",
        _grpcType: "multi",
        _grpcAuthority: "auth.example.com",
      },
    });

    expect(parseVLESS(`vless://${UUID}@tcp.example.com:443?type=none&security=tls&allow-insecure=off#TCP`)).toMatchObject({
      name: "TCP",
      network: "tcp",
      tls: true,
    });

    expect(() => parseVLESS("vless://not-base64?type=ws")).toThrow();
    expect(() => parseVLESS(`vless://${UUID}@bad.example.com:0`)).toThrow("无效的端口号");
  });
});
