# FreeSwarm Release Strategy & Checklist

Coordinated release plan for two products: FreeSwarm (main app) and FreeSwarm Router (standalone).

---

## Product Overview

### Product 1: FreeSwarm (Complete Suite)
- **What**: Desktop app + Backend + Router (all-in-one)
- **Download**: DMG (macOS), EXE (Windows)
- **Website**: https://freeswarm.myndlabs.tech
- **For**: Users who want full agent orchestrator with UI + routing
- **GitHub Release**: FreeSwarm v1.2.85+

### Product 2: FreeSwarm Router (Standalone)
- **What**: Routing service only (CLI/API)
- **Download**: DMG (macOS), EXE (Windows)
- **Website**: https://freeswarm-router.myndlabs.tech
- **For**: Developers who only need subscription routing
- **GitHub Release**: FreeSwarm Router v1.0.0

---

## Release Schedule

### Phase 1: FreeSwarm Router v1.0.0 (THIS WEEK)
- [ ] Create v1.0.0 tag
- [ ] GitHub Actions CI/CD builds all platforms
- [ ] GitHub Release created with signed installers
- [ ] Website download buttons work
- [ ] Cross-link from main FreeSwarm site

### Phase 2: FreeSwarm App (NEXT)
- [ ] Tag main app version (v1.2.85 or higher)
- [ ] GitHub Actions builds/signs/publishes
- [ ] Update main website with Router link
- [ ] Release announcement to both audiences

---

## GitHub Release Template

### FreeSwarm Router v1.0.0

```markdown
# 🚀 FreeSwarm Router v1.0.0

Enterprise AI Subscription Management - Initial Release

## Download

- **macOS (Apple Silicon)**: FreeSwarm-arm64.dmg
- **macOS (Intel)**: FreeSwarm-x64.dmg
- **Windows 10+**: FreeSwarm-Setup-x64.exe

## What's New

### Core Features
- Multi-account OAuth routing (Claude, ChatGPT, Gemini)
- 6 intelligent routing strategies
- Smart model discovery (20+ models + live API)
- Prometheus metrics & analytics
- Local-first security (no cloud relay)

### Routing Strategies
- **fill-first**: Primary account with fallback
- **round-robin**: Fair distribution
- **priority**: Score-based selection
- **cost-aware**: Real-time price optimization
- **health**: Avoid failing accounts
- **load-balance**: Least-used selection

### Getting Started
[Installation Guide](https://github.com/yethikrishna/free-swarm/blob/main/INSTALLATION_ROUTER.md)

## Documentation
- [README](https://github.com/yethikrishna/free-swarm/blob/main/README_ROUTER.md)
- [Changelog](https://github.com/yethikrishna/free-swarm/blob/main/CHANGELOG_ROUTER.md)
- [Installation Guide](https://github.com/yethikrishna/free-swarm/blob/main/INSTALLATION_ROUTER.md)
- [Production Readiness](https://github.com/yethikrishna/free-swarm/blob/main/PRODUCTION_READINESS.md)

## Verification

```bash
# Verify macOS notarization
spctl -a -v -t install -e allow FreeSwarm-arm64.dmg

# Check Windows signature
sigcheck64 FreeSwarm-Setup-x64.exe

# Test after installation
curl http://localhost:8080/health
```

## Installation

### Quick Start
1. Download installer for your platform
2. Double-click to install
3. Add your AI accounts in Settings
4. Choose routing strategy
5. Start routing!

See [Installation Guide](https://github.com/yethikrishna/free-swarm/blob/main/INSTALLATION_ROUTER.md) for detailed steps.

## Support
- 🐛 [Report Issues](https://github.com/yethikrishna/free-swarm/issues)
- 💬 [Ask Questions](https://github.com/yethikrishna/free-swarm/discussions)
- 📚 [Full Documentation](https://github.com/yethikrishna/free-swarm)

---

**🎉 FreeSwarm Router v1.0.0 is production-ready!**

Part of the [FreeSwarm](https://freeswarm.myndlabs.tech) ecosystem.
```

---

## Deployment Checklist

### Before Creating Release

- [ ] All tests passing in CI/CD
- [ ] All commits pushed to main branch
- [ ] Documentation complete and reviewed
- [ ] Version number correct (1.0.0)
- [ ] Website updated with v1.0.0 info
- [ ] Download links correct in website
- [ ] Cross-links to main FreeSwarm working

### Creating Release

```bash
# 1. Create tag on main branch
git checkout main
git pull origin main
git tag -a v1.0.0 -m "Release FreeSwarm Router v1.0.0"

# 2. Push tag to GitHub
git push origin v1.0.0

# 3. GitHub Actions automatically:
#    - Builds macOS arm64 (with notarization)
#    - Builds macOS x64 (with notarization)
#    - Builds Windows x64 (with signing)
#    - Creates GitHub Release
#    - Publishes Docker image
#    - Sends Slack/Discord notifications

# 4. Verify builds succeed
#    Go to: https://github.com/yethikrishna/free-swarm/actions
#    Wait for all jobs to complete (10-15 minutes)
```

### After Release Created

- [ ] Verify all 3 installers on GitHub Releases page
- [ ] Test downloads work for each platform
- [ ] Verify signatures/notarization
- [ ] Website download buttons working
- [ ] Send announcement to:
  - [ ] GitHub Releases page
  - [ ] GitHub Discussions
  - [ ] Twitter / Social media
  - [ ] Email list (if applicable)

---

## Website Links & Cross-Promotion

### Main FreeSwarm Site (freeswarm.myndlabs.tech)
Add section:
```html
<div class="sidebar">
  <h3>Also Try</h3>
  <p>
    Looking for just routing?
    <a href="https://freeswarm-router.myndlabs.tech">FreeSwarm Router →</a>
  </p>
</div>
```

### FreeSwarm Router Site (freeswarm-router.myndlabs.tech)
- ✅ Navigation has "← Back to FreeSwarm" link
- ✅ Footer mentions "Part of FreeSwarm"
- ✅ Links to main site in relevant places

---

## Announcement Template

### Twitter / Social Media

```
🚀 FreeSwarm Router v1.0.0 is here!

Route requests across multiple AI subscriptions with intelligent fallback & cost optimization.

6 routing strategies • Smart model discovery • Analytics & monitoring

Free & open-source. Download now:
https://freeswarm-router.myndlabs.tech

#AI #DevTools #OpenSource
```

### GitHub Discussions

```
📢 Announcing FreeSwarm Router v1.0.0

We're excited to release FreeSwarm Router - enterprise AI subscription management!

**Features:**
- Multi-account routing (Claude, ChatGPT, Gemini)
- 6 routing strategies
- Real-time cost optimization
- Prometheus metrics

Download: https://freeswarm-router.myndlabs.tech
Docs: https://github.com/yethikrishna/free-swarm/tree/main

Questions? Ask here! 👇
```

---

## Timeline

**TODAY**: FreeSwarm Router v1.0.0
- Create tag
- Run CI/CD
- Publish release
- Announce

**TOMORROW**: Main FreeSwarm Update
- Tag main app
- Update website with Router link
- Send cross-promotion announcement

---

## Success Criteria

- ✅ All 3 platform builds succeed
- ✅ Installers are signed/notarized
- ✅ GitHub Release created with assets
- ✅ Website download buttons work
- ✅ Download stats show positive traction
- ✅ GitHub issues/discussions active
- ✅ No critical bugs reported in first 48 hours

---

**Ready to release? Let's ship it! 🚀**
