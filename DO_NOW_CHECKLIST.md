# FreeSwarm Router: Installer Distribution & Pre-Testing Setup

**Status**: Ready for distribution setup  
**Date**: June 18, 2026  
**Focus**: Installer strategy + Immediate action items (NO testing yet)

---

## 🎯 INSTALLER DISTRIBUTION STRATEGY

You want: **Traditional installer-based distribution** (like FreeSwarm/OpenSwarm)

### What You Already Have ✅

**macOS:**
- ✅ DMG installer (drag-to-install, familiar to Mac users)
- ✅ Code signed & notarized (professional, no warnings)
- ✅ Auto-updates built in
- ✅ Universal (arm64 + x64 in single DMG with architecture detection)

**Windows:**
- ✅ EXE installer (traditional Windows setup wizard)
- ✅ Code signed (no SmartScreen warnings)
- ✅ Auto-updates built in
- ✅ Uninstall via Programs & Features
- ✅ Start Menu shortcut

**Distribution Channels:**
- ✅ GitHub Releases (free CDN)
- ✅ Website auto-download (platform detection)
- ✅ Docker image (for server deployments)

### THIS IS ALREADY AN INSTALLER-BASED DISTRIBUTION 🎉

You have the EXACT distribution model you want:
- Users download installer
- Double-click to install (macOS) or run setup (Windows)
- App appears in Applications (macOS) or Programs (Windows)
- Auto-updates handle future versions
- Can uninstall normally

---

## 📋 COMPLETE "DO NOW" CHECKLIST (Before Testing)

### SECTION 1: GitHub & CI/CD Setup (2-3 hours)

#### 1.1 Create GitHub Secrets
```
Time: 30 minutes
Complexity: Low

Go to: https://github.com/yethikrishna/free-swarm/settings/secrets/actions

Add these secrets (get values from your accounts):

APPLE_ID
  Value: your-apple-email@example.com
  Where to get: Apple Developer Account
  
APPLE_PASSWORD
  Value: xxxx-xxxx-xxxx-xxxx (app-specific password, NOT your Apple password)
  Where to get: https://appleid.apple.com/ → App-specific passwords
  Create new password for "GitHub Actions"
  
APPLE_TEAM_ID
  Value: XXXXXXXXXX (10 characters)
  Where to get: Apple Developer → Team ID in Account section
  
AZURE_KEY_VAULT
  Value: my-keyvault-name
  Where to get: Azure Portal → Key Vaults → Get name
  
AZURE_CLIENT_ID
  Value: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  Where to get: Azure Portal → App registrations → Copy Application (client) ID
  
AZURE_CLIENT_SECRET
  Value: xxxxxxxx
  Where to get: Azure Portal → App registrations → Certificates & secrets → Copy value
  
DOCKER_USERNAME
  Value: your-docker-username
  Where to get: Docker Hub account
  
DOCKER_PASSWORD
  Value: your-docker-token
  Where to get: Docker Hub → Account Settings → Security → New Access Token
  
SLACK_WEBHOOK (Optional)
  Value: https://hooks.slack.com/services/...
  Where to get: Slack App → Incoming Webhooks
  
DISCORD_WEBHOOK (Optional)
  Value: https://discord.com/api/webhooks/...
  Where to get: Discord Server → Webhook settings

Verification:
□ All secrets added
□ No typos in names
□ Values are correct
```

#### 1.2 Test Secrets Work
```
Time: 1-2 hours
Complexity: Medium

Steps:
1. Create test tag: git tag v0.9.0-test
2. Push: git push origin v0.9.0-test
3. Go to Actions tab
4. Watch v0.9.0-test workflow run
5. Check all 3 builds succeed

If Build Fails:
□ Check Actions log for error
□ Common issue: APPLE_ID or AZURE credentials wrong
□ Fix secret, delete tag, retry
□ Document error for learning

If Build Succeeds:
□ Download FreeSwarm-arm64.dmg (verify file exists)
□ Download FreeSwarm-x64.dmg (verify file exists)
□ Download FreeSwarm-Setup-x64.exe (verify file exists)
□ Check GitHub release page created
□ Verify Docker image pushed (docker pull freeswarm/router:v0.9.0-test)
□ Take screenshot of successful workflow

Delete test release:
git tag -d v0.9.0-test
git push origin :refs/tags/v0.9.0-test
```

