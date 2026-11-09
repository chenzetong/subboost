// @ts-expect-error public coverage tests render with the public React runtime.
import * as React from "../../../node_modules/react";
// @ts-expect-error public coverage tests render with the public ReactDOM server runtime.
import { renderToStaticMarkup } from "../../../node_modules/react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BaseConfigYamlError, generateClashConfig } from "@subboost/core/generator";
import {
  buildGeneratedRuleEntries,
  generateRules,
  hasFullRuleOrderKeys,
  normalizePersistedRuleOrder,
  resolveAppliedRuleOrder,
} from "@subboost/core/generator/rules";
import {
  detachSourceNodesFromState,
  mergeParsedSourceNodes,
  prepareSourceParsedNodes,
} from "@subboost/core/subscription/source-node-refresh";
import { ORIGIN_NAME_KEY, SOURCE_IDS_KEY } from "@subboost/core/subscription/node-source-state";
import type { ParsedNode } from "@subboost/core/types/node";
import { YamlHighlight } from "@subboost/ui/product/preview/diff-highlight";
import { createNodeActions } from "@subboost/ui/store/config-store/actions/node-actions";
import { createProxyGroupActions } from "@subboost/ui/store/config-store/actions/proxy-group-actions";
import { initialState } from "@subboost/ui/store/config-store/definitions";
import { PagePager } from "@subboost/ui/components/ui/page-pager";
import { ProtocolBadge, getProtocolBadgeClass } from "@subboost/ui/components/ui/protocol-badge";
import { SmartNodeMatchingHelp } from "@subboost/ui/components/subscription/smart-node-matching-help";
import { SubscriptionImportErrorBadge } from "@subboost/ui/product/converter/subscription-import-error";
import { DashboardStatsCards } from "@subboost/ui/dashboard/dashboard-stats-cards";
import { buildRefreshSubscriptionSuccessToast } from "@subboost/ui/dashboard/dashboard-refresh-toast";
import { formatDashboardDate, formatIntervalLabel } from "@subboost/ui/dashboard/dashboard-format";
import {
  buildProxyGroupName,
  parseProxyGroupNameDraft,
  pickRandomEmoji,
  toProxyGroupNameDraft,
} from "@subboost/ui/product/converter/advanced-mode/sections/proxy-group-name-editor";
import {
  getLoadBalanceStrategyLabel,
  getProxyGroupTypeLabel,
} from "@subboost/ui/product/converter/advanced-mode/sections/proxy-group-type-menu";
import {
  buildManualRuleTargets,
  listCustomRulesForTarget,
} from "@subboost/ui/product/converter/advanced-mode/sections/proxy-group-rule-targets";
import {
  getRuleDisplayName,
  replaceRuleProviderBase,
} from "@subboost/ui/product/converter/advanced-mode/sections/proxy-groups-rules-search";
import { parseCustomRuleBatchImport } from "@subboost/core/rules/custom-rule-batch-import";
import {
  buildCnRuleCandidatesFromSources,
  buildCnRuleVariantIds,
  buildLocalCnRuleCandidates,
  collectCnCandidateParents,
  normalizeRuleListLines,
} from "@subboost/core/rules/cn-candidate-utils";

const UUID = "11111111-1111-4111-8111-111111111111";
const REALITY_PUBLIC_KEY = "A".repeat(43);

function ssNode(name: string, patch: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "ss",
    server: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "node"}.example.com`,
    port: 8388,
    cipher: "aes-128-gcm",
    password: "secret",
    ...patch,
  } as unknown as ParsedNode;
}

function vmessNode(name: string, patch: Record<string, unknown> = {}): ParsedNode {
  return {
    name,
    type: "vmess",
    server: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "vmess"}.example.com`,
    port: 443,
    uuid: UUID,
    alterId: 0,
    cipher: "auto",
    tls: true,
    ...patch,
  } as unknown as ParsedNode;
}

function createProxyGroupHarness(overrides: Record<string, unknown> = {}) {
  let state = {
    ...structuredClone(initialState),
    ...overrides,
  } as any;

  const applyPatch = (patch: any) => {
    if (!patch || patch === state) return;
    state = { ...state, ...patch };
  };

  const setAndGenerateConfig = (updater: any) => {
    applyPatch(updater(state));
  };

  const actions = createProxyGroupActions(() => undefined, () => state, setAndGenerateConfig);
  return { actions, getState: () => state };
}

