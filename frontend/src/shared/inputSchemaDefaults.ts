export interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
  enum?: string[];
  description?: string;
  default?: any;
  // Standard JSON Schema constraint keywords the backend validates against
  // (jsonschema). The run form honors these so users don't hit an avoidable
  // server-side "Schema validation failed" after filling the form.
  title?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
}

/** A number that satisfies the schema's range, falling back to 0 when 0 is in range. */
function defaultNumber(schema: SchemaNode): number {
  if (typeof schema.minimum === 'number') return schema.minimum;
  if (typeof schema.exclusiveMinimum === 'number') return schema.exclusiveMinimum + (schema.type === 'integer' ? 1 : 0);
  if (typeof schema.maximum === 'number' && schema.maximum < 0) return schema.maximum;
  return 0;
}

export function getDefault(schema: SchemaNode): any {
  if (schema.default !== undefined) return schema.default;
  // A required enum with no default starts immediately invalid if left empty;
  // seed the first option so the form is valid out of the box.
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case 'string': return '';
    case 'number':
    case 'integer': return defaultNumber(schema);
    case 'boolean': return false;
    case 'array': return [];
    case 'object': {
      const obj: Record<string, any> = {};
      if (schema.properties) {
        for (const [k, v] of Object.entries(schema.properties)) {
          obj[k] = getDefault(v);
        }
      }
      return obj;
    }
    default: return '';
  }
}
