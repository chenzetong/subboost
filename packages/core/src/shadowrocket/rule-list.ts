import type { RuleListConversionResult } from "./types";

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpv4Cidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split("/");
  return rest.length === 0 && isIpv4(address) && /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
}

function isIpv6(value: string): boolean {
  return value.includes(":") && /^[0-9a-f:]+$/i.test(value);
}

function isIpv6Cidr(value: string): boolean {
  const slash = value.lastIndexOf("/");
  if (slash < 0) return false;
  const address = value.slice(0, slash);
  const prefix = value.slice(slash + 1);
  return isIpv6(address) && /^\d{1,3}$/.test(prefix) && Number(prefix) <= 128;
}

function cleanDomain(value: string): string {
  return value.trim().replace(/^\.+/, "").replace(/\.$/, "");
}

function convertLine(rawLine: string, kind: "geosite" | "geoip"): string | null {
  let line = rawLine.trim();
  if (!line || line.startsWith("#") || line.startsWith("//")) return null;

  const inlineComment = line.search(/\s+#/);
  if (inlineComment >= 0) line = line.slice(0, inlineComment).trim();
  if (!line) return null;

  if (isIpv4Cidr(line)) return `IP-CIDR,${line}`;
  if (isIpv6Cidr(line)) return `IP-CIDR6,${line}`;
  if (isIpv4(line)) return `IP-CIDR,${line}/32`;
  if (isIpv6(line)) return `IP-CIDR6,${line}/128`;
  if (kind === "geoip") return null;

  const separator = line.indexOf(":");
  const prefix = separator >= 0 ? line.slice(0, separator).toLowerCase() : "";
  const value = separator >= 0 ? line.slice(separator + 1).trim() : line;

  if (prefix === "domain") {
    const domain = cleanDomain(value);
    return domain ? `DOMAIN-SUFFIX,${domain}` : null;
  }
  if (prefix === "full") {
    const domain = cleanDomain(value);
    return domain ? `DOMAIN,${domain}` : null;
  }
  if (prefix === "keyword") {
    return value ? `DOMAIN-KEYWORD,${value}` : null;
  }
  if (prefix) return null;
  if (line.startsWith("regexp:") || /^\/.+\/$/.test(line)) return null;

  if (line.startsWith("+." ) || line.startsWith("*.")) {
    const domain = cleanDomain(line.slice(2));
    return domain ? `DOMAIN-SUFFIX,${domain}` : null;
  }
  if (!/^[a-z0-9_.*!+@-]+(?:\.[a-z0-9_.*!+@-]+)+$/i.test(line)) return null;
  const domain = cleanDomain(line);
  return domain ? `DOMAIN,${domain}` : null;
}

/** Converts MetaCubeX's plain geosite/geoip list into a Shadowrocket RULE-SET payload. */
export function convertMetaCubeXRuleList(
  source: string,
  kind: "geosite" | "geoip"
): RuleListConversionResult {
  const rawLines = source.split(/\r?\n/);
  const output: string[] = [];
  const seen = new Set<string>();
  let candidates = 0;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    candidates += 1;
    const converted = convertLine(rawLine, kind);
    if (!converted || seen.has(converted)) continue;
    seen.add(converted);
    output.push(converted);
  }

  return {
    content: output.length > 0 ? `${output.join("\n")}\n` : "",
    inputLines: candidates,
    outputLines: output.length,
    skippedLines: Math.max(0, candidates - output.length),
  };
}
