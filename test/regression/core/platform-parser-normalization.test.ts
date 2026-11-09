import { beforeEach, describe, expect, it, vi } from "vitest";

const parserMocks = vi.hoisted(() => ({
  surge: vi.fn(),
  loon: vi.fn(),
  qx: vi.fn(),
}));

vi.mock("../../../packages/core/src/parser/platform/peggy/surge", () => ({
  default: () => ({ parse: parserMocks.surge }),
}));

vi.mock("../../../packages/core/src/parser/platform/peggy/loon", () => ({
  default: () => ({ parse: parserMocks.loon }),
}));

vi.mock("../../../packages/core/src/parser/platform/peggy/qx", () => ({
  default: () => ({ parse: parserMocks.qx }),
}));

async function parse(line: string, context?: unknown) {
  const mod = await import("../../../packages/core/src/parser/platform/parse-platform-proxy-line");
  return mod.parsePlatformProxyLine(line, context as never);
}

describe("platform parser normalization with controlled parser outputs", () => {
  beforeEach(() => {
    vi.resetModules();
    parserMocks.surge.mockReset();
    parserMocks.loon.mockReset();
    parserMocks.qx.mockReset();
  });

  it("falls through non-record parser outputs and validates core fields", async () => {
    parserMocks.surge.mockReturnValue("not-a-record");
    parserMocks.loon.mockImplementation(() => {
      throw new Error("not loon");
    });
    parserMocks.qx.mockReturnValue(["not", "a", "record"]);

    await expect(parse("Ignored = http, example.com, 80")).resolves.toBeNull();

    parserMocks.surge.mockReturnValue({ name: "No Type", server: "example.com", port: 80 });
    await expect(parse("No Type = http, example.com, 80")).rejects.toThrow("平台代理行缺少 type");

    parserMocks.surge.mockReturnValue({ type: "http", server: "example.com", port: 80 });
    await expect(parse("No Name = http, example.com, 80")).rejects.toThrow("surge 代理行缺少 name");
  });

  it("normalizes string ports, fingerprints, early data, and AnyTLS servername", async () => {
    parserMocks.surge.mockReturnValueOnce({
      name: "String Port",
      type: "http",
      server: "string-port.example.com",
      port: "8080",
    });
    await expect(parse("String Port = http, string-port.example.com, 8080")).resolves.toMatchObject({
      name: "String Port",
      type: "http",
      port: "8080",
    });

    parserMocks.surge.mockReturnValueOnce({
      name: "WS No Opts",
      type: "vmess",
      server: "ws-no-opts.example.com",
      port: 443,
      uuid: "11111111-1111-4111-8111-111111111111",
      network: "ws",
      "ws-opts": "not-an-object",
    });
    await expect(parse("WS No Opts = vmess, ws-no-opts.example.com, 443")).resolves.toMatchObject({
      name: "WS No Opts",
      network: "ws",
    });

    parserMocks.surge.mockReturnValueOnce({
      name: "WS Early",
      type: "vmess",
      server: "ws-early.example.com",
      port: 443,
      uuid: "11111111-1111-4111-8111-111111111111",
      network: "ws",
      "ws-opts": { path: "/ws?ed=128" },
    });
    await expect(parse("WS Early = vmess, ws-early.example.com, 443")).resolves.toMatchObject({
      "ws-opts": {
        path: "/ws",
        "early-data-header-name": "Sec-WebSocket-Protocol",
        "max-early-data": 128,
      },
    });

    parserMocks.surge.mockReturnValueOnce({
      name: "SSH Existing Fingerprint",
      type: "ssh",
      server: "ssh.example.com",
      port: 22,
      username: "root",
      "server-fingerprint": "old",
      "tls-fingerprint": "new",
    });
    await expect(parse("SSH Existing Fingerprint = ssh, ssh.example.com, 22")).resolves.toMatchObject({
      "server-fingerprint": "old",
    });

    parserMocks.surge.mockReturnValueOnce({
      name: "AnyTLS Servername",
      type: "anytls",
      server: "anytls.example.com",
      port: 443,
      password: "secret",
      servername: "front.example.com",
      "tls-fingerprint": "chrome",
    });
    await expect(parse("AnyTLS Servername = anytls, anytls.example.com, 443")).resolves.toMatchObject({
      type: "anytls",
      sni: "front.example.com",
      "client-fingerprint": "chrome",
    });

    parserMocks.surge.mockReturnValueOnce({
      name: "AnyTLS Reality",
      type: "anytls",
      server: "anytls.example.com",
      port: 443,
      password: "secret",
      security: "reality",
    });
    await expect(parse("AnyTLS Reality = anytls, anytls.example.com, 443")).rejects.toThrow("不支持 Reality");
  });

  it("keeps Surge WireGuard section fallback names observable", async () => {
    parserMocks.surge.mockReturnValue({
      name: "",
      type: "wireguard-surge",
      "section-name": "Office",
      server: "placeholder.example.com",
      port: 51820,
    });

    await expect(
      parse(" = wireguard, section-name=Office", {
        sections: new Map([
          [
            "WireGuard Office",
            [
              "private-key = private",
              'peer = (endpoint = "wg.example.com:51820", public-key = public)',
            ],
          ],
        ]),
      }),
    ).resolves.toMatchObject({
      name: "WireGuard-Office",
      type: "wireguard",
      server: "wg.example.com",
      port: 51820,
    });
  });
});
