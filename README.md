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

## License

MIT
