import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { EnvSecretsProvider } from "../src/brain/secrets-provider";

let provider: EnvSecretsProvider;

beforeEach(() => {
  provider = new EnvSecretsProvider();
  process.env.TEST_SECRET_KEY = "test-secret-value-12345";
});

afterEach(() => {
  delete process.env.TEST_SECRET_KEY;
  delete process.env.TEST_ANOTHER_SECRET;
});

describe("EnvSecretsProvider", () => {
  describe("getSecret()", () => {
    it("returns env value for existing key", async () => {
      const value = await provider.getSecret("TEST_SECRET_KEY");
      expect(value).toBe("test-secret-value-12345");
    });

    it("returns null for missing key", async () => {
      const value = await provider.getSecret("NONEXISTENT_KEY_99999");
      expect(value).toBeNull();
    });

    it("returns empty string for empty env var", async () => {
      process.env.TEST_EMPTY = "";
      const value = await provider.getSecret("TEST_EMPTY");
      expect(value).toBe("");
      delete process.env.TEST_EMPTY;
    });
  });

  describe("getSecretOrThrow()", () => {
    it("returns env value for existing key", async () => {
      const value = await provider.getSecretOrThrow("TEST_SECRET_KEY");
      expect(value).toBe("test-secret-value-12345");
    });

    it("throws for missing key", async () => {
      let threw = false;
      try {
        await provider.getSecretOrThrow("NONEXISTENT_KEY_99999");
      } catch (e) {
        threw = true;
        expect((e as Error).message).toContain("NONEXISTENT_KEY_99999");
      }
      expect(threw).toBe(true);
    });
  });

  describe("hasSecret()", () => {
    it("returns true for existing key", async () => {
      expect(await provider.hasSecret("TEST_SECRET_KEY")).toBe(true);
    });

    it("returns false for missing key", async () => {
      expect(await provider.hasSecret("NONEXISTENT_KEY_99999")).toBe(false);
    });

    it("returns true after setting env var", async () => {
      process.env.TEST_ANOTHER_SECRET = "hello";
      expect(await provider.hasSecret("TEST_ANOTHER_SECRET")).toBe(true);
    });

    it("returns false after deleting env var", async () => {
      process.env.TEST_ANOTHER_SECRET = "hello";
      expect(await provider.hasSecret("TEST_ANOTHER_SECRET")).toBe(true);
      delete process.env.TEST_ANOTHER_SECRET;
      expect(await provider.hasSecret("TEST_ANOTHER_SECRET")).toBe(false);
    });
  });
});
