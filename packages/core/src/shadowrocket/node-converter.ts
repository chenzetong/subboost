import type { ClashProxy, Diagnostic, UnknownRecord } from "./types";

function present(value: unknown): value is string | number | boolean {
  return value !== undefined && value !== null && value !== "";
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join("|");
  return String(value);
}

function pushParam(parts: string[], key: string, value: unknown): void {
  if (present(value)) parts.push(`${key}=${scalar(value)}`);
}

function pushBoolean(parts: string[], key: string, value: unknown): void {
  if (typeof value === "boolean") parts.push(`${key}=${value ? 1 : 0}`);
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function commonTlsParams(proxy: ClashProxy, parts: string[]): void {
  pushParam(parts, "peer", proxy.sni ?? proxy.servername);
  pushParam(parts, "alpn", proxy.alpn);
  pushBoolean(parts, "allowInsecure", proxy["skip-cert-verify"]);
  pushParam(parts, "fingerprint", proxy["client-fingerprint"] ?? proxy.fingerprint);
  pushBoolean(parts, "tfo", proxy.tfo);
}

function appendTransport(proxy: ClashProxy, parts: string[]): void {
  const network = String(proxy.network ?? "tcp").toLowerCase();
  const ws = asRecord(proxy["ws-opts"]);
  const http = asRecord(proxy["http-opts"]);
  const h2 = asRecord(proxy["h2-opts"]);
  const grpc = asRecord(proxy["grpc-opts"]);

  if (network === "ws") {
    pushParam(parts, "obfs", "websocket");
    pushParam(parts, "path", ws.path);
    const headers = asRecord(ws.headers);
    pushParam(parts, "obfs-host", headers.Host ?? headers.host);
  } else if (network === "grpc") {
    pushParam(parts, "obfs", "grpc");
    pushParam(parts, "grpc-service-name", grpc["grpc-service-name"] ?? grpc.serviceName);
  } else if (network === "h2") {
    pushParam(parts, "obfs", "h2");
    pushParam(parts, "path", h2.path);
    pushParam(parts, "obfs-host", h2.host);
  } else if (network === "http") {
    pushParam(parts, "obfs", "http");
    pushParam(parts, "path", Array.isArray(http.path) ? http.path[0] : http.path);
    const headers = asRecord(http.headers);
    pushParam(parts, "obfs-host", headers.Host ?? headers.host);
  } else if (network !== "tcp") {
    pushParam(parts, "obfs", network);
  }
}

function convertSs(proxy: ClashProxy): string[] {
  const parts = ["ss", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "password", proxy.password);
  pushParam(parts, "method", proxy.cipher);
  pushBoolean(parts, "udp", proxy.udp);
  pushBoolean(parts, "tfo", proxy.tfo);

  const plugin = String(proxy.plugin ?? "").toLowerCase();
  const opts = asRecord(proxy["plugin-opts"]);
  if (plugin.includes("obfs")) {
    pushParam(parts, "obfs", opts.mode);
    pushParam(parts, "obfs-host", opts.host);
  } else if (plugin === "v2ray-plugin") {
    pushParam(parts, "obfs", "websocket");
    pushParam(parts, "obfs-host", opts.host);
    pushParam(parts, "path", opts.path);
    if (opts.tls === true) pushParam(parts, "tls", "true");
  } else if (plugin) {
    pushParam(parts, "plugin", plugin);
  }
  return parts;
}

function convertVmess(proxy: ClashProxy): string[] {
  const parts = ["vmess", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "password", proxy.uuid);
  pushParam(parts, "alterId", proxy.alterId ?? 0);
  pushParam(parts, "method", proxy.cipher ?? "auto");
  if (proxy.tls === true) pushParam(parts, "tls", "true");
  pushBoolean(parts, "udp", proxy.udp);
  commonTlsParams(proxy, parts);
  appendTransport(proxy, parts);
  return parts;
}

function convertVless(proxy: ClashProxy): string[] {
  const parts = ["vless", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "password", proxy.uuid ?? proxy.password);
  pushParam(parts, "tls", proxy.tls || proxy["reality-opts"] ? "true" : "false");
  pushBoolean(parts, "udp", proxy.udp);
  commonTlsParams(proxy, parts);
  appendTransport(proxy, parts);
  if (String(proxy.flow ?? "").includes("vision")) pushParam(parts, "xtls", 2);
  const reality = asRecord(proxy["reality-opts"]);
  if (Object.keys(reality).length > 0) {
    pushParam(parts, "reality", 1);
    pushParam(parts, "reality-pk", reality["public-key"]);
    pushParam(parts, "reality-sid", reality["short-id"]);
  }
  return parts;
}

function convertTrojan(proxy: ClashProxy): string[] {
  const parts = ["trojan", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "password", proxy.password);
  pushBoolean(parts, "udp", proxy.udp);
  commonTlsParams(proxy, parts);
  appendTransport(proxy, parts);
  return parts;
}

function convertAnyTls(proxy: ClashProxy): string[] {
  const parts = ["anytls", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "password", proxy.password);
  pushBoolean(parts, "udp", proxy.udp);
  commonTlsParams(proxy, parts);
  pushParam(parts, "idle-session-check-interval", proxy["idle-session-check-interval"]);
  pushParam(parts, "idle-session-timeout", proxy["idle-session-timeout"]);
  pushParam(parts, "min-idle-session", proxy["min-idle-session"]);
  pushParam(parts, "padding-scheme", proxy["padding-scheme"]);
  return parts;
}

function convertHysteria2(proxy: ClashProxy): string[] {
  const parts = ["hysteria2", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "auth", proxy.password ?? proxy.auth);
  pushParam(parts, "obfs", proxy.obfs);
  pushParam(parts, "obfsParam", proxy["obfs-password"]);
  pushParam(parts, "udp", 1);
  commonTlsParams(proxy, parts);
  pushParam(parts, "upmbps", proxy.up);
  pushParam(parts, "downmbps", proxy.down);
  pushParam(parts, "ports", proxy.ports);
  pushParam(parts, "hop-interval", proxy["hop-interval"]);
  return parts;
}

function convertTuic(proxy: ClashProxy): string[] {
  const parts = ["tuic", scalar(proxy.server), scalar(proxy.port)];
  pushParam(parts, "password", proxy.password ?? proxy.token);
  pushParam(parts, "user", proxy.uuid);
  pushParam(parts, "udp", 1);
  commonTlsParams(proxy, parts);
  pushParam(parts, "congestion-controller", proxy["congestion-controller"]);
  pushParam(parts, "udp-relay-mode", proxy["udp-relay-mode"]);
  return parts;
}

const REQUIRED_SECRET: Record<string, string[]> = {
  ss: ["password", "cipher"],
  vmess: ["uuid"],
  vless: ["uuid"],
  trojan: ["password"],
  anytls: ["password"],
  hysteria2: ["password"],
};

export function convertProxy(proxy: ClashProxy, diagnostics: Diagnostic[]): string | undefined {
  const name = String(proxy.name ?? "").trim();
  const type = String(proxy.type ?? "").toLowerCase();
  if (!name || !present(proxy.server) || !present(proxy.port)) {
    diagnostics.push({ severity: "error", code: "INVALID_PROXY", message: "节点缺少 name、server 或 port，已跳过。", subject: name || type || "unknown" });
    return undefined;
  }

  const missing = (REQUIRED_SECRET[type] ?? []).find((key) => !present(proxy[key]));
  if (missing) {
    diagnostics.push({ severity: "error", code: "INVALID_PROXY_SECRET", message: `节点缺少 ${missing}，无法安全写入 CONF。`, subject: name });
    return undefined;
  }

  let parts: string[];
  switch (type) {
    case "ss": parts = convertSs(proxy); break;
    case "vmess": parts = convertVmess(proxy); break;
    case "vless": parts = convertVless(proxy); break;
    case "trojan": parts = convertTrojan(proxy); break;
    case "anytls": parts = convertAnyTls(proxy); break;
    case "hysteria2":
    case "hy2": parts = convertHysteria2(proxy); break;
    case "tuic": parts = convertTuic(proxy); break;
    default:
      diagnostics.push({ severity: "warning", code: "UNSUPPORTED_PROXY", message: `Shadowrocket CONF 暂不支持嵌入 ${type || "未知"} 节点。`, subject: name });
      return undefined;
  }
  return `${name} = ${parts.join(",")}`;
}
