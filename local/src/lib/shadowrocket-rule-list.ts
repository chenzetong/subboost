import { convertMetaCubeXRuleList, type RuleListConversionResult, type RuleListKind } from "@subboost/core/shadowrocket";

const METACUBEX_RULE_ROOT = "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo";
const MAX_RULE_LIST_BYTES = 8 * 1024 * 1024;
const RULE_LIST_TIMEOUT_MS = 15_000;

export class ShadowrocketRuleListError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ShadowrocketRuleListError";
    this.status = status;
  }
}

export function isSafeMetaCubeXRuleName(value: string): boolean {
  return /^[a-z0-9_!+@.-]+$/i.test(value) && !value.includes("..") && !value.startsWith(".");
}

export function buildMetaCubeXRuleListUrl(kind: RuleListKind, name: string): string {
  if ((kind !== "geosite" && kind !== "geoip") || !isSafeMetaCubeXRuleName(name)) {
    throw new ShadowrocketRuleListError("Invalid MetaCubeX rule list path.", 400);
  }
  return `${METACUBEX_RULE_ROOT}/${kind}/${name}.list`;
}

async function readTextLimited(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RULE_LIST_BYTES) {
    throw new ShadowrocketRuleListError("Rule list response is too large.", 413);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RULE_LIST_BYTES) {
      await reader.cancel("rule list response too large").catch(() => undefined);
      throw new ShadowrocketRuleListError("Rule list response is too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchShadowrocketRuleList(
  kind: RuleListKind,
  name: string
): Promise<RuleListConversionResult> {
  const url = buildMetaCubeXRuleListUrl(kind, name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RULE_LIST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain",
        "User-Agent": "SubBoost-Shadowrocket/1.0",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 404) throw new ShadowrocketRuleListError("MetaCubeX rule list not found.", 404);
    if (!response.ok) throw new ShadowrocketRuleListError(`MetaCubeX rule list returned HTTP ${response.status}.`);
    const converted = convertMetaCubeXRuleList(await readTextLimited(response), kind);
    if (converted.outputLines === 0) throw new ShadowrocketRuleListError("MetaCubeX rule list contained no convertible entries.", 422);
    return converted;
  } catch (error) {
    if (error instanceof ShadowrocketRuleListError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ShadowrocketRuleListError("MetaCubeX rule list request timed out.", 504);
    }
    throw new ShadowrocketRuleListError("Failed to fetch MetaCubeX rule list.");
  } finally {
    clearTimeout(timer);
  }
}
