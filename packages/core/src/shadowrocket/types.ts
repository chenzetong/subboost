export type UnknownRecord = Record<string, unknown>;

export interface ClashProxy extends UnknownRecord {
  name?: string;
  type?: string;
  server?: string;
  port?: string | number;
}

export interface ClashProxyGroup extends UnknownRecord {
  name?: string;
  type?: string;
  proxies?: string[];
  use?: string[];
  url?: string;
  interval?: number;
  tolerance?: number;
}

export interface RuleProvider extends UnknownRecord {
  type?: string;
  behavior?: string;
  format?: string;
  url?: string;
  path?: string;
}

export interface ClashConfig extends UnknownRecord {
  proxies?: ClashProxy[];
  "proxy-groups"?: ClashProxyGroup[];
  "proxy-providers"?: Record<string, UnknownRecord>;
  rules?: string[];
  "rule-providers"?: Record<string, RuleProvider>;
  dns?: UnknownRecord;
  hosts?: Record<string, unknown>;
  ipv6?: boolean;
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  subject?: string;
}

export interface ConversionOptions {
  embedNodes: boolean;
  /** Absolute SubBoost URL used to proxy and translate MetaCubeX rule lists. */
  ruleProviderBaseUrl?: string;
}

export interface ConversionMetrics {
  proxiesRead: number;
  proxiesEmbedded: number;
  groupsRead: number;
  groupsWritten: number;
  rulesRead: number;
  rulesWritten: number;
  providersRead: number;
  providersMapped: number;
  providersSkipped: number;
}

export interface ConversionResult {
  conf: string;
  diagnostics: Diagnostic[];
  metrics: ConversionMetrics;
}

export interface RuleListConversionResult {
  content: string;
  inputLines: number;
  outputLines: number;
  skippedLines: number;
}

export class ConversionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConversionError";
    this.code = code;
  }
}
