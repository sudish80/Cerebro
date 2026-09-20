import { Logger } from "./logger";

const log = new Logger("alerting");

/* ═══════════════════════════════════════════════════════════════════════════
   Alert Types
   ═══════════════════════════════════════════════════════════════════════════ */

export type AlertSeverity = "INFO" | "WARN" | "CRITICAL";

export interface Alert {
  severity: AlertSeverity;
  category: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export interface AlertTransport {
  send(alert: Alert): Promise<void>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Transports
   ═══════════════════════════════════════════════════════════════════════════ */

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  INFO: "ℹ️",
  WARN: "⚠️",
  CRITICAL: "🔴",
};

export class ConsoleAlertTransport implements AlertTransport {
  async send(alert: Alert): Promise<void> {
    const emoji = SEVERITY_EMOJI[alert.severity];
    const ts = new Date(alert.timestamp).toISOString();
    const line = `${emoji} [${alert.severity}] [${alert.category}] ${alert.title}: ${alert.message}`;
    if (alert.data) {
      log.warn(line, { ...alert.data, ts });
    } else {
      log.warn(line, { ts });
    }
  }
}

export class WebhookAlertTransport implements AlertTransport {
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  async send(alert: Alert): Promise<void> {
    const emoji = SEVERITY_EMOJI[alert.severity];
    const ts = new Date(alert.timestamp).toISOString();
    const text = `${emoji} [${alert.severity}] [${alert.category}] ${alert.title}\n${alert.message}`;
    const payload: Record<string, unknown> = { text };

    if (alert.data) {
      payload.data = alert.data;
    }

    try {
      const resp = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        log.error(`Webhook delivery failed: ${resp.status}`, { url: this.url });
      }
    } catch (err) {
      log.error("Webhook delivery error", {
        url: this.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export class TelegramAlertTransport implements AlertTransport {
  private botToken: string;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async send(alert: Alert): Promise<void> {
    const emoji = SEVERITY_EMOJI[alert.severity];
    const text = `${emoji} *${alert.severity}* — _${alert.category}_\n*${alert.title}*\n${alert.message}`;
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: "Markdown",
        }),
      });
      if (!resp.ok) {
        const body = await resp.text();
        log.error(`Telegram send failed: ${resp.status}`, { body });
      }
    } catch (err) {
      log.error("Telegram delivery error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   AlertManager
   ═══════════════════════════════════════════════════════════════════════════ */

export class AlertManager {
  private transports: AlertTransport[];
  private throttleMs: number;
  private lastAlertByCategory = new Map<string, number>();

  constructor(transports: AlertTransport[], opts?: { throttleMs?: number }) {
    this.transports = transports;
    this.throttleMs = opts?.throttleMs ?? 5 * 60 * 1000; // 5 minutes default
  }

  async alert(
    severity: AlertSeverity,
    category: string,
    title: string,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const now = Date.now();
    const last = this.lastAlertByCategory.get(category) ?? 0;

    if (now - last < this.throttleMs) {
      log.debug(`Alert throttled for category "${category}"`, {
        nextAllowedMs: this.throttleMs - (now - last),
      });
      return;
    }

    this.lastAlertByCategory.set(category, now);

    const alert: Alert = {
      severity,
      category,
      title,
      message,
      data,
      timestamp: now,
    };

    await Promise.allSettled(
      this.transports.map((t) => t.send(alert)),
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Factory
   ═══════════════════════════════════════════════════════════════════════════ */

export function createAlertManager(): AlertManager {
  const transports: AlertTransport[] = [new ConsoleAlertTransport()];

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    transports.push(
      new TelegramAlertTransport(
        process.env.TELEGRAM_BOT_TOKEN,
        process.env.TELEGRAM_CHAT_ID,
      ),
    );
  }

  if (process.env.ALERT_WEBHOOK_URL) {
    transports.push(new WebhookAlertTransport(process.env.ALERT_WEBHOOK_URL));
  }

  return new AlertManager(transports);
}
