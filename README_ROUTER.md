# FreeSwarm Router - Enterprise AI Subscription Management

**Version 1.0.0** | Open-source | MIT License

FreeSwarm Router is a standalone service for routing AI requests across multiple subscriptions (Claude, ChatGPT, Gemini, etc.) with intelligent fallback, cost optimization, and unified model access.

## Quick Start

### Download
- **macOS (Apple Silicon)**: [FreeSwarm-arm64.dmg](https://github.com/yethikrishna/free-swarm/releases/latest)
- **macOS (Intel)**: [FreeSwarm-x64.dmg](https://github.com/yethikrishna/free-swarm/releases/latest)
- **Windows 10+**: [FreeSwarm-Setup-x64.exe](https://github.com/yethikrishna/free-swarm/releases/latest)

### Install
1. Download the installer for your platform
2. Double-click to install (macOS) or run setup (Windows)
3. Launch FreeSwarm Router
4. Add your AI subscription accounts (Claude, ChatGPT, Gemini)
5. Choose a routing strategy
6. Start routing requests

## Features

### 🚀 Multi-Account Routing
Add multiple subscriptions for Claude, ChatGPT, Gemini, and other providers. Automatic fallback when one account is exhausted.

### 💰 Cost Optimization
Route to the cheapest available provider. Real-time price comparison keeps your API costs minimal.

### ⚡ 6 Routing Strategies
- **fill-first**: Use primary account first, fallback when exhausted
- **round-robin**: Distribute requests evenly across all accounts
- **priority**: Score-based selection (health + recency)
- **cost-aware**: Route to cheapest provider
- **health**: Avoid failing accounts
- **load-balance**: Fair distribution across all accounts

### 🔍 Smart Model Discovery
20+ hardcoded models + live API discovery. Automatic updates with intelligent caching. Supports:
- Claude 3.5 Sonnet, Opus, Haiku
- GPT-4, GPT-4 Turbo, GPT-3.5
- Gemini Pro, Gemini Flash
- And more...

### 📈 Analytics & Monitoring
- Prometheus metrics endpoint
- Request latency tracking (p50, p95, p99)
- Routing strategy usage analytics
- Provider health monitoring
- Token usage tracking

### 🔐 Local First & Secure
All data stays local and encrypted. Works offline (except OAuth). No cloud dependency for routing logic.

## Installation Guides

### macOS
1. Download `FreeSwarm-arm64.dmg` (Apple Silicon M1/M2) or `FreeSwarm-x64.dmg` (Intel)
2. Open Downloads folder
3. Double-click the DMG file
4. Drag FreeSwarm Router to Applications folder
5. Launch from Applications
6. First launch: macOS may show security warning (Right-click → Open)

### Windows
1. Download `FreeSwarm-Setup-x64.exe`
2. Run the installer
3. Follow setup wizard
4. Choose installation location
5. Complete installation
6. Launch from Start Menu
7. First launch: Windows may show SmartScreen warning (Click "Run anyway")

## Configuration

### Add Accounts
1. Open FreeSwarm Router
2. Go to Settings → Accounts
3. Click "Add Account"
4. Select provider (Claude, ChatGPT, Gemini)
5. Authenticate via OAuth or API key
6. Save

### Choose Routing Strategy
1. Go to Settings → Routing
2. Select desired strategy
3. Configure per-account overrides (optional)
4. Save

### Monitor Metrics
View real-time metrics at: `http://localhost:8080/metrics` (Prometheus format)

## API Usage

### Local HTTP Endpoint
```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Hello!"}],
    "routing_strategy": "cost-aware"
  }'
```

### Environment Variables
```bash
FREESWARM_ROUTER_PORT=8080
FREESWARM_ROUTER_STRATEGY=round-robin
FREESWARM_ROUTER_LOG_LEVEL=info
```

## Customization

### Custom Routing Strategies
Extend with your own routing logic:

```javascript
// custom-strategy.js
module.exports = {
  name: 'my-custom-strategy',
  select: (accounts, models, lastRequest) => {
    // Your logic here
    return selectedAccount;
  }
};
```

### Custom OAuth Providers
Add new provider adapters for proprietary APIs:

```javascript
// custom-provider.js
module.exports = {
  name: 'my-provider',
  startAuth: () => { /* Device code flow */ },
  pollAuth: () => { /* Token polling */ },
  refreshToken: () => { /* Token refresh */ },
  discoverModels: () => { /* Model discovery */ }
};
```

See [PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) for full customization guide.

## Troubleshooting

### "Port 8080 already in use"
Change port in Settings → Network → Port

### "Failed to authenticate with Claude"
- Verify your Claude API key is valid
- Check internet connection
- Try re-authenticating from Settings

### "Routing strategy not working"
- Ensure at least 2 accounts are configured
- Check account health status
- Try "fill-first" to test basic routing

### "Models not appearing"
- Refresh model cache: Settings → Advanced → Refresh Models
- Check internet connection for live discovery
- Verify account has model access

## Performance Benchmarks

On a 2021 MacBook Pro (M1):
- Request routing latency: **<50ms** (local)
- Model discovery: **2-5 seconds** (cached)
- Fallback activation: **<200ms**
- Metrics collection: **<1ms**

## Security

- All API keys stored encrypted locally
- No telemetry or external data collection
- OAuth tokens refreshed automatically
- Requests routed through local process (no relay)
- Open source: audit code on GitHub

## Support

- **GitHub Issues**: [Report bugs](https://github.com/yethikrishna/free-swarm/issues)
- **GitHub Discussions**: [Ask questions](https://github.com/yethikrishna/free-swarm/discussions)
- **Documentation**: [Full guides](docs/PRODUCTION_READINESS.md)

## Related Products

**FreeSwarm** - Full AI agent orchestrator with UI, browser control, and MCP integrations
- Download: [freeswarm.myndlabs.tech](https://freeswarm.myndlabs.tech)
- Bundles router + desktop app + backend

## License

MIT License - See [LICENSE](LICENSE) for details

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

**Made with ❤️ by the FreeSwarm team**

[GitHub](https://github.com/yethikrishna/free-swarm) • [Website](https://freeswarm.myndlabs.tech) • [Discussions](https://github.com/yethikrishna/free-swarm/discussions)
