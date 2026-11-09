import { describe, expect, it, vi } from "vitest";
import type { ParsedNode } from "@subboost/core/types/node";
import {
  readJsonResponse,
  readSourceImportResponse,
} from "@subboost/ui/product/client-response";
import { buildSourceDisplayLabel } from "@subboost/ui/product/converter/source-display-label";
import {
  ensureNodesHaveValidSourceIds,
  getNodeSourceIds,
} from "@subboost/ui/product/home/editing-subscription-node-sources";
import { isCleanNewSubscriptionIntent } from "@subboost/ui/product/subscription/home-url-intent";
import {
  isSourcePendingImport,
  markSourceAsPendingImport,
} from "@subboost/ui/product/subscription/source-import-state";
import { getSubscriptionUserInfoDisplay } from "@subboost/ui/product/subscription/subscription-userinfo-display";

function node(name: string): ParsedNode {
  return {
    name,
    type: "ss",
    server: `${name.toLowerCase()}.example.test`,
    port: 443,
    cipher: "aes-128-gcm",
    password: "test-only",
  } as unknown as ParsedNode;
}

describe("small UI state helper regressions", () => {
  it("treats rejected response text and missing structured errors as empty payloads", async () => {
    const unreadable = {
      ok: true,
      text: vi.fn(async () => {
        throw new Error("body unavailable");
      }),
    } as unknown as Response;
    await expect(readJsonResponse<Record<string, never>>(unreadable)).resolves.toEqual({});

    const failed = {
      ok: false,
      text: vi.fn(async () => JSON.stringify({ errorInfo: null, error: "" })),
    } as unknown as Response;
    await expect(readSourceImportResponse(failed, "safe fallback")).rejects.toThrow("safe fallback");
  });

  it("normalizes non-string labels and non-finite source positions", () => {
    expect(
      buildSourceDisplayLabel({
        typeLabel: null as never,
        tag: 7 as never,
        order: Number.POSITIVE_INFINITY,
        total: Number.NaN,
      })
    ).toBe("导入源");
    expect(
      buildSourceDisplayLabel({
        typeLabel: "URL",
        order: -5,
        total: 2,
      })
    ).toBe("URL #1");
  });

  it("does not assign blank or absent URL source ids to unmatched nodes", () => {
    const blankIdNode = node("Blank");
    const noUrlNode = node("Inline");

    const blankIdResult = ensureNodesHaveValidSourceIds(
      [blankIdNode],
      [{ id: " ", type: "url", content: "https://example.test/sub" } as never]
    );
    expect(blankIdResult[0]).toBe(blankIdNode);
    expect(getNodeSourceIds(blankIdResult[0])).toEqual([]);

    const noUrlResult = ensureNodesHaveValidSourceIds(
      [noUrlNode],
      [{ id: "inline", type: "yaml", content: "" } as never]
    );
    expect(noUrlResult[0]).toBe(noUrlNode);
    expect(getNodeSourceIds(noUrlResult[0])).toEqual([]);
  });

  it("requires the clean-new marker and rejects an editing id", () => {
    expect(isCleanNewSubscriptionIntent(new URLSearchParams("newSubscription=1"))).toBe(true);
    expect(isCleanNewSubscriptionIntent(new URLSearchParams("newSubscription=0"))).toBe(false);
    expect(
      isCleanNewSubscriptionIntent(
        new URLSearchParams("newSubscription=1&editSubscriptionId=existing")
      )
    ).toBe(false);
  });

  it("handles invalid URL-like source values and non-string metadata", () => {
    const invalidUrl = {
      id: "invalid-url",
      type: "url",
      content: "not a url",
      parsed: true,
      parsing: false,
      lastParsedContent: "another invalid url",
      lastParsedTag: "tag",
      tag: 7,
      lastParsedNameTemplate: "template",
      nameTemplate: 9,
    } as never;
    expect(isSourcePendingImport(invalidUrl)).toBe(true);

    const emptyNonString = {
      id: "empty",
      type: "yaml",
      content: null,
      parsed: true,
      parsing: false,
    } as never;
    expect(isSourcePendingImport(emptyNonString)).toBe(false);
    expect(
      markSourceAsPendingImport({
        ...emptyNonString,
        parsed: false,
        nodeCount: undefined,
        subscriptionUserInfo: undefined,
        error: undefined,
        errorInfo: undefined,
      })
    ).toBeTypeOf("object");
  });

  it("formats large traffic values across whole-unit and maximum-unit boundaries", () => {
    expect(
      getSubscriptionUserInfoDisplay({
        upload: 100 * 1024,
        download: 0,
        total: 200 * 1024,
      })
    ).toEqual({ traffic: "100 KB/200 KB", expire: null });

    const enormous = 1024 ** 7;
    const display = getSubscriptionUserInfoDisplay({ upload: enormous, total: enormous * 2 });
    expect(display.traffic).toContain("PB");
  });
});
