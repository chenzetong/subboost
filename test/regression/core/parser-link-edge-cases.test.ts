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
  it("covers real protocol link edge branches for VLESS, VMess, SSR, and simple proxies", () => {
    const shadowrocketVlessBase = b64(`cipher:${UUID}@sr-vless.example.com:443`);
    expect(
      parseVLESS(
        `vless://${shadowrocketVlessBase}?tls=1&obfs=websocket&obfsParam=${encodeURIComponent(
          JSON.stringify({ Host: "sr.example.com" }),
        )}&path=/sr#SR`,
      ),
    ).toMatchObject({
      name: "SR",
      network: "ws",
      "ws-opts": { headers: { Host: "sr.example.com" } },
    });
    expect(
      parseVLESS(
        `vless://${shadowrocketVlessBase}?tls=1&xtls=2&obfs=websocket&obfsParam=${encodeURIComponent(
          JSON.stringify({ Nested: { Host: "sr.example.com" } }),
        )}&path=/json-object#SRObject`,
      ),
    ).toMatchObject({
      flow: "xtls-rprx-vision",
      "ws-opts": { path: "/json-object", headers: { Host: "{\"Nested\":{\"Host\":\"sr.example.com\"}}" } },
    });
    expect(
      parseVLESS(
        `vless://${UUID}@xhttp.example.com:443?type=xhttp&xhttpHeaders=${encodeURIComponent(
          "NoColon|AlsoBad:",
        )}&noGrpcHeader=off&scMaxEachPostBytes=1024&downloadHeaders=Host: dl.example.com#XHTTP`,
      ),
    ).toMatchObject({
      network: "xhttp",
      "xhttp-opts": {
        path: "/",
        "no-grpc-header": false,
        "sc-max-each-post-bytes": 1024,
        "download-settings": { headers: { Host: "dl.example.com" } },
      },
    });
    expect(
      parseVLESS(
        `vless://${UUID}@xhttp-json.example.com:443?type=xhttp&xhttpHeaders=${encodeURIComponent(
          JSON.stringify({ Nested: { Host: "xhttp.example.com" } }),
        )}&xhttpHost=x.example.com&path=/x#XHTTPJson`,
      ),
    ).toMatchObject({
      network: "xhttp",
      "xhttp-opts": { path: "/x", host: "x.example.com" },
    });
    expect(
      parseVLESS(`vless://${UUID}@front.example.com:443?type=http&security=tls&sni=cdn.example.com&method=%20&host=%20#HTTP`),
    ).toMatchObject({
      network: "http",
      "http-opts": { method: "GET", path: ["/"], headers: { Host: ["cdn.example.com"] } },
    });
    expect(
      parseVLESS(`vless://${UUID}@front-h2.example.com:443?type=h2&security=tls&sni=cdn.example.com#H2`),
    ).toMatchObject({
      network: "h2",
      "h2-opts": { host: ["cdn.example.com"], path: "/" },
    });
    expect(() => parseVLESS(`vless://${UUID}@empty-type.example.com:443?type=%20#Bad`)).toThrow(
      "不支持的 VLESS 传输层",
    );

    expect(parseVMess(`vmess://${UUID}@uri.example.com:443#UriOnly`)).toMatchObject({
      name: "UriOnly",
      network: "tcp",
      port: 443,
    });
    expect(() => parseVMess(`vmess://${b64(`auto:${UUID}@shadow.example.com:443`)}#NoQuery`)).toThrow(
      "无效的 VMess JSON 格式",
    );
    expect(() => parseVMess(`vmess://tcp:${UUID}-0@std-bad.example.com:443/path-without-query`)).toThrow(
      "无效的标准 VMess 链接",
    );
    expect(() => parseVMess("vmess1://not-enough")).toThrow("无效的 Kitsunebi VMess 链接");
    expect(() =>
      parseVMess(`vmess://quic+tls:${UUID}-0@quic.example.com:443?security=none&type=utp&key=secret#Quic`),
    ).toThrow("不支持的 VMess 传输层");
    expect(
      parseVMess(
        `vmess://${b64(
          [
            "Quantum = vmess",
            "quantum.example.com",
            "443",
            "auto",
            `"${UUID}"`,
            "obfs=wss",
            "obfs-header=Host: ws.example.com",
            "obfs-path=/q",
            "tls-verification=false",
          ].join(","),
        )}`,
      ),
    ).toMatchObject({
      name: "Quantum",
      cipher: "auto",
      network: "ws",
      "skip-cert-verify": true,
    });
    expect(
      parseVMess(
        `vmess://${b64(
          JSON.stringify({
            ps: "Empty Net",
            add: "empty-net.example.com",
            port: 443,
            id: UUID,
            aid: 0,
            net: "",
          }),
        )}`,
      ),
    ).toMatchObject({
      network: "tcp",
      tls: false,
    });
    expect(() =>
      parseVMess(
        `vmess://${b64(
          JSON.stringify({
            ps: "ECH without TLS",
            add: "ech-no-tls.example.com",
            port: 443,
            id: UUID,
            net: "ws",
            ech: "config",
          }),
        )}`,
      ),
    ).toThrow("VMess 启用 ECH 需要 TLS");
    expect(() =>
      parseVMess(
        `vmess://${b64(
          JSON.stringify({
            ps: "Unsupported",
            add: "unsupported.example.com",
            port: 443,
            id: UUID,
            net: "quic",
          }),
        )}`,
      ),
    ).toThrow("不支持的 VMess 传输层");

    expect(parseSSR(ssr("[2001:db8::1]:443::::" + b64("pw"), `emptyFlag&remarks=${b64("PlainName")}`))).toMatchObject({
      name: "PlainName",
      server: "2001:db8::1",
      cipher: "aes-256-cfb",
      protocol: "origin",
      obfs: "plain",
    });

    expect(parseSimpleProxy("http://dXNlcjpwYXNzQGJhc2UuZXhhbXBsZS5jb206ODA=?remarks=BaseName")).toMatchObject({
      name: "BaseName",
      username: "user",
      password: "pass",
      server: "base.example.com",
    });
    const httpWithIgnoredJsonHeaders = parseSimpleProxy(
      `https://edge.example.com:443?tls-verification=false&headers=${encodeURIComponent(
        JSON.stringify({ Nested: { Host: "edge.example.com" } }),
      )}`,
    );
    expect(httpWithIgnoredJsonHeaders).toMatchObject({
      "skip-cert-verify": true,
    });
    expect("headers" in httpWithIgnoredJsonHeaders).toBe(false);
    expect(parseSocks(`socks5://${b64("encoded:secret")}@socks.example.com:1080?udp=off#SocksAuth`)).toMatchObject({
      name: "SocksAuth",
      username: "encoded",
      password: "secret",
      udp: false,
    });
    expect(parseSsh("ssh://root:ssh-pass@ssh.example.com:22?host-key=sha1|sha2&idle-timeout=30")).toMatchObject({
      username: "root",
      password: "ssh-pass",
      "host-key": ["sha1", "sha2"],
      "idle-timeout": 30,
    });
    expect(parseSimpleProxy("user-only@[2001:db8::2]:8080{IPv6 Naked}")).toMatchObject({
      name: "IPv6 Naked",
      server: "2001:db8::2",
      port: 8080,
      username: "user-only",
    });
    expect(parseTelegramProxyLink("https://t.me/https?server=tg.example.com&port=443&remark=Telegram")).toMatchObject({
      name: "Telegram",
      type: "https",
      tls: true,
    });
  });

  it("canonicalizes aliases and parses line-based registry fallbacks", () => {
    expect(pickAliasValue({ nested: "nope" }, [["nested", "missing"]])).toBeUndefined();
    expect(
      canonicalizeParsedNode({
        type: "vless",
        publicKey: "pub",
        shortId: "1234",
        packetEncoding: "xudp",
        allowInsecure: "yes",
        "tls-verification": "true",
        "grpc-opts": "not-object",
        serviceName: "svc",
      } as never),
    ).toMatchObject({
      type: "vless",
      "reality-opts": { "public-key": "pub", "short-id": "1234" },
      "packet-encoding": "xudp",
      "skip-cert-verify": "yes",
      "grpc-opts": { "grpc-service-name": "svc" },
    });
    expect(
      canonicalizeParsedNode({
        type: 123,
        "tls-verification": false,
        insecure: "",
      } as never),
    ).toMatchObject({ "skip-cert-verify": true });

    expect(splitNodeLinkSegments("ss://a|ss://b\nsingle|not-a-link\n#comment\n")).toEqual([
      "ss://a",
      "ss://b",
      "single|not-a-link",
    ]);
    expect(parseLineBasedSubscriptionContent("# only comment\n\n")).toMatchObject({
      nodes: [],
      errors: [],
    });
    expect(parseSubscriptionContentByRegistry("vmess://%%%")).toMatchObject({
      nodes: [],
      errors: [expect.stringContaining("解析失败")],
      totalFailed: 1,
    });
  });
});
