const ALGO = "AES-GCM";
const KDF_ALGO = "PBKDF2";
const HASH = "SHA-256";
const ITERATIONS = 300000;
const IV_LENGTH = 12;

export const generateRandomBytes = (
  len: number = 16,
): Uint8Array<ArrayBuffer> => {
  return crypto.getRandomValues(new Uint8Array(len));
};

export const deriveKEK = async (
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> => {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    KDF_ALGO,
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: KDF_ALGO, salt, iterations: ITERATIONS, hash: HASH },
    baseKey,
    { name: ALGO, length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
};

export const generateDEK = async (): Promise<CryptoKey> => {
  return crypto.subtle.generateKey({ name: ALGO, length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
};

export async function encrypt(
  data: string | Uint8Array<ArrayBuffer>,
  key: CryptoKey,
  as: "bytes",
): Promise<Uint8Array>;
export async function encrypt(
  data: string | Uint8Array<ArrayBuffer>,
  key: CryptoKey,
  as: "string",
): Promise<string>;
export async function encrypt(
  data: string | Uint8Array<ArrayBuffer>,
  key: CryptoKey,
): Promise<Uint8Array>;
export async function encrypt(
  data: string | Uint8Array<ArrayBuffer>,
  key: CryptoKey,
  as: string = "bytes",
): Promise<Uint8Array | string> {
  const iv = generateRandomBytes(IV_LENGTH);
  const buffer =
    typeof data === "string" ? new TextEncoder().encode(data) : data;

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    buffer,
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  if (as === "string") return new TextDecoder().decode(combined);
  return combined;
}

export const decrypt = async (
  blob: Uint8Array,
  key: CryptoKey,
  asString: boolean = true,
): Promise<string | Uint8Array> => {
  const iv = blob.slice(0, IV_LENGTH);
  const ciphertext = blob.slice(IV_LENGTH);

  // This will THROW an error if the key/password is wrong (MAC check)
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    ciphertext,
  );

  return asString
    ? new TextDecoder().decode(decrypted)
    : new Uint8Array(decrypted);
};

export const cryptoKeyToJwk = (key: CryptoKey): Promise<JsonWebKey> => {
  return crypto.subtle.exportKey("jwk", key);
};

export const jwkToCryptoKey = (jwk: JsonWebKey): Promise<CryptoKey> => {
  return crypto.subtle.importKey("jwk", jwk, ALGO, true, [
    "encrypt",
    "decrypt",
  ]);
};

export const wrapDEK = async (
  dek: CryptoKey,
  kek: CryptoKey,
): Promise<Uint8Array> => {
  const rawDek = await crypto.subtle.exportKey("raw", dek);
  return encrypt(new Uint8Array(rawDek), kek);
};

export const unwrapDEK = async (
  wrappedBlob: Uint8Array<ArrayBuffer>,
  kek: CryptoKey,
): Promise<CryptoKey> => {
  const rawDek = (await decrypt(
    wrappedBlob,
    kek,
    false,
  )) as Uint8Array<ArrayBuffer>;
  return crypto.subtle.importKey("raw", rawDek, ALGO, true, [
    "encrypt",
    "decrypt",
  ]);
};
