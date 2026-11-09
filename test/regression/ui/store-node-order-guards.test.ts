import { describe, expect, it, vi } from "vitest";

import type { ParsedNode } from "@subboost/core/types/node";
import { createNodeActions } from "@subboost/ui/store/config-store/actions/node-actions";
import { initialState } from "@subboost/ui/store/config-store/definitions";
import type { StoreState } from "@subboost/ui/store/config-store/store-types";

const node = (name: string) =>
  ({
    name,
    type: "ss",
    server: `${name.toLowerCase()}.example.test`,
    port: 443,
    cipher: "aes-128-gcm",
    password: "secret",
  }) as ParsedNode;

function createHarness(nodes = [node("A"), node("B")]) {
  let state = {
    ...structuredClone(initialState),
    nodes,
  } as StoreState;

  const set = vi.fn((next: Partial<StoreState> | ((current: StoreState) => Partial<StoreState>)) => {
    const patch = typeof next === "function" ? next(state) : next;
    state = { ...state, ...patch };
  });

  const setAndGenerateConfig = vi.fn((update: (current: StoreState) => Partial<StoreState>) => {
    state = { ...state, ...update(state) };
  });

  const actions = createNodeActions(set, () => state, setAndGenerateConfig);

  return {
    actions,
    getState: () => state,
  };
}

describe("node ordering guards", () => {
  it("ignores a scoped reorder when the requested node is absent", () => {
    const harness = createHarness();
    const before = harness.getState().nodes;

    harness.actions.setNodeOrder("missing", 1, ["missing"]);

    expect(harness.getState().nodes).toBe(before);
  });

  it("does not rewrite state when a scoped node already occupies the target slot", () => {
    const harness = createHarness();
    const before = harness.getState().nodes;

    harness.actions.setNodeOrder("A", 0, ["A", "B"]);

    expect(harness.getState().nodes).toBe(before);
  });

  it("ignores rename requests that contain no valid string names", () => {
    const harness = createHarness();
    const before = harness.getState().nodes;

    harness.actions.bulkRenameNodes([
      null as never,
      { oldName: "", newName: "" },
      { oldName: 3 as never, newName: 4 as never },
    ]);

    expect(harness.getState().nodes).toBe(before);
  });
});
