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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when the root schema declares no inputs (object with no properties),
 *  which is the model default. The run form shows a "no inputs" state for this. */
export function schemaHasNoInputs(schema: SchemaNode | undefined | null): boolean {
  if (!schema) return true;
  if (schema.enum && schema.enum.length > 0) return false;
  if (schema.type && schema.type !== 'object') return false;
  return !schema.properties || Object.keys(schema.properties).length === 0;
}

/** Validate a single value against its schema node. Returns a RED-worthy error
 *  message, or '' if fine. A required-but-empty value is NOT a hard error here
 *  (it reads as alarming on a pristine form); the aggregate gate handles "missing
 *  required" separately via collectIssues. Leaf/enum/array-length only. */
export function validateNode(schema: SchemaNode, value: any): string {
  if (schema.enum && schema.enum.length > 0) return '';
  const t = schema.type;
  if (t === 'number' || t === 'integer') {
    if (value === undefined || value === null || value === '') return '';
    const n = Number(value);
    if (Number.isNaN(n)) return 'Enter a number';
    if (t === 'integer' && !Number.isInteger(n)) return 'Whole number only';
    const min = schema.minimum ?? schema.exclusiveMinimum;
    const max = schema.maximum ?? schema.exclusiveMaximum;
    if (typeof min === 'number' && n < min) return `Min ${min}`;
    if (typeof max === 'number' && n > max) return `Max ${max}`;
    return '';
  }
  if (t === 'string') {
    const str = typeof value === 'string' ? value : value == null ? '' : String(value);
    if (str === '') return '';
    if (typeof schema.minLength === 'number' && str.length < schema.minLength) return `Min ${schema.minLength} characters`;
    const fmt = (schema.format || '').toLowerCase();
    if (fmt === 'email' && !EMAIL_RE.test(str)) return 'Enter a valid email';
    if (schema.pattern) { try { if (!new RegExp(schema.pattern).test(str)) return 'Invalid format'; } catch { /* bad pattern in schema: skip */ } }
    return '';
  }
  if (t === 'array') {
    const arr = Array.isArray(value) ? value : [];
    if (typeof schema.minItems === 'number' && arr.length < schema.minItems) return `Add at least ${schema.minItems}`;
    if (typeof schema.maxItems === 'number' && arr.length > schema.maxItems) return `At most ${schema.maxItems}`;
    return '';
  }
  return '';
}

function isEmptyValue(schema: SchemaNode, value: any): boolean {
  if (schema.enum && schema.enum.length > 0) return value === undefined || value === null || value === '';
  if (schema.type === 'string') return value === undefined || value === null || value === '';
  if (schema.type === 'number' || schema.type === 'integer') return value === undefined || value === null || value === '';
  if (schema.type === 'array') return !Array.isArray(value) || value.length === 0;
  return value === undefined || value === null;
}

export interface FieldIssue { label: string; message: string; kind: 'error' | 'missing'; }

/** Walk the schema tree and collect every blocking issue: hard validation errors
 *  (kind 'error') and missing required fields (kind 'missing'). The run dialog uses
 *  this to gate the Execute button and craft a calm, single-line hint. */
export function collectIssues(schema: SchemaNode, value: any, label = '', required = false): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (!schema.enum && schema.type === 'object' && schema.properties) {
    const obj = value && typeof value === 'object' ? value : {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      issues.push(...collectIssues(propSchema, obj[key], propSchema.title || key, schema.required?.includes(key)));
    }
    return issues;
  }

  if (required && isEmptyValue(schema, value)) {
    issues.push({ label: label || 'Field', message: 'Required', kind: 'missing' });
  }

  if (!schema.enum && schema.type === 'array' && schema.items) {
    const own = validateNode(schema, value);
    if (own) issues.push({ label: label || 'List', message: own, kind: 'error' });
    const arr = Array.isArray(value) ? value : [];
    arr.forEach((item, i) => issues.push(...collectIssues(schema.items!, item, `${label || 'Item'} ${i + 1}`, false)));
    return issues;
  }

  const msg = validateNode(schema, value);
  if (msg) issues.push({ label: label || 'Field', message: msg, kind: 'error' });
  return issues;
}

