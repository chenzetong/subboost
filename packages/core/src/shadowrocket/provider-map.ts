import type { RuleProvider } from "./types";

export type RuleListKind = "geosite" | "geoip";

export interface ResolvedProviderRule {
  url: string;
}

function providerUrl(provider: RuleProvider | undefined): string {
  return typeof provider?.url === "string" ? provider.url.trim() : "";
}

function providerPath(provider: RuleProvider | undefined): string {
  return typeof provider?.path === "string" ? provider.path.trim() : "";
}

function isBinaryMrs(provider: RuleProvider | undefined): boolean {
  const url = providerUrl(provider).toLowerCase().split(/[?#]/, 1)[0];
  const path = providerPath(provider).toLowerCase().split(/[?#]/, 1)[0];
  return String(provider?.format ?? "").toLowerCase() === "mrs" || url.endsWith(".mrs") || path.endsWith(".mrs");
}

function inferKind(provider: RuleProvider | undefined): RuleListKind | null {
  const haystack = `${providerUrl(provider)} ${providerPath(provider)}`.toLowerCase();
  if (/(?:^|\/)geoip\//.test(haystack)) return "geoip";
  if (/(?:^|\/)geosite\//.test(haystack)) return "geosite";

  const behavior = String(provider?.behavior ?? "").toLowerCase();
  if (behavior === "ipcidr") return "geoip";
  if (behavior === "domain") return "geosite";
  return null;
}

function inferListName(name: string, provider: RuleProvider | undefined): string | null {
  const candidates = [providerUrl(provider), providerPath(provider)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const pathname = (() => {
      try {
        return new URL(candidate, "https://subboost.invalid").pathname;
      } catch {
        return candidate.split(/[?#]/, 1)[0];
      }
    })();
    const filename = pathname.split("/").filter(Boolean).at(-1) ?? "";
    const base = filename.replace(/\.(?:mrs|list|txt|ya?ml)$/i, "");
    if (/^[a-z0-9_!+@.-]+$/i.test(base)) return base;
  }

  const fallback = name.trim();
  return /^[a-z0-9_!+@.-]+$/i.test(fallback) ? fallback : null;
}

function isDirectShadowrocketList(provider: RuleProvider | undefined): boolean {
  const url = providerUrl(provider).toLowerCase().split(/[?#]/, 1)[0];
  const behavior = String(provider?.behavior ?? "").toLowerCase();
  const knownShadowrocketSource = url.includes("blackmatrix7/ios_rule_script") && url.includes("/shadowrocket/");
  return (
    !isBinaryMrs(provider) &&
    /\.(?:list|txt)$/.test(url) &&
    (behavior === "classical" || knownShadowrocketSource)
  );
}

export function resolveProvider(
  name: string,
  provider: RuleProvider | undefined,
  ruleProviderBaseUrl?: string
): ResolvedProviderRule[] {
  const url = providerUrl(provider);
  if (!provider || !url) return [];
  if (isDirectShadowrocketList(provider)) return [{ url }];

  const kind = inferKind(provider);
  const listName = inferListName(name, provider);
  const baseUrl = ruleProviderBaseUrl?.replace(/\/$/, "");
  if (!kind || !listName || !baseUrl) return [];

  return [{ url: `${baseUrl}/${kind}/${encodeURIComponent(listName)}` }];
}

export function describeProviderFailure(provider: RuleProvider | undefined): string {
  if (!provider) return "找不到对应 rule-provider";
  if (isBinaryMrs(provider)) return "二进制 .mrs 无法由 Shadowrocket 直接读取，且未能建立文本转换路由";
  return "规则提供器没有可用的 Shadowrocket 文本 URL";
}
