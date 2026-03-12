# lcp

Measure time to first feed image for zora.co using headless Chrome.

## What it measures

Tracks the **first feed image** to load - large images (≥500px width) from the CDN (choicecdn.com). This is the first post's image that users see when the feed loads. Mobile uses 540px images, desktop uses 1200px images.

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

## Output

```
URL: https://zora.co
First Feed Image: 4371ms (poor)
Dimensions: 1080x1350

Image:
  .../rs:fill:1200:1500/g:ce/f:webp/aHR0cHM6Ly9tYWdpYy5...

Thresholds: good ≤2500ms, poor >4000ms
```

## How it works

1. Navigates to the page with headless Chrome
2. Polls the DOM for the first feed image (large CDN images ≥500px width)
3. Waits for the image to fully load (`complete` and `naturalWidth > 0`)
4. Reports the time from navigation start to image load completion

## Thresholds

Based on [Web Vitals LCP](https://web.dev/lcp/):

- **Good**: ≤ 2500ms
- **Needs Improvement**: 2500ms - 4000ms
- **Poor**: > 4000ms

## License

MIT
