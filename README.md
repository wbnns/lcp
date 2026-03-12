# lcp

Measure time to first image load for any URL using headless Chrome. Designed for image-heavy feeds like zora.co.

## Install

```bash
git clone https://github.com/wbnns/lcp
cd lcp
npm install
npx puppeteer browsers install chrome
```

### System dependencies (Debian/Ubuntu)

```bash
apt-get update && apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libxkbcommon0 libxcomposite1 libxrandr2 libgbm1 libasound2
```

## Usage

```bash
# Basic measurement
node measure-lcp.js https://zora.co

# Multiple runs for averaging
node measure-lcp.js https://zora.co --runs 5

# Mobile emulation
node measure-lcp.js https://zora.co --mobile

# JSON output
node measure-lcp.js https://zora.co --json
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
URL: https://zora.co
First Image: 1847ms (good)
Download: 423ms
Size: 112.3 KB

Image:
  .../rs:fill:1200:1600/g:ce/f:webp/aHR0cHM6Ly9tYWdpYy5...

Thresholds: good ≤2500ms, poor >4000ms
```

## What it measures

- **First Image**: Time from navigation start until the first CDN image finishes loading
- **Download**: How long the image took to download (network time)
- **Size**: Encoded size of the image

Tracks images from:
- `choicecdn.com` (imgproxy CDN)
- `decentralized-content.com`
- IPFS URLs

## How it works

1. Launches headless Chrome
2. Injects Resource Timing API observers before navigation
3. Navigates to the URL
4. Waits for the first CDN image to load
5. Reports timing from the Resource Timing API

## Thresholds

Based on [Web Vitals LCP](https://web.dev/lcp/):

- **Good**: ≤ 2500ms
- **Needs Improvement**: 2500ms - 4000ms
- **Poor**: > 4000ms

## License

MIT
