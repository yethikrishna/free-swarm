import React from 'react';
import TextField from '@mui/material/TextField';
import type { SchemaNode } from '@/shared/inputSchemaDefaults';

interface FieldProps {
  schema: SchemaNode;
  value: any;
  onChange: (value: any) => void;
  label?: string;
  required?: boolean;
}

const helperSx = {
  mb: 1.5,
  '& .MuiOutlinedInput-root': { fontSize: '0.85rem' },
  '& .MuiFormHelperText-root': { fontSize: '0.7rem' },
} as const;

/** Number/integer input that honors minimum/maximum/multipleOf and, crucially,
 *  keeps a local string buffer so the user can clear the field or type a partial
 *  value ("-", "1.") without it snapping back to 0. Emits parsed numbers on each
 *  keystroke and clamps to range on blur. */
export const NumberField: React.FC<FieldProps> = ({ schema, value, onChange, label, required }) => {
  const isInt = schema.type === 'integer';
  const min = schema.minimum ?? schema.exclusiveMinimum;
  const max = schema.maximum ?? schema.exclusiveMaximum;
  const step = schema.multipleOf ?? (isInt ? 1 : undefined);

  // Buffer the raw text so a transient empty / partial entry survives re-render.
  const [text, setText] = React.useState<string>(value === undefined || value === null ? '' : String(value));
  const focusedRef = React.useRef(false);
  React.useEffect(() => {
    // Sync external changes only while the user isn't actively editing.
    if (!focusedRef.current) setText(value === undefined || value === null ? '' : String(value));
  }, [value]);

  const rangeError = (() => {
    if (text.trim() === '') return required ? 'Required' : '';
    const n = Number(text);
    if (Number.isNaN(n)) return 'Enter a number';
    if (isInt && !Number.isInteger(n)) return 'Whole number only';
    if (typeof min === 'number' && n < min) return `Min ${min}`;
    if (typeof max === 'number' && n > max) return `Max ${max}`;
    return '';
  })();

  const commit = (raw: string) => {
    setText(raw);
    if (raw.trim() === '') return; // leave prior value; blur will normalize
    const n = Number(raw);
    if (!Number.isNaN(n)) onChange(isInt ? Math.trunc(n) : n);
  };

  const normalizeOnBlur = () => {
    focusedRef.current = false;
    if (text.trim() === '') return;
    let n = Number(text);
    if (Number.isNaN(n)) { setText(value === undefined || value === null ? '' : String(value)); return; }
    if (typeof min === 'number' && n < min) n = min;
    if (typeof max === 'number' && n > max) n = max;
    if (isInt) n = Math.trunc(n);
    setText(String(n));
    onChange(n);
  };

  return (
    <TextField
      fullWidth
      size="small"
      type="number"
      required={required}
      label={label}
      error={!!rangeError}
      helperText={rangeError || schema.description}
      value={text}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => commit(e.target.value)}
      onBlur={normalizeOnBlur}
      inputProps={{ min, max, step }}
      sx={helperSx}
    />
  );
};

// Maps a JSON Schema string `format` to an HTML input type + validation hint.
const FORMAT_INPUT: Record<string, { type: string; shrink?: boolean }> = {
  email: { type: 'email' },
  uri: { type: 'url' },
  url: { type: 'url' },
  password: { type: 'password' },
  date: { type: 'date', shrink: true },
  'date-time': { type: 'datetime-local', shrink: true },
  time: { type: 'time', shrink: true },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** String input. Multiline is decided ONCE from the schema (format=textarea or a
 *  large maxLength), never from the live value length, which previously toggled
 *  the control mid-typing and stole focus. Honors minLength/maxLength/pattern and
 *  format-driven input types (email, url, date, password, ...). */
export const StringField: React.FC<FieldProps> = ({ schema, value, onChange, label, required }) => {
  const fmt = (schema.format || '').toLowerCase();
  const fmtCfg = FORMAT_INPUT[fmt];
  const multiline = fmt === 'textarea' || fmt === 'multiline' || (typeof schema.maxLength === 'number' && schema.maxLength > 120);
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);

  const error = (() => {
    if (str === '') return required ? 'Required' : '';
    if (typeof schema.minLength === 'number' && str.length < schema.minLength) return `Min ${schema.minLength} characters`;
    if (fmt === 'email' && !EMAIL_RE.test(str)) return 'Enter a valid email';
    if (schema.pattern) {
      try { if (!new RegExp(schema.pattern).test(str)) return 'Invalid format'; } catch { /* bad pattern in schema: skip */ }
    }
    return '';
  })();

  const counter = typeof schema.maxLength === 'number'
    ? `${str.length}/${schema.maxLength}`
    : '';

  return (
    <TextField
      fullWidth
      size="small"
      required={required}
      label={label}
      type={multiline ? 'text' : (fmtCfg?.type ?? 'text')}
      multiline={multiline}
      minRows={multiline ? 3 : undefined}
      maxRows={multiline ? 10 : undefined}
      error={!!error}
      helperText={error || schema.description || counter}
      value={str}
      onChange={(e) => onChange(e.target.value)}
      inputProps={{ maxLength: schema.maxLength, minLength: schema.minLength }}
      InputLabelProps={fmtCfg?.shrink ? { shrink: true } : undefined}
      sx={helperSx}
    />
  );
};
