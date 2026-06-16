import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownIcon from '@mui/icons-material/ArrowDownward';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Chip from '@mui/material/Chip';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { AppSettings, ModelCombo } from '@/shared/state/settingsSlice';
import { API_BASE } from '@/shared/config';
import type { SettingsStyles } from '../settingsStyles';

const CombosEditor: React.FC<{
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  allModels: Array<{ value: string; label: string }>;
  styles: SettingsStyles;
}> = ({ form, setForm, allModels, styles }) => {
  const c = useClaudeTokens();
  const { descSx } = styles;
  const combos = form.model_combos || [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCombo, setEditingCombo] = useState<Partial<ModelCombo> | null>(null);

  const startNew = () => {
    setEditingId('new');
    setEditingCombo({
      id: `combo-${Date.now()}`,
      name: '',
      description: '',
      model_ids: [],
      strategy: 'fallback',
    });
  };

  const saveCombo = async () => {
    if (!editingCombo?.id || !editingCombo.name?.trim() || !editingCombo.model_ids?.length) {
      return;
    }
    const updated = combos.filter(c => c.id !== editingCombo.id);
    updated.push(editingCombo as ModelCombo);
    setForm(prev => ({ ...prev, model_combos: updated }));

    try {
      await fetch(`${API_BASE}/agents/combos/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combos: updated }),
      });
    } catch (err) {
      console.error('Failed to sync combos to 9router:', err);
    }

    setEditingId(null);
    setEditingCombo(null);
  };

  const deleteCombo = (id: string) => {
    setForm(prev => ({
      ...prev,
      model_combos: combos.filter(c => c.id !== id),
    }));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingCombo(null);
  };

  if (!allModels.length) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 3 }}>
      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: c.text.primary }}>
        Model Combos
      </Typography>

      <Typography sx={{ ...descSx, mb: -1 }}>
        Define fallback stacks: pick 2-3 models in order, and requests will route to the first available.
      </Typography>
      <Typography sx={{ fontSize: '0.75rem', color: c.text.muted, p: 1, bgcolor: c.bg.secondary, borderRadius: `${c.radius.sm}px`, fontStyle: 'italic' }}>
        Note: combo routing is currently managed via 9router. Use the 9router dashboard for full fallback + round-robin control.
      </Typography>

      {combos.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {combos.map(combo => (
            <Box
              key={combo.id}
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
                  {combo.name}
                </Typography>
                {combo.description && (
                  <Typography sx={{ fontSize: '0.75rem', color: c.text.muted, mt: 0.25 }}>
                    {combo.description}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75, flexWrap: 'wrap' }}>
                  {combo.model_ids.map((mid, idx) => (
                    <Chip
                      key={`${mid}-${idx}`}
                      label={mid}
                      size="small"
                      variant="outlined"
                      sx={{
                        fontSize: '0.7rem',
                        height: '20px',
                        borderColor: c.border.medium,
                        color: c.text.muted,
                      }}
                    />
                  ))}
                </Box>
              </Box>
              <IconButton
                size="small"
                onClick={() => deleteCombo(combo.id)}
                sx={{ color: c.text.muted, '&:hover': { color: c.status.error } }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {editingId === 'new' && editingCombo && (
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
            size="small"
            label="Combo name"
            placeholder="e.g. Premium Fallback"
            value={editingCombo.name || ''}
            onChange={e => setEditingCombo(prev => ({ ...prev, name: e.target.value }))}
            fullWidth
            sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.85rem' } }}
          />

          <TextField
            size="small"
            label="Description (optional)"
            placeholder="What is this combo for?"
            value={editingCombo.description || ''}
            onChange={e => setEditingCombo(prev => ({ ...prev, description: e.target.value }))}
            fullWidth
            multiline
            rows={2}
            sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.85rem' } }}
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={{ fontSize: '0.8rem', color: c.text.primary, fontWeight: 500 }}>
              Models (in fallback order)
            </Typography>
            {editingCombo.model_ids?.map((mid, idx) => (
              <Box key={`${mid}-${idx}`} sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                <Typography sx={{ fontSize: '0.8rem', color: c.text.muted, minWidth: '1.5rem', textAlign: 'center' }}>
                  #{idx + 1}
                </Typography>
                <TextField
                  size="small"
                  value={mid}
                  onChange={e => {
                    const updated = [...(editingCombo.model_ids || [])];
                    updated[idx] = e.target.value;
                    setEditingCombo(prev => ({ ...prev, model_ids: updated }));
                  }}
                  placeholder="Model ID"
                  fullWidth
                  sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.85rem' } }}
                />
                <IconButton
                  size="small"
                  onClick={() => {
                    if (idx > 0) {
                      const updated = [...(editingCombo.model_ids || [])];
                      [updated[idx], updated[idx - 1]] = [updated[idx - 1], updated[idx]];
                      setEditingCombo(prev => ({ ...prev, model_ids: updated }));
                    }
                  }}
                  disabled={idx === 0}
                  sx={{ color: idx === 0 ? c.text.ghost : c.text.muted }}
                >
                  <ArrowUpIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => {
                    if (idx < (editingCombo.model_ids?.length || 0) - 1) {
                      const updated = [...(editingCombo.model_ids || [])];
                      [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
                      setEditingCombo(prev => ({ ...prev, model_ids: updated }));
                    }
                  }}
                  disabled={idx === (editingCombo.model_ids?.length || 0) - 1}
                  sx={{ color: idx === (editingCombo.model_ids?.length || 0) - 1 ? c.text.ghost : c.text.muted }}
                >
                  <ArrowDownIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => {
                    const updated = editingCombo.model_ids?.filter((_, i) => i !== idx) || [];
                    setEditingCombo(prev => ({ ...prev, model_ids: updated }));
                  }}
                  sx={{ color: c.text.muted, '&:hover': { color: c.status.error } }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}

            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditingCombo(prev => ({
                  ...prev,
                  model_ids: [...(prev?.model_ids || []), ''],
                }));
              }}
              sx={{
                textTransform: 'none',
                fontSize: '0.8rem',
                mt: 1,
              }}
            >
              Add model
            </Button>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, borderRadius: `${c.radius.sm}px`, bgcolor: c.bg.elevated, border: `1px solid ${c.border.subtle}` }}>
            <Typography sx={{ fontSize: '0.8rem', color: c.text.primary, fontWeight: 500 }}>
              Fallback Strategy
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={(editingCombo.strategy ?? 'fallback') === 'fallback'}
                  onChange={e => setEditingCombo(prev => ({ ...prev, strategy: e.target.checked ? 'fallback' : 'round-robin' }))}
                  size="small"
                />
              }
              label={<Typography sx={{ fontSize: '0.75rem' }}>Use fallback (try models in order) vs round-robin</Typography>}
              sx={{ m: 0 }}
            />
            <Typography sx={{ fontSize: '0.7rem', color: c.text.muted, mt: 1 }}>
              {(editingCombo.strategy ?? 'fallback') === 'fallback'
                ? 'Falls back to the next model if the current one fails.'
                : 'Distributes requests evenly across all models in the combo.'}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="contained"
              onClick={saveCombo}
              disabled={!editingCombo.name?.trim() || !editingCombo.model_ids?.length}
              sx={{ fontSize: '0.8rem' }}
            >
              Save
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={cancelEdit}
              sx={{ fontSize: '0.8rem' }}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      )}

      {editingId !== 'new' && (
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
          New combo
        </Button>
      )}
    </Box>
  );
};

export default CombosEditor;
