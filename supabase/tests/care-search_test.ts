// R02 / R06: location and specialty resolution used by search-doctors and the MCP.
//
//   npm run test:edge

import { assertEquals } from "jsr:@std/assert@1";
import { normalizeText, resolvePlace, specialtyStem } from "../functions/_shared/care-search.ts";
import { isValidNormalizedPhone, normalizeMxPhone } from "../functions/_shared/phone.ts";

// Mirror of the shape of the `cities` catalog (names only matter here).
const CITIES = [
  { id: "c1", name: "Ciudad de México" },
  { id: "c2", name: "Querétaro" },
  { id: "c3", name: "Guadalajara" },
  { id: "c4", name: "Monterrey" },
  { id: "c5", name: "San Pedro Garza García" },
  { id: "c6", name: "San Luis Potosí" },
];
const ALIASES = {
  "cdmx": "ciudad de mexico",
  "df": "ciudad de mexico",
  "qro": "queretaro",
};

Deno.test("normalizeText strips accents, case and punctuation", () => {
  assertEquals(normalizeText("  Ciudad  de MÉXICO. "), "ciudad de mexico");
  assertEquals(normalizeText("C.D.M.X."), "c d m x");
});

Deno.test("R02 CDMX, DF and 'Ciudad de México' resolve to the same city", () => {
  for (const q of ["CDMX", "cdmx", "DF", "Ciudad de México", "ciudad de mexico", "CIUDAD DE MÉXICO"]) {
    const r = resolvePlace(q, CITIES, "ambiguous", ALIASES);
    assertEquals(r.kind, "match", q);
    if (r.kind === "match") assertEquals(r.places.map((p) => p.id), ["c1"], q);
  }
});

Deno.test("aliases and accent-insensitive exact match", () => {
  const r = resolvePlace("qro", CITIES, "ambiguous", ALIASES);
  assertEquals(r.kind === "match" && r.places[0].id, "c2");
  const r2 = resolvePlace("queretaro", CITIES, "ambiguous", ALIASES);
  assertEquals(r2.kind === "match" && r2.places[0].id, "c2");
});

Deno.test("R06 a fragment matching several cities is ambiguous, never a guess", () => {
  const r = resolvePlace("San", CITIES, "ambiguous", ALIASES);
  assertEquals(r.kind, "ambiguous");
  if (r.kind === "ambiguous") assertEquals(r.candidates.map((c) => c.id).sort(), ["c5", "c6"]);
});

Deno.test("R06 unknown city is reported as unknown", () => {
  assertEquals(resolvePlace("Tijuana", CITIES, "ambiguous", ALIASES).kind, "unknown");
  assertEquals(resolvePlace("   ", CITIES, "ambiguous", ALIASES).kind, "unknown");
});

Deno.test("zones: several partial matches are sub-zones (union), exact wins", () => {
  const zones = [
    { id: "z1", name: "Polanco I" },
    { id: "z2", name: "Polanco II" },
    { id: "z3", name: "Santa Fe" },
    { id: "z4", name: "Polanco" },
  ];
  const exact = resolvePlace("polanco", zones, "union");
  assertEquals(exact.kind === "match" && exact.places.map((z) => z.id), ["z4"]);
  const union = resolvePlace("polanco i", zones, "union");
  assertEquals(union.kind === "match" && union.places.map((z) => z.id).sort(), ["z1"]);
  const fe = resolvePlace("fe", zones, "union");
  assertEquals(fe.kind === "match" && fe.places.map((z) => z.id), ["z3"]);
});

Deno.test("specialty stems unify variants", () => {
  assertEquals(specialtyStem("Ginecología"), specialtyStem("ginecólogo"));
  assertEquals(specialtyStem("Ortopedia"), specialtyStem("ortopedista"));
  assertEquals(specialtyStem("Cardiología"), specialtyStem("cardiólogo"));
});

Deno.test("phone: malformed input is rejected after normalization", () => {
  for (const ok of ["5512345678", "+52 55 1234 5678", "521 55 1234 5678", "+1 415 555 0100"]) {
    assertEquals(isValidNormalizedPhone(normalizeMxPhone(ok)), true, ok);
  }
  for (const bad of ["abc", "", "12345", "+52 55 1234", "+52 55 1234 56789"]) {
    assertEquals(isValidNormalizedPhone(normalizeMxPhone(bad)), false, bad);
  }
});
