// Minimal in-memory stand-in for the supabase-js query builder, covering only
// what the shared domain modules use: from/select/insert/update, filters
// eq/neq/in/gt/lt/is/ilike, order/limit, single/maybeSingle, and awaiting a
// builder directly. Column lists and embeds in select() are ignored (rows are
// returned whole). Good enough to test control flow and guards; it does NOT
// emulate RLS, constraints or embeds — those are covered elsewhere.

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  /** Hook to simulate a concurrent writer: runs right before an UPDATE applies. */
  beforeUpdate?: (table: string) => void;

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }));
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    return new Query(this, table);
  }
}

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string) {
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert";
    this.payload = values;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  gt(col: string, v: string) {
    this.filters.push((r) => String(r[col]) > v);
    return this;
  }
  lt(col: string, v: string) {
    this.filters.push((r) => String(r[col]) < v);
    return this;
  }
  is(col: string, v: null) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  ilike(col: string, pattern: string) {
    const re = new RegExp("^" + pattern.replace(/%/g, ".*") + "$", "i");
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orderBy = { col, asc: opts.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private run(): { data: unknown; error: null } {
    const all = this.db.rows(this.table);
    let affected: Row[];
    if (this.op === "insert") {
      const items = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      affected = items.map((it) => ({ id: crypto.randomUUID(), ...it }));
      all.push(...affected);
    } else {
      if (this.op === "update") this.db.beforeUpdate?.(this.table);
      affected = all.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") for (const r of affected) Object.assign(r, this.payload);
    }
    let out = affected.map((r) => ({ ...r }));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.max !== null) out = out.slice(0, this.max);
    if (this.mode === "many") return { data: out, error: null };
    return { data: out[0] ?? null, error: null };
  }

  then<T1, T2>(
    onfulfilled?: ((v: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
  }
}

/** Replaces globalThis.fetch and records calls; every call returns `status`. */
export function stubFetch(status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: unknown = init?.body;
    try {
      body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    } catch { /* keep raw */ }
    calls.push({ url, body });
    return Promise.resolve(new Response("{}", { status }));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}
