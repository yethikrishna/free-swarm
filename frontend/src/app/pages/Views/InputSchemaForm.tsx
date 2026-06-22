import React from 'react';
import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { getDefault, type SchemaNode } from '@/shared/inputSchemaDefaults';
import { NumberField, StringField } from './inputSchemaFields';

interface Props {
  schema: SchemaNode;
  value: any;
  onChange: (value: any) => void;
  label?: string;
  required?: boolean;
  depth?: number;
}

const InputSchemaForm: React.FC<Props> = ({ schema, value, onChange, label, required, depth = 0 }) => {
  const c = useClaudeTokens();

  if (schema.enum && schema.enum.length > 0) {
    const empty = value === undefined || value === null || value === '';
    return (
      <FormControl fullWidth size="small" required={required} error={required && empty} sx={{ mb: 1.5 }}>
        {label && <InputLabel>{label}</InputLabel>}
        <Select
          value={value ?? ''}
          label={label}
          displayEmpty
          onChange={(e) => onChange(e.target.value)}
          sx={{
            fontSize: '0.85rem',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: c.border.medium },
          }}
        >
          {schema.enum.map((opt) => (
            <MenuItem key={opt} value={opt}>{opt}</MenuItem>
          ))}
        </Select>
        {(required && empty) ? (
          <FormHelperText>Required</FormHelperText>
        ) : schema.description ? (
          <FormHelperText sx={{ color: c.text.tertiary }}>{schema.description}</FormHelperText>
        ) : null}
      </FormControl>
    );
  }

  if (schema.type === 'boolean') {
    return (
      <Box sx={{ mb: 1 }}>
        <FormControlLabel
          control={
            <Switch
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              size="small"
            />
          }
          label={
            <Typography sx={{ fontSize: '0.85rem', color: c.text.secondary }}>
              {label || 'Toggle'}
            </Typography>
          }
        />
        {schema.description && (
          <Typography sx={{ fontSize: '0.7rem', color: c.text.tertiary, ml: 0.5 }}>
            {schema.description}
          </Typography>
        )}
      </Box>
    );
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return <NumberField schema={schema} value={value} onChange={onChange} label={label} required={required} />;
  }

  if (schema.type === 'string') {
    return <StringField schema={schema} value={value} onChange={onChange} label={label} required={required} />;
  }

  if (schema.type === 'array' && schema.items) {
    const items = Array.isArray(value) ? value : [];
    const atMin = typeof schema.minItems === 'number' && items.length <= schema.minItems;
    const atMax = typeof schema.maxItems === 'number' && items.length >= schema.maxItems;
    const countHint = [
      typeof schema.minItems === 'number' ? `min ${schema.minItems}` : '',
      typeof schema.maxItems === 'number' ? `max ${schema.maxItems}` : '',
    ].filter(Boolean).join(', ');
    return (
      <Box
        sx={{
          mb: 1.5,
          pl: depth > 0 ? 1.5 : 0,
          borderLeft: depth > 0 ? `2px solid ${c.border.subtle}` : 'none',
        }}
      >
        {label && (
          <Typography
            sx={{ fontSize: '0.8rem', fontWeight: 600, color: c.text.secondary, mb: 0.5 }}
          >
            {label}{required ? ' *' : ''}{countHint ? ` (${countHint})` : ''}
          </Typography>
        )}
        {schema.description && (
          <Typography sx={{ fontSize: '0.7rem', color: c.text.tertiary, mb: 0.5 }}>
            {schema.description}
          </Typography>
        )}
        {items.map((item: any, i: number) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, mb: 0.5 }}>
            <Box sx={{ flex: 1 }}>
              <InputSchemaForm
                schema={schema.items!}
                value={item}
                onChange={(newVal) => {
                  const updated = [...items];
                  updated[i] = newVal;
                  onChange(updated);
                }}
                label={`Item ${i + 1}`}
                depth={depth + 1}
              />
            </Box>
            <IconButton
              size="small"
              disabled={atMin}
              onClick={() => {
                const updated = items.filter((_: any, idx: number) => idx !== i);
                onChange(updated);
              }}
              sx={{ color: atMin ? c.text.tertiary : c.status.error, mt: 0.5 }}
            >
              <RemoveCircleOutlineIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        ))}
        <Button
          size="small"
          disabled={atMax}
          startIcon={<AddIcon sx={{ fontSize: 14 }} />}
          onClick={() => onChange([...items, getDefault(schema.items!)])}
          sx={{
            fontSize: '0.75rem',
            color: atMax ? c.text.tertiary : c.accent.primary,
            textTransform: 'none',
          }}
        >
          Add item
        </Button>
      </Box>
    );
  }

  if (schema.type === 'object' && schema.properties) {
    const obj = typeof value === 'object' && value !== null ? value : {};
    return (
      <Box
        sx={{
          mb: 1.5,
          pl: depth > 0 ? 1.5 : 0,
          borderLeft: depth > 0 ? `2px solid ${c.border.subtle}` : 'none',
        }}
      >
        {label && (
          <Typography
            sx={{ fontSize: '0.8rem', fontWeight: 600, color: c.text.secondary, mb: 1 }}
          >
            {label}{required ? ' *' : ''}
          </Typography>
        )}
        {schema.description && (
          <Typography sx={{ fontSize: '0.7rem', color: c.text.tertiary, mb: 0.5 }}>
            {schema.description}
          </Typography>
        )}
        {Object.entries(schema.properties).map(([key, propSchema]) => (
          <InputSchemaForm
            key={key}
            schema={propSchema}
            value={obj[key]}
            onChange={(newVal) => onChange({ ...obj, [key]: newVal })}
            label={propSchema.title || key}
            required={schema.required?.includes(key)}
            depth={depth + 1}
          />
        ))}
      </Box>
    );
  }

  return (
    <StringField
      schema={{ ...schema, type: 'string' }}
      value={typeof value === 'string' ? value : JSON.stringify(value ?? '')}
      onChange={onChange}
      label={label}
      required={required}
    />
  );
};

export default InputSchemaForm;
