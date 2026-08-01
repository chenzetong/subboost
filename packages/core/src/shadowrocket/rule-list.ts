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
  const trimmed = value.trim();
  let start = 0;
  while (start < trimmed.length && trimmed.charCodeAt(start) === 46) start += 1;
  const end = trimmed.endsWith(".") ? trimmed.length - 1 : trimmed.length;
  return trimmed.slice(start, end);
}

function isWhitespaceCode(code: number): boolean {
  return code === 9 || code === 11 || code === 12 || code === 13 || code === 32;
}

function findInlineComment(line: string): number {
  let searchFrom = 1;
  while (searchFrom < line.length) {
    const hash = line.indexOf("#", searchFrom);
    if (hash < 0) return -1;
    if (isWhitespaceCode(line.charCodeAt(hash - 1))) {
      let commentStart = hash - 1;
      while (commentStart > 0 && isWhitespaceCode(line.charCodeAt(commentStart - 1))) {
        commentStart -= 1;
      }
      return commentStart;
    }
    searchFrom = hash + 1;
  }
  return -1;
}

function isDomainListEntry(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  let hasDot = false;
  let labelLength = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 46) {
      if (labelLength === 0) return false;
      hasDot = true;
      labelLength = 0;
      continue;
    }

    const isDigit = code >= 48 && code <= 57;
    const isLowercaseLetter = code >= 97 && code <= 122;
    const isUppercaseLetter = code >= 65 && code <= 90;
    const isSupportedMarker = code === 33 || code === 42 || code === 43 || code === 45 || code === 64 || code === 95;
    if (!isDigit && !isLowercaseLetter && !isUppercaseLetter && !isSupportedMarker) return false;
    labelLength += 1;
  }

  return hasDot && labelLength > 0;
}

function convertLine(rawLine: string, kind: "geosite" | "geoip"): string | null {
  let line = rawLine.trim();
  if (!line || line.startsWith("#") || line.startsWith("//")) return null;

  const inlineComment = findInlineComment(line);
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
  if (line.startsWith("regexp:") || (line.length > 2 && line.startsWith("/") && line.endsWith("/"))) return null;

  if (line.startsWith("+.") || line.startsWith("*.")) {
    const domain = cleanDomain(line.slice(2));
    return domain ? `DOMAIN-SUFFIX,${domain}` : null;
  }
  if (!isDomainListEntry(line)) return null;
  const domain = cleanDomain(line);
  return domain ? `DOMAIN,${domain}` : null;
}

/** Converts MetaCubeX's plain geosite/geoip list into a Shadowrocket RULE-SET payload. */
export function convertMetaCubeXRuleList(
  source: string,
  kind: "geosite" | "geoip"
): RuleListConversionResult {
  const rawLines = source.split("\n");
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
