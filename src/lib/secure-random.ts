// Cryptographically secure random string for credentials (API keys, webhook
// secrets). Math.random is not a CSPRNG and must not be used for secrets.
// Bytes >= the largest multiple of the alphabet size are rejected to avoid
// modulo bias.
export function secureRandomString(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit) out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}
