/* ═══════════════════════════════════════════════════════════════════════════
   Cerebro Trader — Chain Reorganization Monitor
   Polls eth_blockNumber via JSON-RPC, tracks canonical chain, detects reorgs
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ReorgMonitor {
  start(rpcUrl: string): void;
  stop(): void;
  onReorg(callback: (reorg: ReorgEvent) => void): void;
  getConfirmedTx(hash: string): ConfirmedTx | null;
  trackTransaction(hash: string, expectedBlockNumber: number): void;
}

export interface ReorgEvent {
  readonly orphanedBlock: bigint;
  readonly newBlock: bigint;
  readonly depth: number;
  readonly affectedTxs: string[];
}

export interface ConfirmedTx {
  readonly hash: string;
  readonly blockNumber: number;
  readonly confirmations: number;
  readonly status: "pending" | "confirmed" | "reorged";
}

interface BlockEntry {
  readonly number: bigint;
  readonly hash: string;
}

// ── JSON-RPC helper ──────────────────────────────────────────────────────────

async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json()) as { result?: unknown; error?: unknown };
  if (data.error) {
    throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
  }
  return data.result;
}

async function getBlockNumber(rpcUrl: string): Promise<bigint> {
  const hex = (await rpcCall(rpcUrl, "eth_blockNumber", [])) as string;
  return BigInt(hex);
}

async function getBlockHash(rpcUrl: string, blockNumber: bigint): Promise<string> {
  const hex = `0x${blockNumber.toString(16)}`;
  const block = (await rpcCall(rpcUrl, "eth_getBlockByNumber", [hex, false])) as {
    hash: string;
  } | null;
  if (!block) throw new Error(`Block ${blockNumber} not found`);
  return block.hash;
}

async function getBlockTxHashes(
  rpcUrl: string,
  blockNumber: bigint,
): Promise<string[]> {
  const hex = `0x${blockNumber.toString(16)}`;
  const block = (await rpcCall(rpcUrl, "eth_getBlockByNumber", [hex, true])) as {
    transactions: Array<{ hash: string }>;
  } | null;
  if (!block) throw new Error(`Block ${blockNumber} not found`);
  return block.transactions.map((tx) => tx.hash);
}

// ── Factory ──────────────────────────────────────────────────────────────────

const MAX_DEPTH = 10;
const POLL_INTERVAL_MS = 2000;

export function createReorgMonitor(): ReorgMonitor {
  let rpcUrl = "";
  let polling = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let currentHeight = 0n;
  let reorgCallbacks: Array<(reorg: ReorgEvent) => void> = [];

  // Canonical chain: number -> hash (last MAX_DEPTH blocks)
  const canonicalChain: BlockEntry[] = [];

  // Tracked transactions: hash -> { blockNumber, status, confirmations }
  const trackedTxs: Map<string, ConfirmedTx> = new Map();

  function pushBlock(entry: BlockEntry): void {
    canonicalChain.push(entry);
    if (canonicalChain.length > MAX_DEPTH) {
      canonicalChain.shift();
    }
  }

  function matchesParent(newHash: string): boolean {
    if (canonicalChain.length === 0) return true;
    const last = canonicalChain[canonicalChain.length - 1];
    return last?.hash === newHash;
  }

  function findCommonAncestorDepth(
    oldChain: BlockEntry[],
    newHash: string,
  ): number {
    for (let i = oldChain.length - 1; i >= 0; i--) {
      if (oldChain[i]!.hash === newHash) {
        return oldChain.length - 1 - i;
      }
    }
    return -1;
  }

  async function poll(): Promise<void> {
    if (!rpcUrl || !polling) return;

    try {
      const latest = await getBlockNumber(rpcUrl);

      if (currentHeight === 0n) {
        // First poll: initialize chain
        currentHeight = latest;
        let blockNum = latest;
        for (let i = 0; i < MAX_DEPTH; i++) {
          const hash = await getBlockHash(rpcUrl, blockNum);
          pushBlock({ number: blockNum, hash });
          if (blockNum === 0n) break;
          blockNum -= 1n;
        }
        updateConfirmations(Number(latest));
        return;
      }

      if (latest <= currentHeight) return;

      // Walk from currentHeight+1 to latest
      for (let bn = currentHeight + 1n; bn <= latest; bn++) {
        const newHash = await getBlockHash(rpcUrl, bn);

        if (!matchesParent(newHash)) {
          // Potential reorg detected
          const oldChainSnapshot = [...canonicalChain];
          const depth = findCommonAncestorDepth(oldChainSnapshot, newHash);

          if (depth >= 0) {
            // Determine orphaned blocks and affected txs
            const orphanedBlocks: bigint[] = [];
            const affectedTxs: string[] = [];

            for (let i = 0; i < depth; i++) {
              const orphaned = oldChainSnapshot[oldChainSnapshot.length - 1 - i];
              if (orphaned) {
                orphanedBlocks.push(orphaned.number);
                const orphanedHashes = await getBlockTxHashes(rpcUrl, orphaned.number);
                for (const txHash of orphanedHashes) {
                  const tracked = trackedTxs.get(txHash);
                  if (tracked) {
                    affectedTxs.push(txHash);
                    trackedTxs.set(txHash, { ...tracked, status: "reorged" });
                  }
                }
              }
            }

            const reorg: ReorgEvent = {
              orphanedBlock: orphanedBlocks[0] ?? 0n,
              newBlock: bn,
              depth,
              affectedTxs,
            };

            for (const cb of reorgCallbacks) {
              cb(reorg);
            }

            // Trim canonical chain back by depth
            canonicalChain.splice(canonicalChain.length - depth, depth);
          }
        }

        const hash = await getBlockHash(rpcUrl, bn);
        pushBlock({ number: bn, hash });
      }

      currentHeight = latest;
      updateConfirmations(Number(latest));
    } catch (err) {
      console.error("[REORG] Poll error:", err);
    }
  }

  function updateConfirmations(latestBlock: number): void {
    for (const [hash, tx] of trackedTxs) {
      if (tx.status === "reorged") continue;
      if (tx.status === "pending") {
        if (latestBlock >= tx.blockNumber) {
          const confirmations = latestBlock - tx.blockNumber + 1;
          trackedTxs.set(hash, {
            ...tx,
            status: confirmations >= 1 ? "confirmed" : "pending",
            confirmations,
          });
        }
      } else if (tx.status === "confirmed") {
        const confirmations = latestBlock - tx.blockNumber + 1;
        trackedTxs.set(hash, { ...tx, confirmations });
      }
    }
  }

  return {
    start(url: string): void {
      rpcUrl = url;
      polling = true;
      currentHeight = 0n;
      canonicalChain.length = 0;
      pollTimer = setInterval(() => {
        poll();
      }, POLL_INTERVAL_MS);
      console.log(`[REORG] Monitor started, polling ${url} every ${POLL_INTERVAL_MS}ms`);
    },

    stop(): void {
      polling = false;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      console.log("[REORG] Monitor stopped");
    },

    onReorg(callback: (reorg: ReorgEvent) => void): void {
      reorgCallbacks.push(callback);
    },

    getConfirmedTx(hash: string): ConfirmedTx | null {
      return trackedTxs.get(hash) ?? null;
    },

    trackTransaction(hash: string, expectedBlockNumber: number): void {
      trackedTxs.set(hash, {
        hash,
        blockNumber: expectedBlockNumber,
        confirmations: 0,
        status: "pending",
      });
      console.log(`[REORG] Tracking tx ${hash} at block ${expectedBlockNumber}`);
    },
  };
}
