// Desktop Automation page (F5 scheduled tasks + F10 agent templates). Talks to
// the local backend /api/automation/*; the fetch interceptor stamps the bearer.
import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Switch from '@mui/material/Switch';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import IconButton from '@mui/material/IconButton';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { API_BASE } from '@/shared/config';

interface Task {
  id: string; name: string; prompt: string; schedule_kind: string;
  interval_minutes: number; daily_time: string; enabled: boolean;
  last_run_at: number | null; next_run_at: number;
}
interface Template { id: string; name: string; description: string; system_prompt: string; model: string; }

const api = {
  get: (p: string) => fetch(`${API_BASE}/automation${p}`).then((r) => r.json()),
  post: (p: string, b?: unknown) =>
    fetch(`${API_BASE}/automation${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json()),
  put: (p: string, b: unknown) =>
    fetch(`${API_BASE}/automation${p}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()),
  del: (p: string) => fetch(`${API_BASE}/automation${p}`, { method: 'DELETE' }).then((r) => r.json()),
};

const Automation: React.FC = () => {
  const c = useClaudeTokens();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState('interval');
  const [intervalMin, setIntervalMin] = useState(60);
  const [dailyTime, setDailyTime] = useState('09:00');
  const [tplName, setTplName] = useState('');
  const [tplPrompt, setTplPrompt] = useState('');

  const reload = useCallback(async () => {
    const [t, tpl] = await Promise.all([api.get('/tasks'), api.get('/templates')]);
    setTasks(t.tasks ?? []);
    setTemplates(tpl.templates ?? []);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const addTask = async () => {
    if (!prompt.trim()) return;
    await api.post('/tasks', { name: name.trim() || 'Scheduled task', prompt: prompt.trim(), schedule_kind: kind, interval_minutes: intervalMin, daily_time: dailyTime });
    setName(''); setPrompt(''); reload();
  };
  const toggle = async (t: Task) => { await api.put(`/tasks/${t.id}`, { enabled: !t.enabled }); reload(); };
  const runNow = async (t: Task) => { await api.post(`/tasks/${t.id}/run`); reload(); };
  const delTask = async (id: string) => { await api.del(`/tasks/${id}`); reload(); };
  const addTpl = async () => {
    if (!tplName.trim()) return;
    await api.post('/templates', { name: tplName.trim(), system_prompt: tplPrompt.trim() });
    setTplName(''); setTplPrompt(''); reload();
  };
  const delTpl = async (id: string) => { await api.del(`/templates/${id}`); reload(); };

  const card = { p: 2.5, bgcolor: c.bg.surface, border: `1px solid ${c.border.subtle}`, mb: 2 };
  const schedule = (t: Task) =>
    t.schedule_kind === 'daily' ? `Daily at ${t.daily_time}` : `Every ${t.interval_minutes} min`;

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 3 }}>
      <Box sx={{ maxWidth: 760, mx: 'auto' }}>
        <Typography variant="h5" sx={{ color: c.text.primary, fontWeight: 600, mb: 1 }}>Automation</Typography>
        <Typography sx={{ color: c.text.muted, fontSize: 14, mb: 3 }}>
          Run an agent on a schedule, and save reusable agent setups as templates.
        </Typography>

        <Typography sx={{ color: c.text.primary, fontWeight: 600, mb: 1.5 }}>Scheduled tasks</Typography>
        <Paper sx={card}>
          <TextField fullWidth size="small" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 1 }} />
          <TextField fullWidth size="small" multiline minRows={2} placeholder="What should the agent do?" value={prompt} onChange={(e) => setPrompt(e.target.value)} sx={{ mb: 1 }} />
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select size="small" value={kind} onChange={(e) => setKind(e.target.value)}>
              <MenuItem value="interval">Every</MenuItem>
              <MenuItem value="daily">Daily at</MenuItem>
            </Select>
            {kind === 'interval' ? (
              <TextField size="small" type="number" value={intervalMin} onChange={(e) => setIntervalMin(Math.max(1, Number(e.target.value)))} sx={{ width: 100 }} InputProps={{ endAdornment: <span style={{ color: c.text.muted, fontSize: 12 }}>min</span> }} />
            ) : (
              <TextField size="small" type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} sx={{ width: 130 }} />
            )}
            <Button variant="contained" onClick={addTask} disabled={!prompt.trim()} sx={{ ml: 'auto', textTransform: 'none' }}>Add task</Button>
          </Box>
        </Paper>

        {tasks.map((t) => (
          <Paper key={t.id} sx={{ ...card, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Switch checked={t.enabled} onChange={() => toggle(t)} size="small" />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: c.text.primary, fontWeight: 600, fontSize: 14 }}>{t.name}</Typography>
              <Typography sx={{ color: c.text.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {schedule(t)} · {t.prompt}
              </Typography>
            </Box>
            <Button size="small" onClick={() => runNow(t)} sx={{ textTransform: 'none', color: c.accent.primary }}>Run now</Button>
            <IconButton size="small" onClick={() => delTask(t.id)}><DeleteOutlineIcon fontSize="small" sx={{ color: c.text.muted }} /></IconButton>
          </Paper>
        ))}

        <Typography sx={{ color: c.text.primary, fontWeight: 600, mb: 1.5, mt: 4 }}>Agent templates</Typography>
        <Paper sx={card}>
          <TextField fullWidth size="small" placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} sx={{ mb: 1 }} />
          <TextField fullWidth size="small" multiline minRows={2} placeholder="System prompt / instructions" value={tplPrompt} onChange={(e) => setTplPrompt(e.target.value)} sx={{ mb: 1 }} />
          <Button variant="contained" onClick={addTpl} disabled={!tplName.trim()} sx={{ textTransform: 'none' }}>Save template</Button>
        </Paper>
        {templates.map((tpl) => (
          <Paper key={tpl.id} sx={{ ...card, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: c.text.primary, fontWeight: 600, fontSize: 14 }}>{tpl.name}</Typography>
              <Typography sx={{ color: c.text.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tpl.system_prompt || tpl.description || 'No instructions'}
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => delTpl(tpl.id)}><DeleteOutlineIcon fontSize="small" sx={{ color: c.text.muted }} /></IconButton>
          </Paper>
        ))}
      </Box>
    </Box>
  );
};

export default Automation;
