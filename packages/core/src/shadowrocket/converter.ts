import yaml from "js-yaml";
import { convertProxy } from "./node-converter";
import { describeProviderFailure, resolveProvider } from "./provider-map";
import {
  ConversionError,
  type ClashConfig,
  type ClashProxyGroup,
  type ConversionMetrics,
  type ConversionOptions,
  type ConversionResult,
  type Diagnostic,
  type RuleProvider,
  type UnknownRecord,
} from "./types";

export const DEFAULT_OPTIONS: ConversionOptions = { embedNodes: false };
const BUILTIN_POLICIES = new Set(["DIRECT", "REJECT", "PROXY"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string | number => typeof item === "string" || typeof item === "number")
    .map(String).map((item) => item.trim()).filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function withDnsRoute(value: string, route: "proxy" | "no-h3"): string {
  return !/^https?:\/\//i.test(value) || value.includes("#") ? value : `${value}#${route}`;
}

function createGeneralSection(config: ClashConfig, diagnostics: Diagnostic[]): string[] {
  const dns = isRecord(config.dns) ? config.dns : {};
  const nameservers = stringList(dns.nameserver).filter((value) => !/^dhcp:\/\//i.test(value) && value.toLowerCase() !== "system");
  const fallback = stringList(dns.fallback);
  const proxyNameservers = stringList(dns["proxy-server-nameserver"]);
  if (isRecord(dns["nameserver-policy"]) && Object.keys(dns["nameserver-policy"]).length > 0) {
    diagnostics.push({ severity: "info", code: "DNS_POLICY_FLATTENED", message: "Mihomo nameserver-policy 已转换为 Shadowrocket 直连 DNS 与代理 DNS 双通道。" });
  }
  const directDns = dedupe((nameservers.length ? nameservers : ["https://doh.pub/dns-query", "https://dns.alidns.com/dns-query"]).map((value) => withDnsRoute(value, "no-h3")));
  const fallbackDns = dedupe((fallback.length ? fallback : ["https://1.1.1.1/dns-query"]).map((value) => withDnsRoute(value, "proxy")));
  const proxyDns = dedupe((proxyNameservers.length ? proxyNameservers : fallbackDns).map((value) => withDnsRoute(value, "proxy")));
  const ipv6 = typeof dns.ipv6 === "boolean" ? dns.ipv6 : typeof config.ipv6 === "boolean" ? config.ipv6 : false;
  const fakeIpFilter = stringList(dns["fake-ip-filter"]);
  const realIpPatterns = dedupe(fakeIpFilter.filter((item) => /(?:3gppnetwork|ims)/i.test(item)));
  if (realIpPatterns.length === 0) realIpPatterns.push("+.pub.3gppnetwork.org", "ims.*", "*.ims");

  return [
    "[General]",
    "yaml = true",
    "udp-policy-not-supported-behaviour = REJECT",
    "skip-proxy = 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, localhost, *.local, captive.apple.com",
    "tun-excluded-routes = 239.255.255.250/32, 224.0.0.251/32, ff02::fb/128",
    `dns-server = ${directDns.join(", ")}`,
    `fallback-dns-server = ${fallbackDns.join(", ")}`,
    `proxy-dns-server = ${proxyDns.join(", ")}`,
    "dns-direct-system = false",
    "dns-direct-fallback-proxy = true",
    "hijack-dns = 8.8.8.8:53, 8.8.4.4:53, 1.1.1.1:53, 1.0.0.1:53",
    `ipv6 = ${ipv6}`,
    "prefer-ipv6 = false",
    `always-real-ip = ${realIpPatterns.join(", ")}`,
  ];
}

function convertGroup(group: ClashProxyGroup, diagnostics: Diagnostic[]): string | undefined {
  const name = String(group.name ?? "").trim();
  const rawType = String(group.type ?? "select").toLowerCase();
  const supportedTypes: Record<string, string> = { select: "select", "url-test": "url-test", fallback: "fallback", "load-balance": "load-balance", relay: "relay" };
  const type = supportedTypes[rawType];
  if (!name || !type) {
    diagnostics.push({ severity: "error", code: "UNSUPPORTED_GROUP", message: `无法转换策略组类型 ${rawType || "unknown"}。`, subject: name || "unnamed" });
    return undefined;
  }
  if (name.includes(",") || name.includes("=")) {
    diagnostics.push({ severity: "warning", code: "UNSAFE_GROUP_NAME", message: "策略组名称包含逗号或等号，Shadowrocket 可能无法正确解析。", subject: name });
  }
  const members = stringList(group.proxies);
  if (Array.isArray(group.use) && group.use.length > 0) {
    diagnostics.push({ severity: "warning", code: "PROVIDER_GROUP_NOT_EXPANDED", message: "策略组仍引用 proxy-provider；导出前应先展开节点。", subject: name });
  }
  const parts = [type, ...members];
  if (rawType !== "select") {
    if (typeof group.url === "string" && group.url) parts.push(`url=${group.url}`);
    if (typeof group.interval === "number") parts.push(`interval=${group.interval}`);
    if (typeof group.tolerance === "number") parts.push(`tolerance=${group.tolerance}`);
  }
  return `${name} = ${parts.join(",")}`;
}

function getRuleProvider(providers: Record<string, RuleProvider>, name: string): RuleProvider | undefined {
  return providers[name] ?? providers[Object.keys(providers).find((key) => key.toLowerCase() === name.toLowerCase()) ?? ""];
}

function convertRules(config: ClashConfig, options: ConversionOptions, diagnostics: Diagnostic[], metrics: ConversionMetrics): string[] {
  const providers = isRecord(config["rule-providers"]) ? config["rule-providers"] as Record<string, RuleProvider> : {};
  const rules = Array.isArray(config.rules) ? config.rules.map(String) : [];
  const output: string[] = [];
  const finalRules: string[] = [];
  const mappedProviders = new Set<string>();
  const skippedProviders = new Set<string>();
  const groupNames = new Set((config["proxy-groups"] ?? []).map((group) => String(group.name ?? "")));
  const proxyNames = new Set((config.proxies ?? []).map((proxy) => String(proxy.name ?? "")));
  const validPolicies = new Set([...BUILTIN_POLICIES, ...groupNames, ...proxyNames]);

  for (const rawRule of rules) {
    const parts = rawRule.split(",").map((part) => part.trim());
    const type = String(parts[0] ?? "").toUpperCase();
    if (type === "MATCH" || type === "FINAL") {
      finalRules.push(`FINAL,${parts[1] || "DIRECT"}`);
      continue;
    }
    if (type === "RULE-SET") {
      const providerName = parts[1] ?? "";
      const policy = parts[2] ?? "DIRECT";
      const noResolve = parts.slice(3).some((part) => part.toLowerCase() === "no-resolve");
      const provider = getRuleProvider(providers, providerName);
      const resolved = resolveProvider(providerName, provider, options.ruleProviderBaseUrl);
      if (resolved.length === 0) {
        skippedProviders.add(providerName);
        diagnostics.push({ severity: "warning", code: "PROVIDER_SKIPPED", message: `${describeProviderFailure(provider)}，已注释而不是生成无效 RULE-SET。`, subject: providerName });
        output.push(`# SKIPPED RULE-SET,${providerName},${policy}${noResolve ? ",no-resolve" : ""}`);
      } else {
        mappedProviders.add(providerName);
        for (const item of resolved) output.push(`RULE-SET,${item.url},${policy}${noResolve ? ",no-resolve" : ""}`);
      }
      continue;
    }

    const policyIndex = parts.at(-1)?.toLowerCase() === "no-resolve" ? parts.length - 2 : parts.length - 1;
    const policy = policyIndex >= 2 ? parts[policyIndex] : "";
    if (policy && !validPolicies.has(policy)) diagnostics.push({ severity: "warning", code: "UNKNOWN_POLICY", message: "规则引用了未找到的策略、策略组或节点名称；已原样保留。", subject: policy });
    output.push(rawRule);
  }
  if (finalRules.length === 0) {
    const fallbackPolicy = groupNames.has("🐟 漏网之鱼") ? "🐟 漏网之鱼" : groupNames.values().next().value || "DIRECT";
    diagnostics.push({ severity: "warning", code: "FINAL_ADDED", message: "输入没有 MATCH/FINAL，已自动添加最终规则。", subject: fallbackPolicy });
    finalRules.push(`FINAL,${fallbackPolicy}`);
  } else if (finalRules.length > 1) {
    diagnostics.push({ severity: "warning", code: "MULTIPLE_FINAL", message: "输入包含多个 MATCH/FINAL；仅保留最后一条。" });
  }
  output.push(finalRules.at(-1)!);
  metrics.providersMapped = mappedProviders.size;
  metrics.providersSkipped = skippedProviders.size;
  metrics.rulesWritten = output.filter((line) => !line.startsWith("#")).length;
  return output;
}

function createHostSection(config: ClashConfig, diagnostics: Diagnostic[]): string[] {
  if (!isRecord(config.hosts)) return [];
  const lines: string[] = [];
  for (const [hostname, rawValue] of Object.entries(config.hosts)) {
    if (typeof rawValue === "string" || typeof rawValue === "number") lines.push(`${hostname} = ${rawValue}`);
    else if (Array.isArray(rawValue)) lines.push(`${hostname} = ${rawValue.map(String).join(", ")}`);
    else diagnostics.push({ severity: "warning", code: "HOST_SKIPPED", message: "Host 值不是 Shadowrocket 可写入的标量或数组，已跳过。", subject: hostname });
  }
  return lines.length ? ["[Host]", ...lines] : [];
}

export function parseClashYaml(source: string): ClashConfig {
  if (!source.trim()) throw new ConversionError("EMPTY_INPUT", "请选择或粘贴 Clash / Mihomo YAML。");
  let parsed: unknown;
  try {
    parsed = yaml.load(source, { json: true });
  } catch (error) {
    throw new ConversionError("INVALID_YAML", `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new ConversionError("INVALID_ROOT", "YAML 顶层必须是对象。");
  return parsed as ClashConfig;
}

export function convertClashConfig(config: ClashConfig, partialOptions: Partial<ConversionOptions> = {}): ConversionResult {
  const options = { ...DEFAULT_OPTIONS, ...partialOptions };
  const diagnostics: Diagnostic[] = [];
  const proxies = Array.isArray(config.proxies) ? config.proxies : [];
  const groups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  const rules = Array.isArray(config.rules) ? config.rules : [];
  const providers = isRecord(config["rule-providers"]) ? config["rule-providers"] as Record<string, RuleProvider> : {};
  const metrics: ConversionMetrics = { proxiesRead: proxies.length, proxiesEmbedded: 0, groupsRead: groups.length, groupsWritten: 0, rulesRead: rules.length, rulesWritten: 0, providersRead: Object.keys(providers).length, providersMapped: 0, providersSkipped: 0 };
  const sections: string[][] = [["# Generated by SubBoost Clash → Shadowrocket", ...createGeneralSection(config, diagnostics)]];

  if (options.embedNodes && proxies.length > 0) {
    const proxyLines = proxies.map((proxy) => convertProxy(proxy, diagnostics)).filter((line): line is string => Boolean(line));
    metrics.proxiesEmbedded = proxyLines.length;
    if (proxyLines.length > 0) sections.push(["[Proxy]", ...proxyLines]);
  }
  const groupLines = groups.map((group) => convertGroup(group, diagnostics)).filter((line): line is string => Boolean(line));
  metrics.groupsWritten = groupLines.length;
  if (groupLines.length > 0) sections.push(["[Proxy Group]", ...groupLines]);
  sections.push(["[Rule]", ...convertRules(config, options, diagnostics, metrics)]);
  const hostSection = createHostSection(config, diagnostics);
  if (hostSection.length > 0) sections.push(hostSection);

  diagnostics.unshift({ severity: "info", code: "MITM_OMITTED", message: "Clash YAML 不含可安全迁移的 MITM 证书，因此未生成 [MITM]；普通代理和分流不受影响。" });
  if (!options.embedNodes && proxies.length > 0) diagnostics.unshift({ severity: "info", code: "ROUTING_ONLY", message: "当前为仅路由模式，CONF 不写入节点密钥。" });
  return { conf: `${sections.map((section) => section.join("\n")).join("\n\n")}\n`, diagnostics, metrics };
}

export function convertClashYaml(source: string, options: Partial<ConversionOptions> = {}): ConversionResult {
  return convertClashConfig(parseClashYaml(source), options);
}
