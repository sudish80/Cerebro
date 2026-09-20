import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Address,
  type Hash,
  type Chain,
  type TransactionRequest,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import type { SecretsProvider } from "../brain/secrets-provider";

function resolveChain(chainId: number): Chain {
  if (chainId === monadTestnet.id) return monadTestnet;
  return {
    id: chainId,
    name: `Custom Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [process.env.RPC_URL || "https://rpc.ankr.com/eth"] },
      public: { http: [process.env.RPC_URL || "https://rpc.ankr.com/eth"] },
    },
  };
}

export interface WalletManager {
  readonly address: Address;
  readonly chainId: number;
  getWalletClient(): WalletClient;
  getPublicClient(): PublicClient;
  signTransaction(tx: TransactionRequest): Promise<Hash>;
  sendTransaction(tx: TransactionRequest): Promise<Hash>;
  getBalance(): Promise<bigint>;
  getNonce(): Promise<number>;
}

export async function createWalletManager(secrets: SecretsProvider): Promise<WalletManager> {
  const privateKeyRaw = await secrets.getSecretOrThrow("PRIVATE_KEY");
  const privateKey = privateKeyRaw.startsWith("0x") ? privateKeyRaw : `0x${privateKeyRaw}`;
  const chainId = parseInt(process.env.CHAIN_ID || "10143", 10);

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const chain = resolveChain(chainId);

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(process.env.RPC_URL),
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(process.env.RPC_URL),
  });

  return {
    address: account.address,
    chainId,
    getWalletClient: () => walletClient,
    getPublicClient: () => publicClient,

    async signTransaction(tx: TransactionRequest): Promise<Hash> {
      return walletClient.signTransaction({
        ...tx,
        account,
        chain,
      } as any);
    },

    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
      return walletClient.sendTransaction({
        ...tx,
        account,
        chain,
        chainId,
      } as any);
    },

    async getBalance(): Promise<bigint> {
      return publicClient.getBalance({ address: account.address });
    },

    async getNonce(): Promise<number> {
      return publicClient.getTransactionCount({ address: account.address });
    },
  };
}
