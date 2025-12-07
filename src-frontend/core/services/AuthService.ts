import { invoke } from "@tauri-apps/api/core";

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const VALIDATION_TOKEN = "COLLAB_ACCESS_GRANTED_V1";

export class AuthService {
  private encryptionKey: string = "";

  setKey(key: string) {
    this.encryptionKey = key;
    localStorage.setItem("encryptionKey", key);
  }

  getKey(): string {
    return this.encryptionKey;
  }

  hasKey(): boolean {
    return !!this.encryptionKey;
  }

  async getCryptoKey(password: string): Promise<CryptoKey> {
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw", 
      ENC.encode(password), 
      "PBKDF2", 
      false, 
      ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: ENC.encode("COLLAB_FIXED_SALT_V1"), iterations: 100000, hash: "SHA-256" },
      keyMaterial, 
      { name: "AES-GCM", length: 256 }, 
      false, 
      ["encrypt", "decrypt"]
    );
  }

  async encrypt(data: string, password?: string): Promise<string> {
    const pass = password || this.encryptionKey;
    if (!pass) throw new Error("No encryption key provided");

    const key = await this.getCryptoKey(pass);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, 
      key, 
      ENC.encode(data)
    );
    
    const buf = new Uint8Array(encrypted);
    const b64 = btoa(String.fromCharCode(...buf));
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${ivHex}:${b64}`;
  }

  async decrypt(cipherText: string, password?: string): Promise<string> {
    const pass = password || this.encryptionKey;
    if (!pass) throw new Error("No encryption key provided");

    const [ivHex, dataB64] = cipherText.split(':');
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const data = Uint8Array.from(atob(dataB64), c => c.charCodeAt(0));
    
    const key = await this.getCryptoKey(pass);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv }, 
      key, 
      data
    );
    return DEC.decode(decrypted);
  }

  async generateValidationToken(password?: string): Promise<string> {
    return this.encrypt(VALIDATION_TOKEN, password);
  }

  async validateToken(encryptedToken: string, password?: string): Promise<boolean> {
    try {
      const val = await this.decrypt(encryptedToken, password);
      return val === VALIDATION_TOKEN;
    } catch {
      return false;
    }
  }
}