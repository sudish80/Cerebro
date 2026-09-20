import { Logger } from "../observability/logger";
import type { OHLCVBar, OrderBookSnapshot, MarketDataFeed } from "../types";

const log = new Logger("WS-FEED");

interface RawOrderBookMessage {
  type: "orderbook";
  bids: [string, string][];
  asks: [string, string][];
}

interface RawTradeMessage {
  type: "trade";
  price: string;
  size: string;
  timestamp: number;
}

const MAX_BAR_HISTORY = 1000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const WS_URL = "wss://clob.kuru.io/ws";

export class WsFeed implements MarketDataFeed {
  private ws: WebSocket | null = null;
  private connected = false;
  private intentionalClose = false;

  private backoffMs = BACKOFF_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  private orderBook: OrderBookSnapshot | null = null;
  private barHistory: OHLCVBar[] = [];
  private currentBar: OHLCVBar | null = null;
  private currentBarSecond = -1;

  private barCallbacks: ((bar: OHLCVBar) => void)[] = [];
  private bookCallbacks: ((book: OrderBookSnapshot) => void)[] = [];

  async connect(): Promise<void> {
    this.intentionalClose = false;
    this.createConnection();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this.connected = false;
    log.info("Disconnected intentionally");
  }

  isConnected(): boolean {
    return this.connected;
  }

  getOrderBook(): OrderBookSnapshot | null {
    return this.orderBook;
  }

  getLatestBar(): OHLCVBar | null {
    return this.currentBar;
  }

  getBarHistory(): readonly OHLCVBar[] {
    return this.barHistory;
  }

  onBar(callback: (bar: OHLCVBar) => void): void {
    this.barCallbacks.push(callback);
  }

  onOrderBook(callback: (book: OrderBookSnapshot) => void): void {
    this.bookCallbacks.push(callback);
  }

  // ── Private: WebSocket lifecycle ────────────────────────────────────────

  private createConnection(): void {
    try {
      this.ws = new WebSocket(WS_URL);
    } catch (err) {
      log.error("WebSocket constructor failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.backoffMs = BACKOFF_INITIAL_MS;
      log.info("Connected to Kuru CLOB", { url: WS_URL });

      this.sendSubscription();
      this.startPing();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.onMessage(event);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.connected = false;
      this.clearTimers();
      log.info("WebSocket closed", {
        code: event.code,
        reason: event.reason,
      });
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.connected = false;
      log.warn("WebSocket error detected");
      // onclose will fire after onerror, which handles reconnect
    };
  }

  private sendSubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const orderbookSub = JSON.stringify({
      type: "subscribe",
      channel: "orderbook",
    });
    const tradeSub = JSON.stringify({
      type: "subscribe",
      channel: "trade",
    });

    this.ws.send(orderbookSub);
    this.ws.send(tradeSub);
    log.info("Subscribed to orderbook + trade channels");
  }

  private onMessage(event: MessageEvent): void {
    this.resetPongTimer();

    let data: unknown;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      log.warn("Failed to parse WS message", { raw: String(event.data).slice(0, 200) });
      return;
    }

    if (typeof data !== "object" || data === null) return;

    const msg = data as Record<string, unknown>;

    if (msg.type === "orderbook") {
      this.handleOrderBookMessage(msg as unknown as RawOrderBookMessage);
    } else if (msg.type === "trade") {
      this.handleTradeMessage(msg as unknown as RawTradeMessage);
    }
  }

  // ── Private: Order book parsing ─────────────────────────────────────────

  private handleOrderBookMessage(msg: RawOrderBookMessage): void {
    try {
      const bids = msg.bids.map(([p, s]) => [Number(p), Number(s)] as const);
      const asks = msg.asks.map(([p, s]) => [Number(p), Number(s)] as const);

      const bestBid = bids.length > 0 ? bids[0]![0] : 0;
      const bestAsk = asks.length > 0 ? asks[0]![0] : 0;
      const spread = bestAsk - bestBid;
      const mid = (bestBid + bestAsk) / 2;

      const snapshot: OrderBookSnapshot = {
        bids,
        asks,
        bestBid,
        bestAsk,
        spread,
        mid,
        timestamp: Date.now(),
      };

      this.orderBook = snapshot;
      for (const cb of this.bookCallbacks) {
        try {
          cb(snapshot);
        } catch (err) {
          log.error("Book callback error", { error: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch (err) {
      log.warn("Failed to parse orderbook message", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Private: Trade-to-bar aggregation ───────────────────────────────────

  private handleTradeMessage(msg: RawTradeMessage): void {
    try {
      const price = Number(msg.price);
      const size = Number(msg.size);
      const timestamp = msg.timestamp;

      if (isNaN(price) || isNaN(size)) {
        log.warn("Invalid trade values", { price: msg.price, size: msg.size });
        return;
      }

      const tradeSecond = Math.floor(timestamp / 1000);

      if (this.currentBar === null || tradeSecond !== this.currentBarSecond) {
        // Emit the previous bar if it exists
        if (this.currentBar !== null) {
          this.emitBar(this.currentBar);
        }
        // Start a new bar
        this.currentBarSecond = tradeSecond;
        this.currentBar = {
          timestamp: tradeSecond * 1000,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: size,
        };
      } else {
        // Update existing bar
        const bar = this.currentBar as OHLCVBar;
        this.currentBar = {
          timestamp: bar.timestamp,
          open: bar.open,
          high: Math.max(bar.high, price),
          low: Math.min(bar.low, price),
          close: price,
          volume: bar.volume + size,
        };
      }
    } catch (err) {
      log.warn("Failed to parse trade message", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private emitBar(bar: OHLCVBar): void {
    this.barHistory.push(bar);
    if (this.barHistory.length > MAX_BAR_HISTORY) {
      this.barHistory = this.barHistory.slice(-MAX_BAR_HISTORY);
    }

    for (const cb of this.barCallbacks) {
      try {
        cb(bar);
      } catch (err) {
        log.error("Bar callback error", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // ── Private: Reconnection ───────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;

    log.info(`Reconnecting in ${this.backoffMs}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createConnection();
    }, this.backoffMs);

    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
  }

  // ── Private: Heartbeat ──────────────────────────────────────────────────

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      try {
        this.ws.send(JSON.stringify({ type: "ping" }));
      } catch (err) {
        log.warn("Failed to send ping", { error: err instanceof Error ? err.message : String(err) });
      }

      this.resetPongTimer();
    }, PING_INTERVAL_MS);
  }

  private resetPongTimer(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);

    this.pongTimer = setTimeout(() => {
      log.warn("No message received within timeout, forcing reconnect");
      this.pongTimer = null;
      if (this.ws) {
        this.ws.close(4000, "heartbeat timeout");
      }
    }, PONG_TIMEOUT_MS);
  }

  private clearTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
