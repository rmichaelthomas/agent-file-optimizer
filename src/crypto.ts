export interface TokenPair {
  uploadToken: string;
  uploadTokenHash: string;
  shareToken: string;
  shareTokenHash: string;
}

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return base64Url(new Uint8Array(digest));
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function hashToken(token: string): Promise<string> {
  return hashBytes(encoder.encode(token));
}

export async function createTokenPair(): Promise<TokenPair> {
  const uploadToken = randomToken();
  const shareToken = randomToken();
  const [uploadTokenHash, shareTokenHash] = await Promise.all([
    hashToken(uploadToken),
    hashToken(shareToken),
  ]);
  return { uploadToken, uploadTokenHash, shareToken, shareTokenHash };
}

export function tokensMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