---

### SECTION 2: Website Deployment (2-3 hours)

#### 2.1 Choose Hosting Platform
```
Time: 30 minutes
Complexity: Low

Options (ranked by ease):

OPTION 1: Vercel (RECOMMENDED)
  - Easiest for open-source projects
  - Free tier is generous
  - Auto-HTTPS
  - Fast deployment
  Steps:
  1. Go to https://vercel.com
  2. Sign up with GitHub
  3. Connect yethikrishna/free-swarm repo
  4. Create new project
  5. Root directory: website
  6. Deploy
  7. Get free domain: something.vercel.app
  8. (Optional) Add custom domain
  Domain cost: $0 (free subdomain) or $12/year (custom)

OPTION 2: Netlify
  - Also free and easy
  - Drag-and-drop deployment
  Steps:
  1. Go to https://netlify.com
  2. Sign up
  3. New site → New site from Git
  4. Connect GitHub
  5. Select repo
  6. Root directory: website
  7. Deploy
  8. Get free domain

OPTION 3: GitHub Pages
  - Free, hosted on GitHub
  - Simplest setup
  Steps:
  1. Settings → Pages
  2. Source: Deploy from branch
  3. Select main branch, website folder
  4. Get free domain: username.github.io/free-swarm
  Limitation: No custom domain (unless manual setup)

OPTION 4: Custom Hosting
  - Full control
  - Domain cost: $12/year
  - Hosting: $5-10/month
  Providers: Bluehost, HostGator, AWS, etc.
  Steps:
  1. Buy domain
  2. Buy hosting
  3. Upload website/ folder via FTP
  4. Point DNS to hosting
```

#### 2.2 Deploy Website
```
Time: 1-2 hours
Complexity: Low

For Vercel:
1. Go to https://vercel.com
2. Click "New Project"
3. Import GitHub repo
4. Select yethikrishna/free-swarm
5. Framework: Next.js (or Other)
6. Root directory: website
7. Environment variables: (none needed)
8. Deploy
9. Wait 2-3 minutes
10. You'll get URL: https://xxxx.vercel.app

For Custom Domain (Optional):
1. Buy domain (Namecheap, GoDaddy, etc.)
2. In Vercel project → Settings → Domains
3. Add custom domain
4. Follow DNS instructions
5. Wait 24 hours for DNS propagation

Testing:
□ Website loads at https://xxxx.vercel.app
□ All links work
□ Download buttons visible
□ Platform detection works (test on mobile)
□ Responsive design looks good
□ No console errors (F12 → Console)
□ Metrics endpoint test: website needs to link to https://api.github.com/repos/yethikrishna/free-swarm/releases/latest
```

#### 2.3 Update Website with Release Link
```
Time: 30 minutes
Complexity: Low

Edit: website/index.html

Find line with GitHub releases button:
<button onclick="window.location='https://github.com/yethikrishna/free-swarm/releases'">

This already auto-fetches latest release, so NO changes needed.

Test auto-download:
1. Go to https://xxxx.vercel.app
2. Click "Download Now"
3. Should auto-detect platform
4. Should show "Downloading..." message
5. Should trigger download of appropriate file

Troubleshooting:
If downloads fail:
□ Check GitHub API working: curl https://api.github.com/repos/yethikrishna/free-swarm/releases/latest
□ Verify release published with 3 files
□ Check browser console for errors
□ Verify CORS not blocking (GitHub should allow)
```

---

### SECTION 3: Documentation & Marketing (2-3 hours)

