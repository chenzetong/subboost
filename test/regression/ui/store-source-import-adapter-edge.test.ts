import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubscriptionImportErrorInfo,
  SubscriptionImportError,
} from "@subboost/core/subscription/import-error";

const mocks = vi.hoisted(() => ({
  importSource: vi.fn(),
}));

vi.mock("@subboost/ui/product/api-adapter", () => ({
  getActiveProductApiAdapter: () => ({
    sourceImport: { importSource: mocks.importSource },
  }),
}));

import { fetchUrlContentInBrowser } from "@subboost/ui/store/config-store/definitions";

describe("browser source import adapter edge payloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats null headers and malformed parse-result arrays as absent optional data", async () => {
    mocks.importSource.mockResolvedValueOnce({
      content: "remote content",
      headers: null,
      parseResult: {
        nodes: null,
        errors: null,
      },
    });

    await expect(fetchUrlContentInBrowser("https://example.test/sub")).resolves.toEqual({
      content: "remote content",
      headers: {},
      parseResult: undefined,
    });
  });

  it("preserves structured import errors from the product adapter", async () => {
    const error = new SubscriptionImportError(
      createSubscriptionImportErrorInfo({
        category: "security",
        message: "blocked destination",
        detail: "blocked destination",
      })
    );
    mocks.importSource.mockRejectedValueOnce(error);

    await expect(fetchUrlContentInBrowser("https://example.test/sub")).rejects.toBe(error);
  });
});
