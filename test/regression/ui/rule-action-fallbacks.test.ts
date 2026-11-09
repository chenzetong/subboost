import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialState } from "@subboost/ui/store/config-store/definitions";
import { createCustomActions } from "@subboost/ui/store/config-store/actions/custom-actions";
import {
  compactBuiltinRuleEdits,
  findBuiltinRuleEditKeyByTarget,
  retargetBuiltinRuleEdits,
  updateBuiltinRuleEdit,
} from "@subboost/ui/store/config-store/actions/proxy-group-rule-set-helpers";
import { createTemplateActions } from "@subboost/ui/store/config-store/actions/template-actions";

function createHarness(overrides: Record<string, unknown> = {}) {
  let state = { ...structuredClone(initialState), ...overrides } as any;
  const apply = (patch: any) => {
    if (patch && patch !== state) state = { ...state, ...patch };
  };
  const set = (partial: any) => apply(typeof partial === "function" ? partial(state) : partial);
  const setAndGenerateConfig = (updater: any) => apply(updater(state));
  return {
    custom: createCustomActions(set, () => state, setAndGenerateConfig),
    template: createTemplateActions(set, () => state, setAndGenerateConfig),
    getState: () => state,
  };
}

describe("rule-set helper defensive state", () => {
  it("compacts absent edits and removes invalid or explicitly reset targets", () => {
    expect(compactBuiltinRuleEdits(null as never)).toEqual({});
    expect(
      updateBuiltinRuleEdit(null as never, "module:select:rule", {
        target: null,
        enabled: true,
      })
    ).toEqual({});
    expect(retargetBuiltinRuleEdits(null as never, "Old", "New")).toBeNull();
  });

  it("skips malformed keys before returning the exact matching builtin rule", () => {
    const target = { kind: "custom", id: "group" } as const;
    const edits = {
      malformed: { target: "Legacy" },
      "other:group:rule": { target: "Legacy" },
      "module:group:other": { target: "Legacy" },
      "module:group:rule": { target: "Legacy" },
    } as never;

    expect(findBuiltinRuleEditKeyByTarget(null as never, target, "Legacy", "rule")).toBeNull();
    expect(findBuiltinRuleEditKeyByTarget(edits, target, "Legacy", "rule")).toBe(
      "module:group:rule"
    );
    expect(findBuiltinRuleEditKeyByTarget(edits, target, "", "rule")).toBeNull();
  });
});

describe("custom and template action fallback state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves state unchanged when deleting an absent custom group", () => {
    const harness = createHarness({
      customProxyGroups: [{ id: "keep", name: "Keep", emoji: "K", groupType: "select" }],
    });
    const before = harness.getState();

    harness.custom.removeCustomProxyGroup("missing");

    expect(harness.getState()).toBe(before);
  });

  it("removes matching legacy targets while preserving unrelated builtin edits", () => {
    const harness = createHarness({
      customProxyGroups: [{ id: "remove", name: "Legacy", emoji: "L", groupType: "select" }],
      customRules: [
        { id: "drop", type: "DOMAIN", value: "drop.test", target: "Legacy" },
        { id: "keep", type: "DOMAIN", value: "keep.test", target: "Other" },
      ],
      customRuleSets: [
        { id: "drop-set", name: "Drop", behavior: "domain", path: "geosite/drop", target: "Legacy" },
      ],
      builtinRuleEdits: {
        "module:select:drop": { target: "Legacy", enabled: false },
        "module:select:keep": { target: "Other", enabled: false },
      },
      groupListeners: [
        { id: "drop-listener", target: { kind: "custom", id: "remove" }, port: 41000 },
        { id: "keep-listener", target: { kind: "module", id: "select" }, port: 41001 },
      ],
    });

    harness.custom.removeCustomProxyGroup("remove");

    expect(harness.getState().customRules).toEqual([
      expect.objectContaining({ id: "keep", target: "Other" }),
    ]);
    expect(harness.getState().builtinRuleEdits).toEqual({
      "module:select:drop": { enabled: false },
      "module:select:keep": { target: "Other", enabled: false },
    });
    expect(harness.getState().groupListeners).toEqual([
      expect.objectContaining({ id: "keep-listener" }),
    ]);
  });

  it("renames a group without changing unrelated null-backed builtin edits", () => {
    const harness = createHarness({
      customProxyGroups: [{ id: "rename", name: "Old", emoji: "O", groupType: "select" }],
      builtinRuleEdits: null,
    });

    harness.custom.updateCustomProxyGroup("rename", { name: "New" });

    expect(harness.getState().customProxyGroups[0].name).toBe("New");
    expect(harness.getState().builtinRuleEdits).toBeNull();
  });

  it("uses existing template state when optional rule and advanced settings are absent", () => {
    const harness = createHarness({
      proxyGroupAdvanced: { select: { includeRegex: "Keep" } },
      proxyGroupNameOverrides: { select: "Keep name" },
      experimentalCnUseCnRuleSet: true,
      cnIpNoResolve: false,
      ruleOrder: ["module:select:rule"],
      enabledProxyGroups: ["select", "auto"],
    });

    harness.template.applyTemplateConfig({
      template: "standard",
      ruleOrder: [],
      hiddenProxyGroups: "not-an-array" as never,
      proxyGroupAdvanced: null as never,
      proxyGroupNameOverrides: null as never,
      experimentalCnUseCnRuleSet: "yes" as never,
      cnIpNoResolve: "no" as never,
    });

    expect(harness.getState()).toMatchObject({
      proxyGroupAdvanced: { select: { includeRegex: "Keep" } },
      proxyGroupNameOverrides: { select: "Keep name" },
      experimentalCnUseCnRuleSet: true,
      cnIpNoResolve: false,
      hiddenProxyGroups: [],
    });
  });
});
