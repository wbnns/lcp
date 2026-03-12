# lcp

Measure Largest Contentful Paint (LCP) for any URL using headless Chrome. Runs on any server or VPS.

## Install

```bash
git clone https://github.com/wbnns/lcp
cd lcp
npm install
```

### System dependencies (Debian/Ubuntu)

```bash
apt-get update && apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libxkbcommon0 libxcomposite1 libxrandr2 libgbm1 libasound2
```

## Usage

```bash
# Basic usage
node measure-lcp.js https://zora.co

# Multiple runs (averaged)
node measure-lcp.js https://zora.co --runs 5

# Mobile emulation
node measure-lcp.js https://zora.co --mobile

# JSON output (for scripting)
node measure-lcp.js https://zora.co --json

# Combine options
node measure-lcp.js https://zora.co --runs 3 --mobile --json
```

## Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--runs <n>` | `-r` | Number of runs to average |
| `--mobile` | `-m` | Emulate mobile device (iPhone 12) |
| `--json` | `-j` | Output as JSON |
| `--help` | `-h` | Show help |

## Output

```
Measuring LCP for https://zora.co...

URL: https://zora.co
LCP: 1847ms (good)

LCP Element:
  Tag:  <img>
  Size: 245,760 px²
  Resource: https://zora.co/images/hero.webp

Thresholds: good ≤2500ms, poor >4000ms
```

## Thresholds

Based on [Web Vitals](https://web.dev/lcp/):

- **Good**: ≤ 2500ms
- **Needs Improvement**: 2500ms - 4000ms
- **Poor**: > 4000ms

## How it works

Unlike naive implementations that use a fixed wait time, this tool waits for LCP to truly stabilize by monitoring:

1. **Network requests** - Tracks all `fetch()` and `XMLHttpRequest` calls
2. **LCP changes** - Monitors the PerformanceObserver for new LCP candidates

LCP is considered stable when:
- All pending network requests have completed
- The LCP element hasn't changed for 2 seconds
- Both conditions are true simultaneously

This handles SPAs and data-driven pages that render content after API responses.

If stability can't be achieved within 15 seconds, a warning is shown and the current LCP is reported.

## License

MIT