#### 3.1 Create README
```
Time: 1 hour
Complexity: Low

Create: README_LAUNCH.md (or update README.md)

Template:
---
# FreeSwarm Router v1.0.0

Enterprise AI subscription management. Route requests across multiple AI providers with intelligent fallback and cost optimization.

## Features
- 🎯 Multi-account routing (Claude, ChatGPT, Gemini)
- 💰 Cost optimization (route to cheapest)
- ⚡ 6 routing strategies (fill-first, round-robin, priority, etc.)
- 📊 Analytics & monitoring (Prometheus metrics)
- 🔐 Local-first & secure (all data encrypted locally)
- 🚀 Works offline (except OAuth)

## Downloads

### macOS
- [arm64 (Apple Silicon)](https://github.com/yethikrishna/free-swarm/releases/download/v1.0.0/FreeSwarm-arm64.dmg)
- [x64 (Intel)](https://github.com/yethikrishna/free-swarm/releases/download/v1.0.0/FreeSwarm-x64.dmg)

### Windows
- [x64](https://github.com/yethikrishna/free-swarm/releases/download/v1.0.0/FreeSwarm-Setup-x64.exe)

Or [visit our website](https://freeswarm.vercel.app) for auto-download.

## Quick Start

1. Download installer for your platform
2. Run installer (DMG on macOS, EXE on Windows)
3. Launch FreeSwarm Router
4. Go to Settings → Models
5. Connect your AI subscriptions (Claude, OpenAI, Gemini)
6. Start using multi-account routing!

## Documentation

- [Installation Guide](docs/INSTALLATION.md)
- [Getting Started](docs/GETTING_STARTED.md)
- [User Guide](docs/USER_GUIDE.md)
- [Customization](docs/ROUTER_CUSTOMIZATION.md)
- [Testing](docs/PACKAGED_BUILD_TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Support

- [GitHub Issues](https://github.com/yethikrishna/free-swarm/issues)
- [GitHub Discussions](https://github.com/yethikrishna/free-swarm/discussions)

## License

MIT

---
```

#### 3.2 Create CHANGELOG
```
Time: 30 minutes
Complexity: Low

Create: CHANGELOG.md

Template:
---
# Changelog

All notable changes to FreeSwarm Router will be documented in this file.

## [1.0.0] - June 18, 2026

### Added
- Initial release of FreeSwarm Router
- Multi-account AI subscription routing
- 6 intelligent routing strategies
- Support for Claude, ChatGPT, and Gemini subscriptions
- Model discovery with live API detection
- Prometheus metrics and analytics
- OAuth provider adapter framework
- Cost-aware routing
- Health-based account selection

### Features
- ✅ Multi-provider support (cc/, cx/, gc/)
- ✅ Automatic fallback handling
- ✅ Local encryption of credentials
- ✅ Offline-first architecture
- ✅ Professional UI dashboard
- ✅ Auto-updates

### Known Issues
- WebSearch translation may have issues on Gemini routes (v0.3.90 limitation)
- Requires real OAuth accounts for full functionality

### Future Plans
- v1.1.0 (Q3 2026): Additional provider support
- v1.2.0 (Q4 2026): Advanced analytics
- v2.0.0 (Q1 2027): Major feature expansion

---
```

#### 3.3 Create Installation Guide
```
Time: 1 hour
Complexity: Medium

Create: docs/INSTALLATION.md

Template:
---
# Installation Guide

## macOS

### ARM64 (Apple Silicon - M1, M2, M3)

1. Download [FreeSwarm-arm64.dmg](https://github.com/yethikrishna/free-swarm/releases/download/v1.0.0/FreeSwarm-arm64.dmg)
2. Double-click the DMG file
3. Drag FreeSwarm icon to Applications folder
4. Open Applications → FreeSwarm
5. If you see a warning, click "Open" (it's safe, we signed it)

### x64 (Intel Macs)

1. Download [FreeSwarm-x64.dmg](...)
2. Follow same steps as ARM64 above

### Verify Installation

```bash
# Check if installed
ls /Applications/FreeSwarm.app

# Check if running
ps aux | grep FreeSwarm
```

## Windows

### x64 (Windows 10+)

1. Download [FreeSwarm-Setup-x64.exe](...)
2. Double-click FreeSwarm-Setup-x64.exe
3. Click "Install" (or let UAC prompt complete)
4. Installer will copy files to Program Files
5. Click "Finish"
6. FreeSwarm will launch automatically

### Verify Installation

- Check Programs & Features (Control Panel) → FreeSwarm listed
- Check Start Menu → FreeSwarm shortcut exists
- Check C:\Program Files\FreeSwarm\ → Files exist

### Uninstall

- Control Panel → Programs & Features → FreeSwarm → Uninstall
- Or right-click Start Menu shortcut → Uninstall

## Troubleshooting

### macOS: "FreeSwarm is damaged" Error
- Right-click FreeSwarm.app → Open (bypass Gatekeeper)
- Or: System Preferences → Security → Allow FreeSwarm

### Windows: SmartScreen Warning
- Click "More info" → "Run anyway"
- This is normal for unsigned apps

### Either OS: App Won't Launch
- Check Console/Event Viewer for errors
- Ensure OAuth accounts are set up
- Try reinstalling

---
```

