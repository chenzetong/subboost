import { describe, expect, it } from "vitest";
import { convertMetaCubeXRuleList } from "./rule-list";

describe("convertMetaCubeXRuleList", () => {
  it("converts MetaCubeX geosite syntax into Shadowrocket payload rules", () => {
    const result = convertMetaCubeXRuleList(
      [
        "# generated",
        "+.anthropic.com",
        "domain:claude.ai",
        "full:api.example.com",
        "keyword:openai",
        "plain.example.com",
        "regexp:^unsupported$",
        "+.anthropic.com",
      ].join("\n"),
      "geosite"
    );

    expect(result.content).toBe([
      "DOMAIN-SUFFIX,anthropic.com",
      "DOMAIN-SUFFIX,claude.ai",
      "DOMAIN,api.example.com",
      "DOMAIN-KEYWORD,openai",
      "DOMAIN,plain.example.com",
      "",
    ].join("\n"));
    expect(result.outputLines).toBe(5);
    expect(result.skippedLines).toBe(2);
  });

  it("converts IPv4 and IPv6 ranges without treating domains as geoip rules", () => {
    const result = convertMetaCubeXRuleList(
      "10.0.0.0/8\n1.1.1.1\n2001:db8::/32\n2001:db8::1\nexample.com\n",
      "geoip"
    );
    expect(result.content).toContain("IP-CIDR,10.0.0.0/8");
    expect(result.content).toContain("IP-CIDR,1.1.1.1/32");
    expect(result.content).toContain("IP-CIDR6,2001:db8::/32");
    expect(result.content).toContain("IP-CIDR6,2001:db8::1/128");
    expect(result.content).not.toContain("example.com");
  });
});
