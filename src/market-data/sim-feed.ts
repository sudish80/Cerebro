import { LOOP } from "../config";
import type { OHLCVBar, OrderBookSnapshot, MarketDataFeed } from "../types";

const MAX_BAR_HISTORY = 1000;

function randomWalk(prev: number, volatility = 0.002): number {
  const drift = (Math.random() - 0.5) * 2 * volatility * prev;
  return prev + drift;
}

function generateBar(prevClose: number, timestamp: number): OHLCVBar {
  const open = prevClose;
  const close = randomWalk(open);
  const high = Math.max(open, close) * (1 + Math.random() * 0.001);
  const low = Math.min(open, close) * (1 - Math.random() * 0.001);
  const volume = 1000 + Math.random() * 9000;
  return { timestamp, open, high, low, close, volume };
}

function generateOrderBook(closePrice: number): OrderBookSnapshot {
  const timestamp = Date.now();
  const halfSpread = closePrice * 0.0001 * (1 + Math.random());
  const bestBid = closePrice - halfSpread;
  const bestAsk = closePrice + halfSpread;
  const spread = bestAsk - bestBid;
  const mid = (bestBid + bestAsk) / 2;

  const bids: [number, number][] = [];
  const asks: [number, number][] = [];

  for (let i = 0; i < LOOP.orderBookLevels; i++) {
    const bidTick = closePrice * 0.0001 * (i + 1);
    const askTick = closePrice * 0.0001 * (i + 1);
    bids.push([bestBid - bidTick, Math.round(50 + Math.random() * 500)]);
    asks.push([bestAsk + askTick, Math.round(50 + Math.random() * 500)]);
  }

  return { bids, asks, bestBid, bestAsk, spread, mid, timestamp };
}

export class SimulatedFeed implements MarketDataFeed {
  private running = false;
  private lastClose: number = LOOP.basePrice;
  private timer: ReturnType<typeof setInterval> | null = null;

  private orderBook: OrderBookSnapshot | null = null;
  private currentBar: OHLCVBar | null = null;
  private barHistory: OHLCVBar[] = [];

  private barCallbacks: ((bar: OHLCVBar) => void)[] = [];
  private bookCallbacks: ((book: OrderBookSnapshot) => void)[] = [];

  async connect(): Promise<void> {
    this.running = true;
    this.tick();
    this.timer = setInterval(() => {
      if (this.running) this.tick();
    }, LOOP.tickIntervalMs);
  }

  disconnect(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isConnected(): boolean {
    return this.running;
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

  private tick(): void {
    const bar = generateBar(this.lastClose, Date.now());
    this.lastClose = bar.close;
    this.currentBar = bar;

    this.barHistory.push(bar);
    if (this.barHistory.length > MAX_BAR_HISTORY) {
      this.barHistory = this.barHistory.slice(-MAX_BAR_HISTORY);
    }

    const orderBook = generateOrderBook(bar.close);
    this.orderBook = orderBook;

    for (const cb of this.barCallbacks) {
      try {
        cb(bar);
      } catch {
        // swallow callback errors
      }
    }

    for (const cb of this.bookCallbacks) {
      try {
        cb(orderBook);
      } catch {
        // swallow callback errors
      }
    }
  }
}
