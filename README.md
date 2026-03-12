# lcp

Measure time to first feed image for zora.co using headless Chrome.

## What it measures

Specifically tracks the **first priority image in the feed** - the image with `fetchpriority="high"` and `loading="eager"` from the CDN (choicecdn.com). This is the first post's image that users see when the feed loads.

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
First Feed Image: 1847ms (good)
Download Time: 423ms
Size: 112.3 KB

Image:
  .../rs:fill:1200:1600/g:ce/f:webp/aHR0cHM6Ly9tYWdpYy5...

Thresholds: good ≤2500ms, poor >4000ms
```

## How it works

1. Uses MutationObserver to watch for `<img>` elements as they're added to the DOM
2. Identifies the first image with:
   - `fetchpriority="high"` OR `loading="eager"`
   - Source URL containing `choicecdn.com`, `decentralized-content.com`, or `ipfs`
3. Attaches a load event listener to capture when the image finishes loading
4. Reports the time from navigation start to image load completion

## Thresholds

Based on [Web Vitals LCP](https://web.dev/lcp/):

- **Good**: ≤ 2500ms
- **Needs Improvement**: 2500ms - 4000ms
- **Poor**: > 4000ms

## License

MIT
