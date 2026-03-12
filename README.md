# lcp

Measure Largest Contentful Paint (LCP) and feed performance for any URL using headless Chrome. Runs on any server or VPS.

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
# Basic LCP measurement
node measure-lcp.js https://zora.co

# Feed mode: track image loading performance
node measure-lcp.js https://zora.co --feed

# Wait for more images before reporting
node measure-lcp.js https://zora.co --feed --feed-images 10

# Multiple runs for averaging
node measure-lcp.js https://zora.co --feed --runs 3

# Mobile emulation
node measure-lcp.js https://zora.co --feed --mobile

# JSON output (for scripting/monitoring)
node measure-lcp.js https://zora.co --feed --json
```

## Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--runs <n>` | `-r` | Number of runs to average |
| `--mobile` | `-m` | Emulate mobile device (iPhone 12) |
| `--feed` | `-f` | Enable feed mode: track CDN image loading |
| `--feed-images <n>` | `-fi` | Number of feed images to wait for (default: 5) |
| `--json` | `-j` | Output as JSON |
| `--help` | `-h` | Show help |

## Output

### Basic LCP mode

```
URL: https://zora.co
LCP: 1847ms (good)

LCP Element:
  Tag: <img> | Size: 245,760 px²
  Resource: .../rs:fill:1200:1600/g:ce/f:webp/...

Thresholds: good ≤2500ms, poor >4000ms
```

### Feed mode

```
URL: https://zora.co
LCP: 2134ms (good)

LCP Element:
  Tag: <img> | Size: 518,400 px²

Feed Performance:
  Images loaded: 8 CDN images (12 total)
  1st image ready: 1847ms
  3rd image ready: 2456ms
  5th image ready: 3102ms

Slowest Images:
  1. 1245ms (156.2 KB)
     .../rs:fill:1200:1600/g:ce/f:webp/aHR0cHM6Ly9tYWdpYy5...
  2. 987ms (89.4 KB)
     .../rs:fill:1200:1600/g:ce/f:webp/aHR0cHM6Ly9tYWdpYy5...

Image Load Timeline:
  1. @1847ms - 823ms (112.3 KB)
  2. @2102ms - 445ms (67.8 KB)
  3. @2456ms - 1245ms (156.2 KB)
  ...
```

## Feed Mode

Feed mode is designed for image-heavy feeds like zora.co. It tracks:

- **CDN images**: Images from `choicecdn.com`, `decentralized-content.com`, or IPFS
- **Load timing**: When each image finished loading (relative to navigation start)
- **Duration**: How long each image took to download
- **Slowest images**: Top 5 slowest images with URLs for debugging

This helps identify:
- Which images are blocking perceived performance
- Whether CDN/imgproxy is responding quickly
- If specific images are consistently slow (large size, slow origin, etc.)

## How it works

The tool waits for LCP to stabilize by monitoring:

1. **Network requests** - Tracks all `fetch()` and `XMLHttpRequest` calls
2. **LCP changes** - Monitors PerformanceObserver for new LCP candidates
3. **Image loads** - Uses Resource Timing API to track image performance

In feed mode, it also waits for N CDN images to load before reporting.

LCP is considered stable when:
- All pending network requests have completed
- The LCP element hasn't changed for 2 seconds
- (Feed mode) Required number of CDN images have loaded

## Thresholds

Based on [Web Vitals](https://web.dev/lcp/):

- **Good**: ≤ 2500ms
- **Needs Improvement**: 2500ms - 4000ms
- **Poor**: > 4000ms

## License

MIT
