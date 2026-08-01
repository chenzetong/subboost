import { apiError } from "@local/lib/http";
import { generateSubscriptionShadowrocketConf } from "@local/lib/subscription-service";
import { buildSubscriptionResponseHeaders } from "@subboost/server-core/subscription";
import {
  consumeLocalRateLimit,
  getTrustedClientRateLimitKey,
  hashLocalRateLimitKey,
  localRateLimitResponse,
} from "@local/lib/rate-limit";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { id: token } = await params;
  const clientKey = getTrustedClientRateLimitKey(request);
  if (clientKey) {
    const clientLimit = consumeLocalRateLimit("subscription-shadowrocket-client", clientKey, {
      limit: 120,
      windowMs: 60_000,
    });
    if (!clientLimit.allowed) {
      return localRateLimitResponse("Too many Shadowrocket subscription requests. Try again later.", clientLimit.retryAfterSeconds);
    }
  }

  const tokenLimit = consumeLocalRateLimit("subscription-shadowrocket-token", hashLocalRateLimitKey(token), {
    limit: 30,
    windowMs: 60_000,
  });
  if (!tokenLimit.allowed) {
    return localRateLimitResponse("Too many Shadowrocket subscription requests. Try again later.", tokenLimit.retryAfterSeconds);
  }

  const result = await generateSubscriptionShadowrocketConf(token);
  if (!result) return apiError("Shadowrocket subscription not found or contains no convertible nodes.", "NOT_FOUND", 404);

  const headers = buildSubscriptionResponseHeaders(result.name, result.subscriptionInfo, {
    cacheControl: "no-store",
    cacheExpirySeconds: result.cacheExpirySeconds,
    autoUpdateIntervalSeconds: result.autoUpdateIntervalSeconds,
    isAdmin: result.isAdmin,
  });
  headers["content-type"] = "text/plain;charset=utf-8";
  headers["x-subboost-shadowrocket-nodes"] = String(result.metrics.proxiesEmbedded);
  headers["x-subboost-shadowrocket-rules"] = String(result.metrics.rulesWritten);
  headers["x-subboost-shadowrocket-warnings"] = String(
    result.diagnostics.filter((item) => item.severity === "warning" || item.severity === "error").length
  );
  return new Response(result.conf, { headers });
}
