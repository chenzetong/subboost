import { beforeEach, describe, expect, it } from "vitest";
import {
  createHarness,
  getSourceActionMocks,
  node,
  parseResult,
  resetSourceActionMocks,
  source,
} from "../../../packages/ui/src/store/config-store/source-actions.test-utils";

const mocks = getSourceActionMocks();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsync() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("source import operation cancellation", () => {
  beforeEach(resetSourceActionMocks);

  it("clears a source parsing flag when starting a batch import", async () => {
    mocks.parseSubscription.mockReturnValueOnce(parseResult([]));
    const { actions, getState } = createHarness({
      sources: [
        source({ id: "pending", type: "yaml", content: "proxies: []", parsing: true }),
      ],
    });

    await actions.parseMultipleSources(getState().sources);

    expect(getState().sources[0]).toMatchObject({ id: "pending", parsing: false });
  });

  it("lets a newer batch own loading state when an older request finishes first", async () => {
    const first = deferred<{
      content: string;
      headers: Record<string, string>;
      parseResult: ReturnType<typeof parseResult>;
    }>();
    const second = deferred<{
      content: string;
      headers: Record<string, string>;
      parseResult: ReturnType<typeof parseResult>;
    }>();
    mocks.fetchUrlContentInBrowser
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { actions, getState } = createHarness({
      sources: [source({ id: "url", type: "url", content: "https://example.test/sub" })],
    });

    const older = actions.parseMultipleSources(getState().sources);
    await flushAsync();
    const newer = actions.parseMultipleSources(getState().sources);
    await flushAsync();

    first.resolve({ content: "old", headers: {}, parseResult: parseResult([node("Old")]) });
    await older;
    expect(getState().isLoading).toBe(true);

    second.resolve({ content: "new", headers: {}, parseResult: parseResult([node("New")]) });
    await newer;
    expect(getState().isLoading).toBe(false);
    expect(getState().nodes).toEqual([expect.objectContaining({ name: "New" })]);
  });

  it("uses cached deleted-node identity when the explicit origin is blank", async () => {
    const deleted = node("Deleted", { server: "deleted.example.test" });
    mocks.parseSubscription.mockReturnValueOnce(parseResult([deleted]));
    const { actions, getState } = createHarness({
      deletedNodes: [{ originName: "", name: "Deleted", node: deleted }],
      sources: [source({ id: "yaml", type: "yaml", content: "proxies: []" })],
    });

    await actions.parseMultipleSources(getState().sources);

    expect(getState().nodes).toEqual([]);
  });
});
