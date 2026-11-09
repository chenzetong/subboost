import { describe, expect, it } from "vitest";
import { generateClashConfig } from "@subboost/core/generator";
import {
  applyCommonNodeParams,
  applyTransport,
} from "@subboost/core/parser/config-line-tokenizer";
import { parseHttp, parseSimpleProxy } from "@subboost/core/parser/protocols/simple-proxy";
import { parseVMess } from "@subboost/core/parser/protocols/vmess";
import { preprocessSubscriptionContent } from "@subboost/core/parser/preprocess";
import {
  formatParseSegmentError,
  parseLineBasedSubscriptionContent,
  splitNodeLinkSegments,
} from "@subboost/core/parser/content-parsers";
import {
  mergeParsedSourceNodes,
  prepareSourceParsedNodes,
} from "@subboost/core/subscription/source-node-refresh";
import { ORIGIN_NAME_KEY, SOURCE_IDS_KEY } from "@subboost/core/subscription/node-source-state";
import type { ParsedNode } from "@subboost/core/types/node";

const UUID = "11111111-1111-4111-8111-111111111111";

function b64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function ssNode(name: string, patch: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "ss",
    server: `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "node"}.example.com`,
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
    ...patch,
  } as unknown as ParsedNode;
}

describe("public core last reachable branch coverage", () => {
  it("covers config-line shared fallback branches through real node option inputs", () => {
    const vmessCommon: Record<string, unknown> = { type: "vmess" };
    applyCommonNodeParams(vmessCommon, {
      peer: "peer.example.com",
      tls_pubkey_sha256: "pubkey-sha256",
    });
    expect(vmessCommon).toMatchObject({
      servername: "peer.example.com",
      "tls-pubkey-sha256": "pubkey-sha256",
    });

    expect(() => applyTransport({}, { transport: " " })).toThrow("transport=(empty)");

    const grpcNode: Record<string, unknown> = {};
    applyTransport(grpcNode, { transport: "grpc", path: "/svc" });
    expect(grpcNode).toEqual({
      network: "grpc",
      "grpc-opts": { "grpc-service-name": "svc" },
    });

    const httpNode: Record<string, unknown> = {};
    applyTransport(httpNode, { transport: "http", method: " ", path: " , ", host: " , " });
    expect(httpNode).toEqual({
      network: "http",
      "http-opts": {
        method: "GET",
        path: ["/"],
        headers: { Host: [" , "] },
      },
    });

    const xhttpNode: Record<string, unknown> = {};
    applyTransport(
      xhttpNode,
      {
        transport: "xhttp",
        path: "/x",
        "download-headers": "NoColon",
        "sc-max-each-post-bytes": "bad",
      },
      { allowedTransports: ["xhttp"] },
    );
    expect(xhttpNode).toEqual({
      network: "xhttp",
      "xhttp-opts": { path: "/x" },
    });
  });

  it("covers simple proxy query, auth, and bracketed host fallbacks", () => {
    expect(parseHttp(`http://${b64("base-user:base-pass@b64-no-hash.example.com:8080")}?remarks=QueryOnly`)).toMatchObject({
      name: "QueryOnly",
      username: "base-user",
      password: "base-pass",
    });
    expect(parseHttp(`http://${b64("b64-hash.example.com:8080")}?remark=QueryName#HashName`)).toMatchObject({
      name: "HashName",
      server: "b64-hash.example.com",
    });
    expect(parseHttp("http://space-bool.example.com?skip-cert-verify=%20")).toMatchObject({
      name: "HTTP-space-bool.example.com:80",
    });
    expect(parseSimpleProxy("user@[2001:db8::13]:80{IPv6Port}", "http")).toMatchObject({
      name: "IPv6Port",
      server: "2001:db8::13",
      port: 80,
      username: "user",
    });
    expect(parseSimpleProxy("user@[2001:db8::14]:bad{BadPortDefault}", "http")).toMatchObject({
      name: "BadPortDefault",
      server: "2001:db8::14",
      port: 80,
    });
    expect(parseSimpleProxy("user@bad-port.example.com:bad{FallbackPort}", "http")).toMatchObject({
      name: "FallbackPort",
      server: "bad-port.example.com",
      port: 80,
    });
  });

  it("covers VMess style fallbacks that remain visible through the public parser", () => {
    expect(() => parseVMess(`vmess://${b64(`auto:${UUID}@sr-no-query.example.com:443`)}`)).toThrow(
      "无效的 VMess JSON 格式",
    );
    expect(() => parseVMess(`vmess://${b64("bad-shadowrocket")}?remarks=Bad`)).toThrow(
      "VMess 配置缺少必要字段",
    );
    expect(
      parseVMess(
        `vmess://${b64(
          JSON.stringify({
            ps: "Blank Network",
            add: "blank-network.example.com",
            port: 443,
            id: UUID,
            net: " ",
          }),
        )}`,
      ),
    ).toMatchObject({ network: "tcp" });

    expect(
      parseVMess(
        `vmess://${b64(
          JSON.stringify({
            ps: "Object Network",
            add: "object-network.example.com",
            port: 443,
            id: UUID,
            net: { raw: "ws" },
          }),
        )}`,
      ),
    ).toMatchObject({
      network: "tcp",
    });
  });

  it("covers preprocess extraction branches before the first included section", () => {
    const result = preprocessSubscriptionContent(
      [
        "# comment before proxy sections",
        "ignored=true",
        "[Proxy]",
        "Node = http, proxy.example.com, 80",
        "[General]",
        "skip=true",
      ].join("\n"),
    );

    expect(result).toMatchObject({
      applied: ["full-config"],
      errors: [],
      content: "[Proxy]\nNode = http, proxy.example.com, 80",
    });
  });

  it("keeps line-based parser behavior for sparse pipe segments and non-Error formatting", () => {
    expect(splitNodeLinkSegments("ss://single|\n# comment\n")).toEqual(["ss://single|"]);
    expect(formatParseSegmentError("bad-segment", "not an Error")).toBe(
      "解析失败: bad-segment... - 未知错误",
    );

    const result = parseLineBasedSubscriptionContent([
      "# ignored by the splitter",
      "not-a-real-node",
      `http://${b64("user:pass@line-http.example.com:8080")}?remarks=LineHTTP`,
    ].join("\n"));

    expect(result.nodes).toEqual([expect.objectContaining({ name: "LineHTTP" })]);
    expect(result.errors).toEqual([]);
    expect(result.totalParsed).toBe(1);
    expect(result.totalFailed).toBe(0);
  });

  it("preserves global client fingerprints without mutating generated nodes", () => {
    const config = generateClashConfig({
      nodes: [
        {
          name: "TLS VMess",
          type: "vmess",
          server: "tls-vmess.example.com",
          port: 443,
          uuid: UUID,
          tls: true,
        } as ParsedNode,
        {
          name: "Plain VMess",
          type: "vmess",
          server: "plain-vmess.example.com",
          port: 80,
          uuid: UUID,
          tls: false,
        } as ParsedNode,
      ],
      userConfig: {
        dnsYaml: "global-client-fingerprint: chrome",
      },
    });

    expect(config["global-client-fingerprint"]).toBe("chrome");
    expect(config.proxies?.find((node) => node.name === "TLS VMess")).toMatchObject({
      "client-fingerprint": "chrome",
    });
    expect(config.proxies?.find((node) => node.name === "Plain VMess")).not.toHaveProperty("client-fingerprint");
  });

  it("keeps source refresh behavior for sparse deleted names and blank fresh origins", () => {
    const prepared = prepareSourceParsedNodes(
      [
        ssNode("Prepared Origin", {
          [SOURCE_IDS_KEY]: ["old"],
          _favorite: true,
        }),
      ],
      { currentTag: "new", currentNameTemplate: "[{tag}] {name}" },
    );
    expect(prepared[0]).toMatchObject({
      name: "[new] Prepared Origin",
      [ORIGIN_NAME_KEY]: "Prepared Origin",
    });

    const result = mergeParsedSourceNodes(
      [
        ssNode("123", {
          [ORIGIN_NAME_KEY]: "Numeric Origin",
          [SOURCE_IDS_KEY]: ["src"],
        }),
        ssNode("  ", {
          [SOURCE_IDS_KEY]: ["src"],
        }),
      ],
      [
        { ...ssNode("Numeric Origin"), [ORIGIN_NAME_KEY]: "Numeric Origin" } as unknown as ParsedNode,
        ssNode("   "),
      ],
      ["  ", "missing"],
      {
        sourceId: "src",
        lastTag: "old",
        lastNameTemplate: "[{tag}] {name}",
        smartNodeMatchingEnabled: true,
      },
    );

    expect(result.nodes.map((node) => node.name)).toEqual(["123", "未命名节点"]);
    expect(result.nodes[0]).toMatchObject({
      server: "numeric-origin.example.com",
      [ORIGIN_NAME_KEY]: "Numeric Origin",
      [SOURCE_IDS_KEY]: ["src"],
    });
  });
});
