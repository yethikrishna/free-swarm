# Packaged Build Testing Guide

This document covers testing FreeSwarm with the integrated FreeSwarm Router fork in the packaged desktop application (DMG on macOS, EXE on Windows).

## Why test the packaged build?

The packaged build differs from `bash run.sh` in critical ways:

- **File paths**: Resources live inside an `asar` archive; `/data` directory moves to `~/Library/Application Support/FreeSwarm/`
- **Router subprocess**: Spun up from bundled Node.js, not system Node
- **Auth token**: Generated before HTTP bind so Electron can read it from disk
- **Python**: Bundled Python 3.13 (not system Python), located at `process.resourcesPath/python/`
- **Deep links**: OAuth callbacks via `freeswarm://` URL scheme must be registered

## Building a local packaged app

### macOS (unsigned, no notarization)

```bash
bash scripts/build-app.sh
# Output: FreeSwarm-arm64.dmg or FreeSwarm-x64.dmg in electron/dist/
```

This produces an **unsigned** build suitable for local testing. Users will see a Gatekeeper warning but can still open it (right-click → Open).

### Windows (unsigned)

On Windows, run:
```bash
bash scripts/build-app-win.ps1
# Output: FreeSwarm-Setup-x64.exe in electron/dist/
```

## Testing checklist

### 1. Launch & Core Functionality

- [ ] DMG/installer opens and installs cleanly
- [ ] App launches without console errors
- [ ] Settings page loads (check localStorage is preserved across restarts)
- [ ] Agent creation and basic chat work
- [ ] Sidebar navigation (dashboard, settings, etc.) works

### 2. Router Integration

**Verify router subprocess is running:**

```bash
# macOS: Check Activity Monitor or run
ps aux | grep -E "node.*server\.js" | grep -v grep

# Windows: Task Manager → look for "node.exe" process
```

**Check router is reachable:**

```bash
curl -s http://localhost:20128/v1/models | jq '.data | length'
# Should output the number of available models
```

**Verify router status in Settings:**
- Open Settings → Models tab
- Check "FreeSwarm Router" section shows status
- Should see models from all connected providers

### 3. Subscription Connections (Critical Path)

**Test each subscription type:**

#### Claude (cc/ route)
1. Settings → Models → Connect to Claude Code
2. Scan QR code with Claude Code app
3. Should see green "Connected" badge
4. Verify models available: opus-4-8, sonnet, haiku, etc.

#### ChatGPT (cx/ route) 
1. Settings → Models → Connect to Codex
2. Scan QR code with ChatGPT app
3. Should see green "Connected" badge
4. Verify GPT-5.5, GPT-5.4 now available (NEW, previously 404)

#### Gemini CLI (gc/ route)
1. Settings → Models → Connect to Gemini CLI
2. Scan QR code with Gemini CLI app
3. Should see green "Connected" badge
4. Verify Gemini 3.5 Flash now available (NEW, previously API-key only)

#### API Keys
1. Set ANTHROPIC_API_KEY in Settings
2. Verify claude models show in available list
3. Test creating an agent with each model

### 4. Multi-Account Features

**Per-provider multiple connections:**
1. Add 2+ Claude Code subscriptions (different accounts)
2. Settings → Models → Manage Accounts (under connected provider)
3. Verify both accounts listed with health status
4. Test reordering accounts (drag or up/down buttons)
5. Test fill-first vs round-robin toggle
6. Test account deletion

**Account health indicators:**
- Recently used accounts show green status
- Errored accounts show red status  
- Tooltip displays last-checked time

### 5. Model Routing

**Test primary → fallback flow:**
1. Create model combo: Primary=GPT-5.5, Fallback=Claude Opus
2. Set as default in Settings
3. Use in agent chat
4. Verify it works end-to-end
5. Disable the primary route and re-test (should fallback)

**Test round-robin:**
1. Add 2+ accounts for same provider
2. Toggle strategy to "round-robin"
3. Create multiple agents rapidly
4. Verify they rotate through accounts (check 9router logs)

### 6. OAuth Flow (Deep Links)

**Test Claude subscription OAuth:**
1. Settings → Connect to Claude Code
2. Scan QR code in external app
3. App redirects to FreeSwarm via `freeswarm://` URL
4. Verify Settings updates with new connection
5. Check no errors in console

**Verify deep link handling:**
```bash
# macOS: test the URL scheme directly
open "freeswarm://oauth/callback?token=test"
# Should activate FreeSwarm without error (even with invalid token)
```

### 7. Settings Persistence

- [ ] API keys persist across restarts
- [ ] Model combos and aliases persist
- [ ] Account list (order, strategy) persists
- [ ] Default model selection persists

**Test by:**
1. Make changes in Settings
2. Restart the app
3. Verify changes are still there

### 8. Error Handling

**Simulate router crash:**
1. Find router process: `ps aux | grep server.js`
2. Kill it: `kill -9 <pid>`
3. Watch app for 5 seconds
4. Verify app shows "Router offline" message (not silent failure)

**Network connectivity:**
1. Disable internet
2. Try to create agent and send message
3. Verify error message is user-friendly (not raw exception)

### 9. Performance

- [ ] App starts in < 5 seconds
- [ ] Settings page loads without lag
- [ ] Model list loads smoothly (thousands of models)
- [ ] First agent chat responds in < 10s (assuming network ok)

## Known Regressions to Watch

### Router v0.3.90 (current fork base)

**WebSearch translation bug:**
- Cross-provider WebSearch (Codex/Gemini using WebSearch) may report model unavailability
- **Workaround**: Tested in isolation—model works, just issue when delegating search
- **Status**: Tracked for future fork upgrade

**Max_tokens translation:**
- OpenAI GPT-5 models still need `max_tokens` → `max_completion_tokens` translation
- **Status**: Patched via `backend/apps/agents/9router_gpt5_patch.js` (loaded at Node startup)
- **Verify**: Test GPT-5.5 agent chat; if it 400s, patch isn't loading

## Reporting Issues

If you find problems, gather:

1. **OS + version**: `uname -a` (macOS) or Windows version
2. **Router logs**: 
   - Set `FREESWARM_DEBUG_9ROUTER=1` before launching
   - Check `~/Library/Application Support/FreeSwarm/9router.log` (macOS)
3. **App console**: 
   - DevTools: Ctrl+Shift+I or Cmd+Option+I
   - Main process logs in Terminal after launch
4. **Minimal reproduction**: Steps to reproduce the issue
5. **Screenshots/video**: If visual bug

## Success Criteria

A packaged build is ready for release when:

- ✅ All 9 sections above pass
- ✅ No console errors on happy path
- ✅ Router stays running for 1+ hour under load
- ✅ OAuth flows work end-to-end on test account
- ✅ No regressions from previous version

## Next: Standalone Router Customization

Once packaged testing is complete, you can customize the router itself:

- Provider adapters (add/modify OAuth flows)
- Model discovery per provider
- Branding (logo, UI rebranding)

See `router/FREESWARM_FORK.md` and `docs/ROUTER_CUSTOMIZATION.md` for details.
