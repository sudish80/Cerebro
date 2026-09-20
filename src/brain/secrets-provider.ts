export interface SecretsProvider {
  getSecret(key: string): Promise<string | null>;
  getSecretOrThrow(key: string): Promise<string>;
  hasSecret(key: string): Promise<boolean>;
}

export class EnvSecretsProvider implements SecretsProvider {
  async getSecret(key: string): Promise<string | null> {
    return process.env[key] ?? null;
  }

  async getSecretOrThrow(key: string): Promise<string> {
    const value = await this.getSecret(key);
    if (value === null || value === undefined) {
      throw new Error(`Secret "${key}" not found in environment`);
    }
    return value;
  }

  async hasSecret(key: string): Promise<boolean> {
    return (await this.getSecret(key)) !== null;
  }
}

export class VaultSecretsProvider implements SecretsProvider {
  private readonly addr: string;
  private readonly token: string;
  private readonly mountPath: string;

  constructor(addr: string, token: string, mountPath = "secret") {
    this.addr = addr.replace(/\/+$/, "");
    this.token = token;
    this.mountPath = mountPath;
  }

  private async fetchSecret(key: string): Promise<Record<string, unknown> | null> {
    const url = `${this.addr}/v1/${this.mountPath}/data/${key}`;
    const res = await fetch(url, {
      headers: { "X-Vault-Token": this.token },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { data?: Record<string, unknown> } };
    return json.data?.data ?? null;
  }

  async getSecret(key: string): Promise<string | null> {
    const data = await this.fetchSecret(key);
    if (!data) return null;
    const value = data[key];
    if (typeof value !== "string") return null;
    return value;
  }

  async getSecretOrThrow(key: string): Promise<string> {
    const value = await this.getSecret(key);
    if (value === null) {
      throw new Error(`Secret "${key}" not found in Vault at ${this.mountPath}/data/${key}`);
    }
    return value;
  }

  async hasSecret(key: string): Promise<boolean> {
    return (await this.getSecret(key)) !== null;
  }
}

export function createSecretsProvider(): SecretsProvider {
  const vaultAddr = process.env.VAULT_ADDR;
  if (vaultAddr) {
    const token = process.env.VAULT_TOKEN;
    if (!token) {
      throw new Error("VAULT_ADDR is set but VAULT_TOKEN is missing");
    }
    const mountPath = process.env.VAULT_MOUNT_PATH || "secret";
    return new VaultSecretsProvider(vaultAddr, token, mountPath);
  }
  return new EnvSecretsProvider();
}