---

### SECTION 4: Marketing & Announcement Prep (1-2 hours)

#### 4.1 Prepare Social Media Posts
```
Time: 30 minutes
Complexity: Low

Twitter/X Posts:

POST 1 (Announcement):
"🚀 Excited to announce FreeSwarm Router v1.0.0 is live!

Multi-account AI routing with intelligent fallback and cost optimization.

✨ Route across Claude, ChatGPT, and Gemini
💰 Automatically use cheapest provider
⚡ 6 routing strategies
📊 Built-in analytics

Download now: https://freeswarm.vercel.app

#AI #OpenSource #GitHub"

POST 2 (Feature highlight):
"With FreeSwarm Router, you can:
• Add multiple subscriptions to one app
• Automatically fallback when one is exhausted
• Route to cheapest provider for cost savings
• Monitor usage with built-in metrics

Enterprise AI routing, now free and open source.

https://github.com/yethikrishna/free-swarm"

POST 3 (Call to action):
"Try FreeSwarm Router today:
- Download installer for macOS or Windows
- Works offline (except OAuth)
- All data stays local and encrypted
- 6 routing strategies to choose from

Feedback welcome! Open an issue on GitHub 💙"

Reddit Posts:

r/MachineLearning:
Title: "Open-source tool to route across multiple AI subscriptions"
Body: "I just released FreeSwarm Router - a desktop app that lets you manage multiple Claude/ChatGPT/Gemini subscriptions in one place with intelligent routing."

r/Python:
Title: "FreeSwarm Router: Multi-account AI management"
Body: "CLI-compatible router for distributing AI requests across multiple subscriptions with automatic fallback"

r/SideProject:
Title: "FreeSwarm Router: Enterprise AI subscription management (open source)"
Body: "Built during vacation. Supports Claude, ChatGPT, Gemini. Installers for macOS and Windows. Would appreciate feedback!"

GitHub Discussions:
Title: "🚀 FreeSwarm Router v1.0.0 is live!"
Body: "We're excited to announce the first production release of FreeSwarm Router!

Features:
- Multi-account routing across AI providers
- 6 intelligent routing strategies
- Cost optimization
- Analytics & monitoring
- Fully open source

Download: https://github.com/yethikrishna/free-swarm/releases

Please try it out and share feedback in this thread!"
```

#### 4.2 Prepare Press/Marketing Materials
```
Time: 30-60 minutes
Complexity: Low

Create one-sheet (save as PDF):

---
FreeSwarm Router v1.0.0
Enterprise AI Subscription Management

What is it?
Desktop application for managing multiple AI subscriptions (Claude, ChatGPT, Gemini) with intelligent routing, automatic fallback, and cost optimization.

Key Features:
✓ Multi-account routing
✓ 6 routing strategies (fill-first, round-robin, priority, cost-aware, health, load-balance)
✓ Automatic fallback when accounts exhausted
✓ Cost optimization (route to cheapest)
✓ Analytics & monitoring
✓ Works offline
✓ All data encrypted locally

Download:
- macOS (arm64 & x64): https://...
- Windows (x64): https://...
- Website with auto-download: https://freeswarm.vercel.app

GitHub:
https://github.com/yethikrishna/free-swarm

License: MIT (open source)

---
```

---

### SECTION 5: Infrastructure Verification (1-2 hours)

#### 5.1 Verify All Components
```
Time: 1-2 hours
Complexity: Medium

Checklist:

GitHub Setup:
□ All secrets configured (APPLE_ID, AZURE_*, DOCKER_*)
□ CI/CD workflow file exists (.github/workflows/release.yml)
□ Test build v0.9.0-test succeeded
□ Release artifacts created successfully
□ Docker image pushed to Docker Hub

Website:
□ Website deployed (Vercel/Netlify/GitHub Pages)
□ URL accessible from browser
□ Download buttons visible
□ Platform detection works
□ Download links functional
□ No console errors

Documentation:
□ README.md updated
□ CHANGELOG.md created
□ Installation guides per platform
□ Troubleshooting guide exists
□ User guide complete

Marketing:
□ Social media posts drafted
□ Press materials prepared
□ GitHub Discussion template ready
□ Email template (if needed) prepared

Code:
□ All code compiles (npm run build)
□ No TypeScript errors
□ No Python errors
□ Security scan clean
□ No console warnings
```

