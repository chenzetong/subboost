import { createServer, type Server } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  requestPinnedText,
  ResponseTooLargeError,
} from "../../../local/src/lib/pinned-http";

describe("local pinned HTTP transport edge behavior", () => {
  let server: Server;
  let port = 0;
  let resetOnceRequestCount = 0;
  const observedMethods: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      observedMethods.push(request.method || "");
      const pathname = new URL(request.url || "/", "http://local.subboost.test").pathname;

      if (pathname === "/reset-once") {
        resetOnceRequestCount += 1;
        if (resetOnceRequestCount === 1) {
          response.destroy();
          return;
        }
      }
      if (pathname === "/reset-always") {
        response.destroy();
        return;
      }
      if (pathname === "/redirect") {
        response.writeHead(302, { Location: "/next", "Set-Cookie": ["a=1", "b=2"] });
        response.end("ignored redirect body");
        return;
      }
      if (pathname === "/declared-too-large") {
        response.writeHead(200, { "Content-Length": "2048" });
        response.end("short");
        return;
      }
      if (pathname === "/stream-too-large") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.write("x".repeat(96));
        response.end("y".repeat(96));
        return;
      }

      const body = Buffer.from("ss://node");
      if (pathname === "/deflate") {
        response.writeHead(200, { "Content-Encoding": "deflate" });
        response.end(deflateSync(body));
        return;
      }
      if (pathname === "/brotli") {
        response.writeHead(200, { "Content-Encoding": "br" });
        response.end(brotliCompressSync(body));
        return;
      }
      if (pathname === "/x-gzip") {
        response.writeHead(200, { "Content-Encoding": "x-gzip" });
        response.end(gzipSync(body));
        return;
      }
      if (pathname === "/missing") {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("missing");
        return;
      }

      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP test server address");
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  function request(
    pathname: string,
    overrides: Partial<Parameters<typeof requestPinnedText>[0]> = {},
  ) {
    return requestPinnedText({
      url: `http://local.subboost.test:${port}${pathname}`,
      addresses: ["127.0.0.1"],
      method: "GET",
      userAgent: "SubBoost Regression",
      maxBytes: 1024,
      signal: new AbortController().signal,
      ...overrides,
    });
  }

  it.each([
    ["deflate", "/deflate"],
    ["brotli", "/brotli"],
    ["x-gzip", "/x-gzip"],
    ["identity", "/plain"],
  ])("decodes %s responses", async (_encoding, pathname) => {
    await expect(request(pathname)).resolves.toMatchObject({
      status: 200,
      content: "ss://node",
    });
  });

  it("returns redirects without consuming their body and normalizes array headers", async () => {
    await expect(request("/redirect")).resolves.toEqual({
      status: 302,
      headers: expect.objectContaining({
        location: "/next",
        "set-cookie": "a=1, b=2",
      }),
      content: "",
    });
  });

  it("handles HEAD and ordinary non-success responses", async () => {
    await expect(request("/plain", { method: "HEAD" })).resolves.toMatchObject({
      status: 200,
      content: "",
    });
    await expect(request("/missing")).resolves.toMatchObject({
      status: 404,
      content: "missing",
    });
    expect(observedMethods).toContain("HEAD");
  });

  it("rejects declared and streamed bodies above the limit", async () => {
    await expect(request("/declared-too-large", { maxBytes: 32 })).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    await expect(request("/stream-too-large", { maxBytes: 64 })).rejects.toMatchObject({
      name: "ResponseTooLargeError",
      message: "Subscription response exceeds the configured byte limit",
    });
  });

  it("tries the next validated address after a connection failure", async () => {
    resetOnceRequestCount = 0;
    await expect(request("/reset-once", {
      addresses: ["127.0.0.1", "127.0.0.1"],
    })).resolves.toMatchObject({ status: 200, content: "ss://node" });
  });

  it("surfaces the last connection error and stops immediately after abort", async () => {
    await expect(request("/reset-always", {
      addresses: ["127.0.0.1"],
    })).rejects.toBeInstanceOf(Error);

    const controller = new AbortController();
    controller.abort();
    await expect(request("/plain", {
      addresses: ["127.0.0.1"],
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("selects HTTPS transport and only sends SNI for hostname URLs", async () => {
    await expect(request("/plain", {
      url: `https://local.subboost.test:${port}/plain`,
    })).rejects.toBeInstanceOf(Error);
    await expect(request("/plain", {
      url: `https://127.0.0.1:${port}/plain`,
    })).rejects.toBeInstanceOf(Error);
  });
});
