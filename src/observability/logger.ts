import { LOG } from "../config";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

const SECRET_PATTERNS = [
  /^(sk-|jv_)/,                       // TypeSafe / Jev keys
  /^Bearer\s+/i,                      // Bearer tokens
  /^0x[0-9a-fA-F]{64}$/,             // Hex private keys
  /^AKIA[0-9A-Z]{16}$/,              // AWS access keys
  /^ghp_[A-Za-z0-9]{36}$/,           // GitHub PATs
  /^gho_[A-Za-z0-9]{36}$/,           // GitHub OAuth tokens
  /TYPESAFE_API_KEY\s*[:=]\s*\S+/i,  // Key assignments in messages
];

function containsSecret(value: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(value));
}

function redactSecrets(obj: unknown): unknown {
  if (!LOG.redactSecrets) return obj;
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return containsSecret(obj) ? "[REDACTED]" : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(redactSecrets);
  }
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string" && containsSecret(v)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return obj;
}

export function generateCorrelationId(): string {
  return `tick_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class Logger {
  private module: string;
  private correlationId: string;
  private static minLevel: number = LEVEL_ORDER[LOG.level];

  constructor(module: string, correlationId?: string) {
    this.module = module;
    this.correlationId = correlationId || "";
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log("debug", msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log("info", msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log("warn", msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log("error", msg, data);
  }

  child(correlationId: string): Logger {
    return new Logger(this.module, correlationId);
  }

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  getCorrelationId(): string {
    return this.correlationId;
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < Logger.minLevel) return;

    const ts = new Date().toISOString();
    const redacted = data ? redactSecrets(data) : undefined;

    if (LOG.jsonFormat) {
      const entry: Record<string, unknown> = {
        ts,
        level,
        module: this.module,
        msg,
      };
      if (this.correlationId) entry.correlationId = this.correlationId;
      if (redacted && Object.keys(redacted).length > 0) entry.data = redacted;
      console.log(JSON.stringify(entry));
    } else {
      const parts = [
        `[${ts}]`,
        `[${LEVEL_LABEL[level]}]`,
        `[${this.module}]`,
      ];
      if (this.correlationId) parts.push(`[${this.correlationId}]`);
      parts.push(msg);
      if (redacted && Object.keys(redacted).length > 0) {
        const pairs = Object.entries(redacted)
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(" ");
        parts.push(pairs);
      }
      const line = parts.join(" ");
      if (level === "error") {
        console.error(line);
      } else {
        console.log(line);
      }
    }
  }
}