function createNodeHarness(overrides: Record<string, unknown> = {}) {
  let state = {
    ...structuredClone(initialState),
    ...overrides,
  } as any;

  const applyPatch = (patch: any) => {
    if (!patch || patch === state) return;
    state = { ...state, ...patch };
  };

  const set = (patch: any) => {
    applyPatch(typeof patch === "function" ? patch(state) : patch);
  };
  const setAndGenerateConfig = (updater: any) => {
    applyPatch(updater(state));
  };

  const actions = createNodeActions(set, () => state, setAndGenerateConfig);
  return { actions, getState: () => state };
}

describe("preview components branch coverage", () => {
  it("renders YAML highlighting and large-content plain mode", () => {
    expect(renderToStaticMarkup(React.createElement(YamlHighlight, { content: "" }))).toContain("<pre");

    const highlighted = renderToStaticMarkup(
      React.createElement(YamlHighlight, {
        content: [
          "# comment",
          "",
          "proxies:",
          "  - {name: Node, type: ss, server: example.com, port: 8388, tls: true, dialer-proxy: Relay}",
          "  - {password: \"sec,ret\", uuid: 11111111-1111-4111-8111-111111111111, cipher: aes-128-gcm, sni: front.example.com, nested: {inner: [one, two]}, bare}",
          "  - [{name: Nested, dialer-proxy: Relay}, 'quoted, item', [auto, ws], bare]",
          "  - [auto, chrome, 123, false, null, \"quoted <value>\"]",
          "carriage: a\rb",
          "mode: rule",
          "mixed-port: 7890",
          "empty: ~",
          "plain: value & more",
        ].join("\n"),
        className: "yaml-box",
      })
    );

    expect(highlighted).toContain("yaml-box");
    expect(highlighted).toContain("&lt;value&gt;");
    expect(highlighted).toContain("text-rose-400");
    expect(highlighted).toContain("text-pink-400");
    expect(highlighted).toContain("text-orange-400");
    expect(highlighted).toContain("text-violet-400");
    expect(highlighted).toContain("text-teal-400");

    const hugeContent = `${"a".repeat(4001)}\n${Array.from({ length: 2502 }, (_, index) => `line-${index}`).join("\n")}`;
    const plain = renderToStaticMarkup(
      React.createElement(YamlHighlight, {
        content: hugeContent,
      })
    );

    expect(plain).toContain("YAML 内容较大");
    expect(plain).toContain("强制语法高亮");
    expect(plain).toContain("line-2501");
  });
});