#### 5.2 Create Deployment Checklist
```
Time: 30 minutes
Complexity: Low

Create: DEPLOYMENT_CHECKLIST.md

Contents:

FINAL PRE-RELEASE CHECKLIST

Code Quality:
□ npm run build succeeds
□ npm run typecheck succeeds
□ python -m py_compile succeeds
□ npm audit shows no critical
□ No hardcoded secrets
□ No TODO comments

Documentation:
□ README complete
□ CHANGELOG complete
□ Installation guide tested
□ User guide comprehensive
□ API docs updated

Infrastructure:
□ GitHub Actions tested (v0.9.0-test)
□ Website deployed and working
□ Download links all functional
□ Metrics endpoint responds
□ Docker image pushed

Pre-Testing:
□ All secrets configured
□ CI/CD pipeline ready
□ Website live
□ Download infrastructure working
□ Marketing materials prepared
□ Support channels ready (GitHub Issues, Discussions)

Release Day:
□ All above complete
□ Test devices prepared (macOS + Windows)
□ Testing schedule blocked
□ Team notified of launch
□ Status page ready (if applicable)
```

---

### SECTION 6: Final Checklist Before Testing
```
✅ WHEN ALL ABOVE IS COMPLETE, YOU'RE READY TO TEST

Pre-Testing Status: Everything working
- GitHub Secrets ✅
- CI/CD Pipeline ✅
- Website Deployed ✅
- Marketing Ready ✅
- Documentation Complete ✅
- Code Compiles ✅

Next Step: Hardware Testing (following LAUNCH_CHECKLIST_MASTER.md)

Timeline:
- Week 1: Infrastructure setup (sections 1-6) ✓
- Week 2: Hardware testing + launch prep
- Week 3: Release v1.0.0
```

---

## 📋 COMPLETE "DO NOW" SUMMARY

### DO THIS WEEK (Before Testing)

```
Monday-Tuesday (3-4 hours):
□ Section 1: GitHub & CI/CD Setup
  □ Add all GitHub Secrets (30 min)
  □ Test with v0.9.0-test tag (1-2 hours)
  □ Verify builds succeed (30 min)

Wednesday (2-3 hours):
□ Section 2: Website Deployment
  □ Choose hosting platform (30 min)
  □ Deploy website (1-2 hours)
  □ Test auto-download (30 min)

Thursday (2-3 hours):
□ Section 3: Documentation & Marketing
  □ Create README_LAUNCH.md (1 hour)
  □ Create CHANGELOG.md (30 min)
  □ Create Installation guides (1 hour)

Friday (1-2 hours):
□ Section 4: Announcement Prep
  □ Draft social media posts (30 min)
  □ Prepare press materials (30 min)

Friday Afternoon (1-2 hours):
□ Section 5: Verification
  □ Verify all components (1-2 hours)

TOTAL: 10-14 hours over one week
RESULT: Ready to begin testing with everything working
```

### DO NOT DO YET

❌ Test on actual hardware (next week)
❌ Test OAuth flows (during hardware testing)
❌ Test routing strategies (during hardware testing)
❌ Create v1.0.0 release tag (after testing succeeds)
❌ Launch announcement (after testing succeeds)

---

## 🎯 Success Criteria for "Ready to Test"

When you reach this point, you're ready to move to LAUNCH_CHECKLIST_MASTER.md testing phase:

✅ GitHub Secrets all configured
✅ CI/CD pipeline tested (v0.9.0-test succeeded)
✅ Website live and working
✅ Download infrastructure functional
✅ All documentation complete
✅ Code compiles without errors
✅ Marketing materials prepared
✅ Support channels ready
✅ Team aligned on launch

---

## Next Steps

After completing everything above:

**THEN** Follow: LAUNCH_CHECKLIST_MASTER.md Phase 2 (Hardware Testing)

**Questions?**
- Section 1 issues? → GitHub Actions docs
- Section 2 issues? → Vercel/Netlify support
- Section 3 issues? → Writing style guides
- Section 4 issues? → Marketing strategy
- Section 5 issues? → Checklists above

---

**Estimated Time**: 10-14 hours (1 week full-time or 2-3 weeks part-time)  
**Outcome**: Production-ready to begin testing  
**Next**: Hardware testing (following master checklist)

