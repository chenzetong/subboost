import { describe, expect, it } from "vitest";
import { parseAnyTLS } from "../../../packages/core/src/parser/protocols/anytls";
import { parseHysteria } from "../../../packages/core/src/parser/protocols/hysteria";
import { parseHysteria2 } from "../../../packages/core/src/parser/protocols/hysteria2";
import { parseSnell } from "../../../packages/core/src/parser/protocols/snell";
import { parseSS } from "../../../packages/core/src/parser/protocols/ss";
import { parseSSR } from "../../../packages/core/src/parser/protocols/ssr";
import { parseTrojan } from "../../../packages/core/src/parser/protocols/trojan";
import { parseTuic } from "../../../packages/core/src/parser/protocols/tuic";
import { parseVLESS } from "../../../packages/core/src/parser/protocols/vless";
import { parseVMess } from "../../../packages/core/src/parser/protocols/vmess";
import { parseWireGuard } from "../../../packages/core/src/parser/protocols/wireguard";

const UUID = "11111111-1111-4111-8111-111111111111";

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("core protocol edge regressions", () => {
  it("parses AnyTLS authority, encoded-userinfo, and query credential fallbacks", () => {
    expect(parseAnyTLS("anytls://secret@slash.example.com:443/?udp=maybe&alpn=,,#Slash")).toMatchObject({
      name: "Slash",
      server: "slash.example.com",
      password: "secret",
      udp: true,
    });

    const encoded = b64("secret@encoded.example.com:443");
    expect(parseAnyTLS(`anytls://${encoded}?idleSessionCheckInterval=bad&idle-session-check-interval=12`)).toMatchObject({
      server: "encoded.example.com",
      password: "secret",
      "idle-session-check-interval": 12,
    });

    expect(parseAnyTLS("anytls://query.example.com:8443?password=query-secret&remark=Query")).toMatchObject({
      name: "Query",
      password: "query-secret",
      sni: "query.example.com",
    });
    expect(() => parseAnyTLS("anytls://?password=secret")).toThrow();
    expect(() => parseAnyTLS("anytls://not-a-token")).toThrow();
  });

  it("parses TUIC token and query UUID forms with sparse aliases", () => {
    expect(parseTuic("tuic://opaque-token@token.example.com?alpn=,,#Token")).toMatchObject({
      name: "Token",
      token: "opaque-token",
      port: 443,
    });

    expect(
      parseTuic(
        `tuic://not-a-uuid@query.example.com:443?uuid=${UUID}&password=pw&congestion_control=%20&congestion-control=bbr&request-timeout=bad&request_timeout=12`,
      ),
    ).toMatchObject({
      uuid: UUID,
      password: "pw",
      "congestion-controller": "bbr",
      "request-timeout": 12,
    });
    expect(() => parseTuic("tuic://@missing.example.com:443")).toThrow(/缺少必要字段/);
  });

  it("keeps WireGuard query normalization and overrides observable", () => {
    const node = parseWireGuard(
      "wg://private@wg.example.com?=ignored&address=%2C10.0.0.2%2F32%2C%5B2001%3Adb8%3A%3A2%5D%2F128&udp=yes&privatekey=override&reserved=1%2C2%2C3#WG",
    );
    expect(node).toMatchObject({
      name: "WG",
      "private-key": "override",
      ip: "10.0.0.2",
      ipv6: "2001:db8::2",
      reserved: [1, 2, 3],
      udp: true,
    });
  });

  it("parses Snell credential pairs, defaults, and optional obfuscation fields", () => {
    expect(
      parseSnell(
        "snell://user:pass@snell.example.com?obfs=tls&obfs-host=cdn.example.com&obfs-uri=/path&udp-relay=false#Snell",
      ),
    ).toMatchObject({
      name: "Snell",
      port: 443,
      psk: "user:pass",
      udp: false,
      "obfs-opts": { mode: "tls", host: "cdn.example.com", path: "/path" },
    });
  });

  it("parses SSR flag-only query entries and empty query defaults", () => {
    const withFlag = b64(`flag.example.com:8388::::${b64("secret")}/?flag`);
    const withoutQuery = b64(`plain.example.com:8388::::${b64("secret")}`);
    expect(parseSSR(`ssr://${withFlag}`)).toMatchObject({
      server: "flag.example.com",
      password: "secret",
      protocol: "origin",
      cipher: "aes-256-cfb",
      obfs: "plain",
    });
    expect(parseSSR(`ssr://${withoutQuery}`)).toMatchObject({ server: "plain.example.com" });
    expect(() => parseSSR("ssr://")).toThrow(/无效的 SSR 链接/);
  });

  it("preserves Shadowsocks plugin aliases and boolean fallbacks", () => {
    const userInfo = b64("aes-128-gcm:secret");
    expect(
      parseSS(
        `ss://${userInfo}@ss.example.com:8388?plugin=v2ray-plugin%3Bobfs%3Dwebsocket%3Bobfs-host%3Dcdn.example.com%3Bpath%3D%2Fws%3Btls#SS`,
      ),
    ).toMatchObject({
      name: "SS",
      plugin: "v2ray-plugin",
      "plugin-opts": expect.objectContaining({ obfs: "websocket", "obfs-host": "cdn.example.com" }),
    });
    expect(parseSS(`ss://${b64("aes-128-gcm:secret@raw.example.com:8388")}`)).toMatchObject({
      server: "raw.example.com",
    });
  });

  it("covers VMess Quantumult transport defaults and malformed style probes", () => {
    const quantumHttp = b64(`Q = vmess,http.example.com,443,,${UUID},obfs=http,obfs-path=%2Fhttp`);
    expect(parseVMess(`vmess://${quantumHttp}`)).toMatchObject({
      name: "Q",
      network: "http",
      cipher: UUID,
    });

    expect(() => parseVMess("http://not-vmess.example.com")).toThrow(/无效的 VMess 链接/);
    expect(() => parseVMess("vmess1://broken")).toThrow(/无效的 Kitsunebi VMess 链接/);

    expect(
      parseVMess(
        `vmess://${b64(JSON.stringify({ ps: "Blank", add: "blank.example.com", port: 443, id: UUID, net: " " }))}`,
      ),
    ).toMatchObject({ network: "tcp" });
  });

  it("covers VLESS empty lists, Shadowrocket fallbacks, and xHTTP defaults", () => {
    expect(parseVLESS(`vless://${UUID}@plain-ws.example.com:443?type=ws&host=,,&path=%3Fed%3D64`)).toMatchObject({
      network: "ws",
      "ws-opts": expect.objectContaining({ path: "/", "max-early-data": 64 }),
    });
    expect(parseVLESS(`vless://${UUID}@h2-front.example.com:443?security=tls&type=h2&sni=front.example.com`)).toMatchObject({
      network: "h2",
      "h2-opts": { host: ["front.example.com"], path: "/" },
    });
    expect(parseVLESS(`vless://${UUID}@xhttp.example.com:443?security=tls&type=xhttp&path=&host=`)).toMatchObject({
      network: "xhttp",
      "xhttp-opts": expect.objectContaining({ path: "/" }),
    });

    const encoded = b64(`${UUID}@shadow.example.com:443`);
    expect(parseVLESS(`vless://${encoded}?obfs=websocket&obfsParam=Host%3Acdn.example.com&path=%2F#Shadow`)).toMatchObject({
      name: "Shadow",
      network: "ws",
      "ws-opts": { path: "/", headers: { Host: "Host:cdn.example.com" } },
    });
  });

  it("keeps Hysteria, Hysteria2, and Trojan optional-list behavior explicit", () => {
    expect(parseHysteria("hy://hy.example.com?auth=secret&fast-open=false&alpn=,,")).toMatchObject({
      "auth-str": "secret",
      "fast-open": false,
    });
    expect(parseHysteria2("hy2://secret@hy2.example.com:443?obfs=salamander&obfs-password=mask&ports=%20")).toMatchObject({
      password: "secret",
      obfs: "salamander",
      "obfs-password": "mask",
    });
    expect(parseTrojan("trojan://user:pass@trojan.example.com:443?alpn=,,&allowInsecure=yes")).toMatchObject({
      password: "user:pass",
      "skip-cert-verify": true,
    });
  });
});