describe("public UI helper branch coverage", () => {
  it("formats dashboard labels and refresh toasts across edge cases", () => {
    expect(formatDashboardDate(null)).toBe("从未");
    expect(formatDashboardDate("not-a-date")).toBe("从未");
    expect(formatIntervalLabel(0)).toBe("0 秒");
    expect(formatIntervalLabel(172800)).toBe("2 天");
    expect(formatIntervalLabel(7200)).toBe("2 小时");
    expect(formatIntervalLabel(180)).toBe("3 分钟");
    expect(formatIntervalLabel(59)).toBe("59 秒");

    expect(buildRefreshSubscriptionSuccessToast({ attemptedUrlFetch: false } as never)).toMatchObject({
      variant: "success",
    });
    expect(
      buildRefreshSubscriptionSuccessToast({
        attemptedUrlFetch: true,
        refreshableSourceCount: 3.8,
        failedSourceCount: 1.2,
        refreshedSourceCount: "bad",
        nodeCount: Number.NaN,
      } as never)
    ).toMatchObject({
      title: "刷新完成：2 个源已更新，1 个源失败",
      variant: "warning",
    });
    expect(
      buildRefreshSubscriptionSuccessToast({
        attemptedUrlFetch: true,
        refreshableSourceCount: 2,
        failedSourceCount: 0,
        refreshedSourceCount: 2,
        nodeCount: 12,
      } as never)
    ).toMatchObject({
      title: "刷新完成：2 个源已更新，共 12 个节点",
      variant: "success",
    });
  });

  it("normalizes proxy group and rules helper inputs", () => {
    expect(parseProxyGroupNameDraft("🚀 Fast Nodes")).toEqual({ emoji: "🚀", name: "Fast Nodes" });
    expect(parseProxyGroupNameDraft(" Fast Nodes ", "✨")).toEqual({ emoji: "✨", name: "Fast Nodes" });
    expect(toProxyGroupNameDraft(null, "🎯")).toEqual({ emoji: "🎯", name: "" });
    expect(toProxyGroupNameDraft({ emoji: " 🤖 ", name: " AI " })).toEqual({ emoji: "🤖", name: "AI" });
    expect(buildProxyGroupName({ emoji: "🤖", name: "AI" })).toBe("🤖 AI");
    expect(buildProxyGroupName({ emoji: "", name: "Plain" })).toBe("Plain");
    expect(buildProxyGroupName({ emoji: "x", name: "" })).toBe("");

    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(pickRandomEmoji("🧩")).not.toBe("🧩");

    expect(getProxyGroupTypeLabel("url-test")).toBe("自动测速");
    expect(getProxyGroupTypeLabel("unknown")).toBe("手动选择");
    expect(getLoadBalanceStrategyLabel("round-robin")).toBe("轮询均摊");
    expect(getLoadBalanceStrategyLabel("sticky-sessions")).toBe("会话保持");
    expect(getLoadBalanceStrategyLabel("consistent-hashing")).toBe("稳定分配");

    expect(
      listCustomRulesForTarget(
        [
          { id: "a", type: "DOMAIN", value: "a.example.com", target: " Target " },
          { id: "b", type: "DOMAIN", value: "b.example.com", target: "Other" },
        ] as never,
        "Target"
      )
    ).toEqual([{ rule: { id: "a", type: "DOMAIN", value: "a.example.com", target: " Target " }, index: 0 }]);
    expect(listCustomRulesForTarget([], " ")).toEqual([]);

    const targets = buildManualRuleTargets({
      enabledProxyGroups: ["select", "ai", "youtube"],
      hiddenProxyGroups: ["youtube"],
      proxyGroupNameOverrides: { ai: "Labs" },
      customProxyGroups: [
        { id: "", name: "Ignored", emoji: "", groupType: "select" },
        { id: "custom", name: " Custom ", emoji: "", groupType: "select" },
      ],
    });
    expect(targets.map((target) => `${target.kind}:${target.id}:${target.name}`)).toContain("custom:custom:Custom");
    expect(targets.map((target) => `${target.kind}:${target.id}:${target.name}`)).not.toContain(
      "filtered:filtered:Filtered"
    );

    expect(replaceRuleProviderBase("https://old.example/geosite/openai.mrs", "https://new.example/base/")).toBe(
      "https://new.example/base/geosite/openai.mrs"
    );
    expect(replaceRuleProviderBase("https://old.example/plain.txt", "https://new.example")).toBe(
      "https://old.example/plain.txt"
    );
    expect(getRuleDisplayName({ id: "openai", name: "OpenAI", nameZh: "开放AI" } as never)).toBe("OpenAI（开放AI）");
    expect(getRuleDisplayName({ id: "openai", name: "", nameZh: "openai" } as never)).toBe("openai");
  });

  it("renders small public components with both enabled and fallback branches", () => {
    const onPageChange = vi.fn();
    const pager = renderToStaticMarkup(
      React.createElement(PagePager, {
        page: 2,
        totalPages: 0,
        onPageChange,
        disabled: true,
        className: "pager",
      })
    );
    expect(pager).toContain("pager");
    expect(pager).toContain("/ 1");

    expect(getProtocolBadgeClass(" VMess ")).toContain("purple");
    expect(getProtocolBadgeClass(undefined)).toContain("slate");
    expect(
      renderToStaticMarkup(React.createElement(ProtocolBadge, { type: "unknown", className: "proto" }))
    ).toContain("proto");

    expect(
      renderToStaticMarkup(React.createElement(SmartNodeMatchingHelp, { enabled: true }))
    ).toContain("更新时智能匹配节点说明");
    expect(
      renderToStaticMarkup(React.createElement(SmartNodeMatchingHelp, { enabled: false }))
    ).toContain("更新时智能匹配节点说明");

    const dashboard = renderToStaticMarkup(
      React.createElement(DashboardStatsCards, {
        subscriptionCount: 2,
        user: {
          isAdmin: false,
          templateCount: 3,
          quota: {
            maxSubscriptions: 5,
            maxNodesPerSubscription: 100,
            maxCustomTemplates: 8,
            maxImportSourcesPerType: 9999,
          },
        },
      })
    );
    expect(dashboard).toContain("不限");

    const badge = renderToStaticMarkup(
      React.createElement(SubscriptionImportErrorBadge, {
        errorInfo: {
          category: "network",
          message: "Fetch failed",
          detail: "Fetch failed: timeout",
          suggestedActions: ["Retry"],
          at: Date.parse("2026-01-01T00:00:00.000Z"),
          isUserFacingReason: false,
        },
        maxChars: 3,
        className: "err-badge",
      })
    );
    expect(badge).toContain("err-badge");
    expect(badge).toContain("查看错误详情");
    expect(renderToStaticMarkup(React.createElement(SubscriptionImportErrorBadge, { errorMessage: null }))).toBe("");
  });
});
