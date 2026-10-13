// Minimal JSON Schema validator for MCP tool arguments: the subset WHAAPY
// documents (object/string/integer/number/boolean/array, enum, required,
// additionalProperties:false) plus a few string/number constraints we use.
// WHAAPY validates before calling, but the server must not trust that (A1).

export interface Schema {
  type: "object" | "string" | "integer" | "number" | "boolean" | "array";
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  enum?: (string | number)[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
}

export interface SchemaError {
  field: string;
  reason: string;
}

export function validate(schema: Schema, value: unknown, path = ""): SchemaError | null {
  const field = path || "(root)";
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return { field, reason: "expected object" };
      const obj = value as Record<string, unknown>;
      for (const req of schema.required ?? []) {
        if (obj[req] === undefined || obj[req] === null) return { field: join(path, req), reason: "required" };
      }
      for (const [k, v] of Object.entries(obj)) {
        const sub = schema.properties?.[k];
        if (!sub) {
          if (schema.additionalProperties === false) return { field: join(path, k), reason: "unexpected property" };
          continue;
        }
        if (v === undefined || v === null) continue;
        const err = validate(sub, v, join(path, k));
        if (err) return err;
      }
      return null;
    }
    case "string": {
      if (typeof value !== "string") return { field, reason: "expected string" };
      if (schema.minLength !== undefined && value.trim().length < schema.minLength) return { field, reason: `minLength ${schema.minLength}` };
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return { field, reason: `maxLength ${schema.maxLength}` };
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return { field, reason: "invalid format" };
      if (schema.enum && !schema.enum.includes(value)) return { field, reason: `must be one of ${schema.enum.join(", ")}` };
      return null;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return { field, reason: `expected ${schema.type}` };
      if (schema.type === "integer" && !Number.isInteger(value)) return { field, reason: "expected integer" };
      if (schema.minimum !== undefined && value < schema.minimum) return { field, reason: `minimum ${schema.minimum}` };
      if (schema.maximum !== undefined && value > schema.maximum) return { field, reason: `maximum ${schema.maximum}` };
      if (schema.enum && !schema.enum.includes(value)) return { field, reason: `must be one of ${schema.enum.join(", ")}` };
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : { field, reason: "expected boolean" };
    case "array": {
      if (!Array.isArray(value)) return { field, reason: "expected array" };
      if (schema.minItems !== undefined && value.length < schema.minItems) return { field, reason: `minItems ${schema.minItems}` };
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return { field, reason: `maxItems ${schema.maxItems}` };
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const err = validate(schema.items, value[i], `${field}[${i}]`);
          if (err) return err;
        }
      }
      return null;
    }
  }
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

export const UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
export const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
