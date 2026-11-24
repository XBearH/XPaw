import { safeStorage } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class SecretVault {
  constructor(private readonly path: string) {}

  get(key: string): string | undefined {
    const values = this.read();
    const encrypted = values[key];
    if (!encrypted || !safeStorage.isEncryptionAvailable()) return undefined;
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  set(key: string, value: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows credential encryption is unavailable.");
    const values = this.read();
    if (value) values[key] = safeStorage.encryptString(value).toString("base64");
    else delete values[key];
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(values), { encoding: "utf8", mode: 0o600 });
  }

  private read(): Record<string, string> {
    try { return JSON.parse(readFileSync(this.path, "utf8")) as Record<string, string>; }
    catch { return {}; }
  }
}
