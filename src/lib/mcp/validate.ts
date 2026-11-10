export type JsonSchema = {
  type?: string;
  format?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateArgs(schema: JsonSchema, value: unknown, path = ""): string | null {
  if (schema.type === "object" || schema.properties) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${path || "arguments"} must be an object`;
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] == null || obj[key] === "") return `${path}${key} is required`;
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (!known.has(key)) return `${path}${key} is not allowed`;
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (obj[key] == null) continue;
      const err = validateArgs(child, obj[key], `${path}${key}.`);
      if (err) return err;
    }
    return null;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path.slice(0, -1) || "value"} must be one of ${schema.enum.join(", ")}`;
  if (schema.type === "string") {
    if (typeof value !== "string") return `${path.slice(0, -1) || "value"} must be a string`;
    if (schema.format === "uuid" && !UUID.test(value)) return `${path.slice(0, -1) || "value"} must be a uuid`;
    if (schema.minLength != null && value.length < schema.minLength) return `${path.slice(0, -1) || "value"} is too short`;
    if (schema.maxLength != null && value.length > schema.maxLength) return `${path.slice(0, -1) || "value"} is too long`;
    return null;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${path.slice(0, -1) || "value"} must be a number`;
    if (schema.type === "integer" && !Number.isInteger(value)) return `${path.slice(0, -1) || "value"} must be an integer`;
    if (schema.minimum != null && value < schema.minimum) return `${path.slice(0, -1) || "value"} must be >= ${schema.minimum}`;
    if (schema.maximum != null && value > schema.maximum) return `${path.slice(0, -1) || "value"} must be <= ${schema.maximum}`;
    return null;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") return `${path.slice(0, -1) || "value"} must be a boolean`;
    return null;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${path.slice(0, -1) || "value"} must be an array`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const err = validateArgs(schema.items, value[i], `${path.slice(0, -1)}[${i}].`);
        if (err) return err;
      }
    }
    return null;
  }
  return null;
}
