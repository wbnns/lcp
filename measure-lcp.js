#!/usr/bin/env node

const puppeteer = require('puppeteer');

const THRESHOLDS = {
  good: 2500,
  needsImprovement: 4000
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: 'https://zora.co',
    runs: 1,
    json: false,
    mobile: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json' || arg === '-j') {
      options.json = true;
    } else if (arg === '--mobile' || arg === '-m') {
      options.mobile = true;
    } else if (arg === '--runs' || arg === '-r') {
      options.runs = parseInt(args[++i], 10) || 1;
    } else if (!arg.startsWith('-')) {
      options.url = arg.startsWith('http') ? arg : `https://${arg}`;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Usage: lcp [url] [options]

Arguments:
  url                    URL to measure (default: https://zora.co)

Options:
  -r, --runs <number>    Number of runs to average (default: 1)
  -m, --mobile           Emulate mobile device
  -j, --json             Output results as JSON
  -h, --help             Show this help message

Examples:
  lcp https://zora.co
  lcp zora.co --runs 3
  lcp https://zora.co --mobile --json
`);
}

function getRating(lcp) {
  if (lcp <= THRESHOLDS.good) return 'good';
  if (lcp <= THRESHOLDS.needsImprovement) return 'needs-improvement';
  return 'poor';
}

function getColor(rating) {
  const colors = {
    good: '\x1b[32m',
    'needs-improvement': '\x1b[33m',
    poor: '\x1b[31m'
  };
  return colors[rating] || '';
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

// Default stability settings
const STABILITY = {
  timeout: 20000,        // Max time to wait for stable LCP
  stableThreshold: 2000, // LCP must not change for this long
  pollInterval: 200      // How often to check stability
};

async function measureLCP(url, options = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();

  if (options.mobile) {
    await page.emulate(puppeteer.KnownDevices['iPhone 12']);
  } else {
    await page.setViewport({ width: 1920, height: 1080 });
  }

  // Inject tracking before navigation
  await page.evaluateOnNewDocument(() => {
    window.__PERF__ = {
      navigationStart: performance.now(),

      // LCP tracking
      lcp: {
        entries: [],
        lastChangeTime: Date.now()
      },

      // Image tracking (for feed mode)
      images: {
        started: [],   // { url, startTime }
        completed: [], // { url, startTime, endTime, duration, size, cached }
        failed: []     // { url, startTime, error }
      },

      // Network tracking
      pendingFetches: 0,
      pendingXHR: 0
    };

    // Track LCP
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__PERF__.lcp.entries.push(entry);
        window.__PERF__.lcp.lastChangeTime = Date.now();
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    // Track image loads via PerformanceObserver
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.initiatorType === 'img') {
          const isCDN = entry.name.includes('choicecdn.com') ||
                        entry.name.includes('decentralized-content.com') ||
                        entry.name.includes('ipfs');

          window.__PERF__.images.completed.push({
            url: entry.name,
            startTime: entry.startTime,
            endTime: entry.responseEnd,
            duration: entry.responseEnd - entry.startTime,
            transferSize: entry.transferSize,
            encodedSize: entry.encodedBodySize,
            cached: entry.transferSize === 0,
            isCDN
          });
        }
      }
    }).observe({ type: 'resource', buffered: true });

    // Track fetch requests
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      window.__PERF__.pendingFetches++;
      try {
        return await origFetch(...args);
      } finally {
        window.__PERF__.pendingFetches--;
      }
    };

    // Track XHR requests
    const origXHROpen = XMLHttpRequest.prototype.open;
    const origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(...args) {
      this.__tracked__ = true;
      return origXHROpen.apply(this, args);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      if (this.__tracked__) {
        window.__PERF__.pendingXHR++;
        this.addEventListener('loadend', () => {
          window.__PERF__.pendingXHR--;
        }, { once: true });
      }
      return origXHRSend.apply(this, args);
    };
  });

  const startTime = Date.now();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    await browser.close();
    throw new Error(`Failed to load ${url}: ${err.message}`);
  }

  // Wait for first CDN image to load
  const stabilityStart = Date.now();
  let stable = false;

  while (Date.now() - stabilityStart < STABILITY.timeout) {
    const state = await page.evaluate(() => {
      const perf = window.__PERF__;
      const cdnImages = perf.images.completed.filter(img => img.isCDN);

      return {
        pendingFetches: perf.pendingFetches,
        pendingXHR: perf.pendingXHR,
        cdnImages: cdnImages.length
      };
    });

    const pendingRequests = state.pendingFetches + state.pendingXHR;

    // Done when first CDN image loads and no pending requests
    if (state.cdnImages >= 1 && pendingRequests === 0) {
      stable = true;
      break;
    }

    await new Promise(r => setTimeout(r, STABILITY.pollInterval));
  }

  // Extract first image timing
  const perfData = await page.evaluate(() => {
    const perf = window.__PERF__;

    // Get first CDN image (sorted by load completion time)
    const cdnImages = perf.images.completed
      .filter(img => img.isCDN)
      .sort((a, b) => a.endTime - b.endTime);

    const firstImage = cdnImages[0];

    return {
      firstImage: firstImage ? {
        time: Math.round(firstImage.endTime),
        duration: Math.round(firstImage.duration),
        size: firstImage.encodedSize,
        cached: firstImage.cached,
        url: firstImage.url
      } : null,
      totalCDNImages: cdnImages.length,
      totalImages: perf.images.completed.length
    };
  });

  const loadTime = Date.now() - startTime;

  await browser.close();

  return {
    ...perfData,
    loadTime,
    stable,
    timestamp: new Date().toISOString()
  };
}

async function runMultiple(url, runs, options) {
  const results = [];

  for (let i = 0; i < runs; i++) {
    if (!options.json && runs > 1) {
      process.stdout.write(`\rRun ${i + 1}/${runs}...`);
    }

    try {
      const result = await measureLCP(url, options);
      if (result && result.firstImage) {
        results.push(result);
      }
    } catch (err) {
      if (!options.json) {
        console.error(`\nRun ${i + 1} failed: ${err.message}`);
      }
    }
  }

  if (!options.json && runs > 1) {
    process.stdout.write('\r\x1b[K');
  }

  return results;
}

function calculateStats(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p75: sorted[Math.floor(sorted.length * 0.75)] || sorted[sorted.length - 1]
  };
}

function formatBytes(bytes) {
  if (!bytes) return 'N/A';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const { url, runs, json, mobile } = options;

  if (!json) {
    console.log(`\nMeasuring first image load for ${url}${mobile ? ' (mobile)' : ''}...`);
    if (runs > 1) console.log(`Running ${runs} iterations...\n`);
  }

  const results = await runMultiple(url, runs, options);

  if (results.length === 0) {
    if (json) {
      console.log(JSON.stringify({ error: 'No CDN images found' }));
    } else {
      console.error('Failed to detect any CDN images');
    }
    process.exit(1);
  }

  const firstImageStats = calculateStats(results.map(r => r.firstImage.time));
  const durationStats = calculateStats(results.map(r => r.firstImage.duration));
  const lastResult = results[results.length - 1];
  const rating = getRating(firstImageStats.avg);
  const allStable = results.every(r => r.stable);

  if (json) {
    console.log(JSON.stringify({
      url,
      mobile,
      firstImage: {
        time: firstImageStats.avg,
        duration: durationStats.avg,
        rating,
        size: lastResult.firstImage.size,
        cached: lastResult.firstImage.cached,
        url: lastResult.firstImage.url
      },
      stable: allStable,
      stats: runs > 1 ? {
        time: firstImageStats,
        duration: durationStats
      } : undefined,
      timestamp: new Date().toISOString()
    }, null, 2));
  } else {
    const color = getColor(rating);

    console.log(`\n${BOLD}URL:${RESET} ${url}`);
    console.log(`${BOLD}First Image:${RESET} ${color}${firstImageStats.avg.toFixed(0)}ms${RESET} (${rating})`);
    console.log(`${BOLD}Download:${RESET} ${durationStats.avg.toFixed(0)}ms`);
    console.log(`${BOLD}Size:${RESET} ${formatBytes(lastResult.firstImage.size)}${lastResult.firstImage.cached ? ' (cached)' : ''}`);

    if (!allStable) {
      console.log(`${DIM}⚠ Warning: measurement may not be stable${RESET}`);
    }

    if (runs > 1) {
      console.log(`\n${BOLD}Stats (${results.length} runs):${RESET}`);
      console.log(`  Time:     Min ${firstImageStats.min.toFixed(0)}ms | Max ${firstImageStats.max.toFixed(0)}ms | Median ${firstImageStats.median.toFixed(0)}ms`);
      console.log(`  Download: Min ${durationStats.min.toFixed(0)}ms | Max ${durationStats.max.toFixed(0)}ms | Median ${durationStats.median.toFixed(0)}ms`);
    }

    const shortUrl = lastResult.firstImage.url.length > 70
      ? '...' + lastResult.firstImage.url.slice(-67)
      : lastResult.firstImage.url;
    console.log(`\n${BOLD}Image:${RESET}`);
    console.log(`  ${DIM}${shortUrl}${RESET}`);

    console.log(`\n${DIM}Thresholds: good ≤${THRESHOLDS.good}ms, poor >${THRESHOLDS.needsImprovement}ms${RESET}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
