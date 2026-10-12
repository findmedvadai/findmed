// Verifies WHAAPY webhook signatures (HMAC-SHA256, hex).
//
// Observed contract (docs/findmed-migration/hallazgos.md N20, N26):
//  * header: docs say `X-Webhook-Signature`; the WHAAPY dashboard says
//    `X-Whaapy-Signature` — both are accepted;
//  * signed content: the docs' samples sign JSON.stringify(parsedBody), i.e.
//    the compact re-serialization, not necessarily the raw bytes. We accept a
//    match on either the raw body or its compact re-serialization; both are
//    computed with the shared secret, so neither weakens the check.

import { timingSafeEqual } from "./service-auth.ts";

async function hmacHex(secret: string, content: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function signatureHeader(headers: Headers): string | null {
  const raw = headers.get("X-Webhook-Signature") ?? headers.get("X-Whaapy-Signature");
  if (!raw) return null;
  // Tolerate a "sha256=" prefix.
  return raw.trim().replace(/^sha256=/i, "").toLowerCase();
}

export async function verifyWhaapySignature(rawBody: string, headers: Headers, secret: string): Promise<boolean> {
  const presented = signatureHeader(headers);
  if (!presented || !secret) return false;
  if (timingSafeEqual(presented, await hmacHex(secret, rawBody))) return true;
  let compact: string;
  try {
    compact = JSON.stringify(JSON.parse(rawBody));
  } catch {
    return false;
  }
  return compact !== rawBody && timingSafeEqual(presented, await hmacHex(secret, compact));
}
