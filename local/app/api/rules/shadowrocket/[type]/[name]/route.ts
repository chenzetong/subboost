import { apiError } from "@local/lib/http";
import {
  fetchShadowrocketRuleList,
  ShadowrocketRuleListError,
} from "@local/lib/shadowrocket-rule-list";
import type { RuleListKind } from "@subboost/core/shadowrocket";
import {
  consumeLocalRateLimit,
  getTrustedClientRateLimitKey,
  localRateLimitResponse,
} from "@local/lib/rate-limit";

type RouteContext = {
  params: Promise<{ type: string; name: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { type, name } = await params;
  if (type !== "geosite" && type !== "geoip") {
    return apiError("Unsupported rule list type.", "BAD_REQUEST", 400);
  }

  const clientKey = getTrustedClientRateLimitKey(request);
  if (clientKey) {
    const rateLimit = consumeLocalRateLimit("shadowrocket-rule-list-client", clientKey, {
      limit: 300,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return localRateLimitResponse("Too many rule list requests. Try again later.", rateLimit.retryAfterSeconds);
    }
  }

  try {
    const result = await fetchShadowrocketRuleList(type as RuleListKind, name);
    return new Response(result.content, {
      headers: {
        "content-type": "text/plain;charset=utf-8",
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
        "x-subboost-source-lines": String(result.inputLines),
        "x-subboost-rule-lines": String(result.outputLines),
        "x-subboost-skipped-lines": String(result.skippedLines),
      },
    });
  } catch (error) {
    if (error instanceof ShadowrocketRuleListError) {
      const code = error.status === 404
        ? "NOT_FOUND"
        : error.status >= 400 && error.status < 500
          ? "BAD_REQUEST"
          : "INTERNAL_ERROR";
      return apiError(error.message, code, error.status);
    }
    return apiError("Failed to convert rule list.", "INTERNAL_ERROR", 502);
  }
}
