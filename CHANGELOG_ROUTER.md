# FreeSwarm Router - Changelog

All notable changes to the FreeSwarm Router project are documented here.

## [1.0.0] - June 18, 2026

### ✨ Features

#### Multi-Account OAuth Routing
- Support for 5+ OAuth providers (Claude, ChatGPT, Gemini, Anthropic, OpenRouter)
- Automatic OAuth token refresh and rotation
- Per-account fallback configuration
- Account health monitoring and status tracking

#### 6 Intelligent Routing Strategies
- **fill-first**: Sequential account usage with fallback
- **round-robin**: Fair distribution across all accounts
- **priority**: Score-based (health + recency + performance)
- **cost-aware**: Real-time price comparison and optimization
- **health**: Avoid failing accounts automatically
- **load-balance**: Least-recently-used account selection

#### Smart Model Discovery
- 20+ hardcoded models (fast, always available)
- Live API discovery with provider caching (1-2 hour TTL)
- Model filtering (removes experimental, pricing-gated models)
- Model ranking by capabilities and speed
- Use-case based recommendations (reasoning, vision, cost-optimized, fast, long-context)

#### Analytics & Monitoring
- Prometheus-compatible metrics endpoint (`/metrics`)
- Request rate tracking (requests/second)
- Latency percentiles (p50, p95, p99)
- Routing strategy usage analytics
- Fallback activation tracking
- Provider connection failure detection
- Model lock event logging
- Quota exhaustion alerts
- Token usage aggregation
- Active connection monitoring

#### Admin Interface
- Web-based dashboard for configuration
- Account management (add/remove/edit)
- Routing strategy selection
- Per-provider strategy overrides
- Settings persistence
- Real-time status monitoring

#### Security
- Encrypted credential storage
- OAuth device code flow support
- Automatic token refresh with retry logic
- Rate limiting and request throttling
- CORS policy enforcement
- Input validation for all endpoints

### 🐛 Bug Fixes

- Fixed model discovery caching timing
- Improved fallback activation reliability
- Corrected token refresh edge cases
- Better error handling for provider failures

### 📚 Documentation

- Complete README with installation guides
- Production readiness guide with architecture diagrams
- API reference and integration examples
- Custom routing strategy implementation guide
- OAuth provider adapter pattern documentation
- Troubleshooting guide with common issues

### 🎨 UI/UX

- Professional marketing website
- Download buttons with platform detection
- Feature showcase with routing strategy details
- Use case demonstrations
- Footer with documentation links

### 🏗️ Infrastructure

- GitHub Actions CI/CD pipeline
- macOS arm64 build with notarization
- macOS x64 build with notarization
- Windows x64 build with code signing
- Docker image publishing
- GitHub release automation
- Build artifact verification

### 🔧 Technical Improvements

- Optimized model discovery with multi-tier caching
- Async request handling with proper cleanup
- Memory-efficient token management
- Improved logging with request correlation IDs
- Better provider error recovery
- Enhanced metrics collection granularity

### 📦 Distribution

- Installer-based distribution (DMG for macOS, EXE for Windows)
- Code signing for all platforms (Apple notarization, Azure code signing)
- GitHub Releases integration
- Auto-download capability with platform detection

## Known Limitations

- Linux builds not yet available (planned v1.1.0)
- Kubernetes deployment docs pending
- GraphQL API not yet implemented
- Custom model registry (v1.1.0+)

## Migration Guide

This is the initial release (v1.0.0). No migrations needed.

## Upgrade Instructions

Not applicable for v1.0.0.

## Support

For issues, questions, or feature requests:
- GitHub Issues: https://github.com/yethikrishna/free-swarm/issues
- GitHub Discussions: https://github.com/yethikrishna/free-swarm/discussions
- Documentation: https://github.com/yethikrishna/free-swarm/blob/main/docs/PRODUCTION_READINESS.md

## Contributors

This release was built with ❤️ by the FreeSwarm team.

---

**Release Date**: June 18, 2026  
**Git Commit**: See GitHub releases page for commit hash  
**Build Artifacts**: Available on GitHub Releases (signed & notarized)
