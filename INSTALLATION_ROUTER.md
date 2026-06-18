# FreeSwarm Router - Installation Guides

Complete step-by-step installation instructions for all platforms.

## macOS Installation

### System Requirements
- macOS 11 Big Sur or newer
- 100 MB free disk space
- Internet connection (for OAuth)

### Apple Silicon (M1, M2, M3)

**Step 1: Download**
- Visit [GitHub Releases](https://github.com/yethikrishna/free-swarm/releases)
- Download `FreeSwarm-arm64.dmg`

**Step 2: Install**
- Open Downloads folder (or double-click from browser)
- Double-click `FreeSwarm-arm64.dmg`
- Drag "FreeSwarm Router" to Applications folder

**Step 3: Trust the App**
- Open Applications folder
- Right-click "FreeSwarm Router"
- Click "Open"
- Click "Open" when prompted (macOS security warning)

**Step 4: Launch**
- Double-click "FreeSwarm Router" from Applications
- App opens automatically

**Step 5: Configure**
- Go to Settings → Accounts
- Click "Add Account"
- Select provider and authenticate
- Repeat for additional accounts

### Intel Macs (x64)

**Step 1: Download**
- Visit [GitHub Releases](https://github.com/yethikrishna/free-swarm/releases)
- Download `FreeSwarm-x64.dmg`

**Step 2: Install**
- Open Downloads folder
- Double-click `FreeSwarm-x64.dmg`
- Drag "FreeSwarm Router" to Applications folder

**Step 3: Trust the App**
- Open Applications folder
- Right-click "FreeSwarm Router"
- Click "Open"
- Click "Open" in security dialog

**Step 4: Launch**
- Double-click from Applications
- Or use Spotlight (Cmd+Space) and type "FreeSwarm Router"

**Step 5: Configure**
- Add accounts in Settings
- Choose routing strategy
- Start routing

### Troubleshooting macOS

**"FreeSwarm Router is damaged and can't be opened"**
1. Open Terminal (Cmd+Space → Terminal)
2. Run: `sudo xattr -rd com.apple.quarantine /Applications/FreeSwarm\ Router.app`
3. Try launching again

**"Port 8080 is already in use"**
1. Settings → Network
2. Change "Router Port" to 8081 or higher
3. Save and restart

**App not launching**
1. Check system preferences allow the app (Settings → Security & Privacy)
2. Restart your Mac
3. Try launching again

---

## Windows Installation

### System Requirements
- Windows 10 or newer (22H2 recommended)
- 100 MB free disk space
- Administrator access for installation
- Internet connection (for OAuth)

### Windows 10/11 (x64)

**Step 1: Download**
- Visit [GitHub Releases](https://github.com/yethikrishna/free-swarm/releases)
- Download `FreeSwarm-Setup-x64.exe`

**Step 2: Run Setup**
- Open Downloads folder
- Right-click `FreeSwarm-Setup-x64.exe`
- Click "Run as Administrator"

**Step 3: SmartScreen Warning** (if shown)
- Click "More info"
- Click "Run anyway"
- This is normal for new software

**Step 4: Follow Installer**
- Accept license agreement
- Choose installation folder (default: C:\Program Files)
- Click "Install"
- Wait for installation to complete

**Step 5: Launch**
- Check "Launch FreeSwarm Router" at end of installer
- Or find in Start Menu → FreeSwarm Router

**Step 6: Configure**
- Settings → Accounts
- Add your AI provider accounts
- Choose routing strategy
- Save settings

### Troubleshooting Windows

**"Windows protected your PC" warning**
1. Click "More info"
2. Click "Run anyway"
3. This appears for all new software; it's safe

**Installation fails with "Access Denied"**
1. Right-click installer
2. Select "Run as Administrator"
3. Retry installation

**"Port 8080 is already in use"**
1. Open Settings in app
2. Go to Network tab
3. Change port number
4. Restart app

**App not starting**
1. Open Task Manager (Ctrl+Shift+Esc)
2. Look for "FreeSwarm Router" process
3. If not there, try launching from Start Menu again
4. If stuck, restart your computer

**Visual C++ Runtime Error**
1. Download [Visual C++ Redistributable](https://support.microsoft.com/en-us/help/2977003)
2. Install the latest version
3. Restart your computer
4. Retry FreeSwarm Router

---

## First Run Setup

After installation on any platform:

### 1. Initial Configuration (2-3 minutes)
- App opens to Settings
- Choose your language (English recommended)
- Accept terms and privacy policy
- Click "Next"

### 2. Add Accounts (5 minutes per account)
- Click "Add Account"
- Select provider:
  - Claude (Anthropic)
  - ChatGPT (OpenAI)
  - Gemini (Google)
  - OpenRouter
  - Or others
- Click "Authenticate"
- Complete OAuth flow in browser
- Return to app when done

### 3. Choose Routing Strategy (1 minute)
- Go to Settings → Routing
- Select strategy:
  - **fill-first** (recommended for beginners)
  - **round-robin** (balanced)
  - **cost-aware** (money-focused)
  - Others for advanced use
- Click "Save"

### 4. Test Configuration (2 minutes)
- Click "Test Connection"
- Choose a model
- Send test request
- Verify response

### 5. Start Using
- Open your application/CLI
- Point to `http://localhost:8080`
- Start sending requests
- Router handles fallback automatically

---

## Configuration

### Settings Location
**macOS**: `~/Library/Application Support/FreeSwarm Router/settings.json`  
**Windows**: `C:\Users\[Your User]\AppData\Local\FreeSwarm Router\settings.json`

### Manual Configuration
Edit `settings.json`:
```json
{
  "port": 8080,
  "strategy": "round-robin",
  "accounts": [
    {
      "provider": "claude",
      "name": "Claude 1",
      "token": "sk-...",
      "enabled": true
    }
  ],
  "routing": {
    "fallbackDelay": 2000,
    "maxRetries": 3,
    "timeout": 30000
  }
}
```

### Restart After Changes
1. Close FreeSwarm Router
2. Edit settings file
3. Save and close
4. Relaunch app
5. Changes take effect

---

## Verify Installation

### Check if Running
- **macOS**: Look for icon in top menu bar
- **Windows**: Look for icon in system tray (bottom right)

### Test Endpoint
```bash
curl http://localhost:8080/health
# Should return: {"status": "ok"}
```

### View Metrics
```bash
curl http://localhost:8080/metrics
# Returns Prometheus metrics
```

### Check Version
In app: Settings → About → Version number

---

## Uninstallation

### macOS
1. Open Applications folder
2. Find "FreeSwarm Router"
3. Drag to Trash
4. Empty Trash
5. (Optional) Remove settings: `rm -rf ~/Library/Application\ Support/FreeSwarm\ Router`

### Windows
1. Open Settings
2. Go to Apps → Apps & Features
3. Find "FreeSwarm Router"
4. Click and select "Uninstall"
5. Follow uninstaller prompts
6. Restart computer

---

## Getting Help

If installation fails:

1. **Check system requirements** - Verify OS version and disk space
2. **Restart your computer** - Fixes most issues
3. **Check GitHub Issues** - Search for your error message
4. **Ask on Discussions** - https://github.com/yethikrishna/free-swarm/discussions
5. **Report bug** - https://github.com/yethikrishna/free-swarm/issues/new

Include when reporting:
- Your OS and version
- Error message (screenshots helpful)
- Steps you've already tried
- Network/proxy information if relevant

---

**Need help?** [Start a discussion](https://github.com/yethikrishna/free-swarm/discussions) or [report an issue](https://github.com/yethikrishna/free-swarm/issues)
