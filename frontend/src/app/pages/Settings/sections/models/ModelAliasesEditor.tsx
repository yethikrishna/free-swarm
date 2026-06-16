import React, { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { AppSettings, ModelAlias } from '@/shared/state/settingsSlice';
import type { SettingsStyles } from '../settingsStyles';

const ModelAliasesEditor: React.FC<{
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  allModels: Array<{ value: string; label: string }>;
  styles: SettingsStyles;
}> = ({ form, setForm, allModels, styles }) => {
  const c = useClaudeTokens();
  const { descSx } = styles;
  const aliases = form.model_aliases || [];
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingAlias, setEditingAlias] = useState<string>('');

  const aliasMap = useMemo(() => {
    return new Map(aliases.map(a => [a.modelId, a]));
  }, [aliases]);

  const startNew = () => {
    setEditingModelId('');
    setEditingAlias('');
  };

  const saveAlias = () => {
    if (!editingModelId || !editingAlias.trim()) return;

    const updated = aliases.filter(a => a.modelId !== editingModelId);
    updated.push({
      modelId: editingModelId,
      alias: editingAlias.trim(),
    });

    setForm(prev => ({ ...prev, model_aliases: updated }));
    setEditingModelId(null);
    setEditingAlias('');
  };

  const deleteAlias = (modelId: string) => {
    setForm(prev => ({
      ...prev,
      model_aliases: aliases.filter(a => a.modelId !== modelId),
    }));
  };

  if (!allModels.length) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: c.text.primary }}>
        Model Aliases
      </Typography>

      <Typography sx={{ ...descSx, mb: -1 }}>
        Create custom names for models to make them easier to identify in the model selector.
      </Typography>

      {aliases.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {aliases.map(alias => {
            const model = allModels.find(m => m.value === alias.modelId);
            return (
              <Box
                key={alias.modelId}
                sx={{
                  display: 'flex',
                  gap: 1,
                  p: 1.5,
                  borderRadius: `${c.radius.md}px`,
                  bgcolor: c.bg.secondary,
                  border: `1px solid ${c.border.subtle}`,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: c.text.primary }}>
                    {alias.alias}
                  </Typography>
                  <Typography sx={{ fontSize: '0.75rem', color: c.text.muted, mt: 0.25 }}>
                    {model?.label || alias.modelId}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  onClick={() => deleteAlias(alias.modelId)}
                  sx={{ color: c.text.muted, '&:hover': { color: c.status.error } }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            );
          })}
        </Box>
      )}

      {editingModelId !== null && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            p: 2,
            borderRadius: `${c.radius.md}px`,
            bgcolor: c.bg.surface,
            border: `1px solid ${c.border.medium}`,
          }}
        >
          <TextField
            select
            size="small"
            label="Model"
            value={editingModelId}
            onChange={e => setEditingModelId(e.target.value)}
            fullWidth
            sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.85rem' } }}
          >
            {allModels.map(m => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </TextField>

          <TextField
            size="small"
            label="Custom alias"
            placeholder="e.g. Fast, Cheap, Powerful"
            value={editingAlias}
            onChange={e => setEditingAlias(e.target.value)}
            fullWidth
            sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.85rem' } }}
          />

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="contained"
              onClick={saveAlias}
              disabled={!editingModelId || !editingAlias.trim()}
              sx={{ fontSize: '0.8rem' }}
            >
              Save
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setEditingModelId(null);
                setEditingAlias('');
              }}
              sx={{ fontSize: '0.8rem' }}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      )}

      {editingModelId === null && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={startNew}
          sx={{
            textTransform: 'none',
            fontSize: '0.8rem',
            width: 'fit-content',
          }}
        >
          New alias
        </Button>
      )}
    </Box>
  );
};

export default ModelAliasesEditor;
