import { describe, expect, it } from "vitest";
import {
  buildMetaCubeXRuleListUrl,
  isSafeMetaCubeXRuleName,
  ShadowrocketRuleListError,
} from "./shadowrocket-rule-list";

describe("shadowrocket rule list source", () => {
  it("builds only fixed MetaCubeX meta-branch URLs", () => {
    expect(buildMetaCubeXRuleListUrl("geosite", "category-ai-chat-!cn")).toBe(
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-chat-!cn.list"
    );
    expect(buildMetaCubeXRuleListUrl("geoip", "private")).toBe(
      "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/private.list"
    );
  });

  it("rejects path traversal and arbitrary URLs", () => {
    expect(isSafeMetaCubeXRuleName("anthropic")).toBe(true);
    expect(isSafeMetaCubeXRuleName("../secret")).toBe(false);
    expect(isSafeMetaCubeXRuleName("https://evil.example/x")).toBe(false);
    expect(() => buildMetaCubeXRuleListUrl("geosite", ".." )).toThrow(ShadowrocketRuleListError);
  });
});
