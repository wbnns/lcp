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
    feed: false,
    feedImages: 5,
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
    } else if (arg === '--feed' || arg === '-f') {
      options.feed = true;
    } else if (arg === '--feed-images' || arg === '-fi') {
      options.feedImages = parseInt(args[++i], 10) || 5;
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
  url                       URL to measure (default: https://zora.co)

Options:
  -r, --runs <number>       Number of runs to average (default: 1)
  -m, --mobile              Emulate mobile device
  -f, --feed                Enable feed mode: track image loading times
  -fi, --feed-images <n>    Number of feed images to wait for (default: 5)
  -j, --json                Output results as JSON
  -h, --help                Show this help message

Examples:
  lcp https://zora.co
  lcp zora.co --feed
  lcp zora.co --feed --feed-images 10 --json
  lcp https://zora.co/@user --mobile --runs 3
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

  // Wait for stable state
  const stabilityStart = Date.now();
  let stable = false;
  const feedImagesTarget = options.feed ? (options.feedImages || 5) : 0;

  while (Date.now() - stabilityStart < STABILITY.timeout) {
    const state = await page.evaluate((feedMode) => {
      const perf = window.__PERF__;
      const lastLCP = perf.lcp.entries[perf.lcp.entries.length - 1];
      const cdnImages = perf.images.completed.filter(img => img.isCDN);

      return {
        pendingFetches: perf.pendingFetches,
        pendingXHR: perf.pendingXHR,
        lcpTime: lastLCP?.startTime || null,
        lcpAge: Date.now() - perf.lcp.lastChangeTime,
        lcpCount: perf.lcp.entries.length,
        totalImages: perf.images.completed.length,
        cdnImages: cdnImages.length,
        feedMode
      };
    }, options.feed);

    const pendingRequests = state.pendingFetches + state.pendingXHR;

    // In feed mode, also wait for N CDN images
    const feedReady = !options.feed || state.cdnImages >= feedImagesTarget;

    if (state.lcpTime && pendingRequests === 0 && state.lcpAge >= STABILITY.stableThreshold && feedReady) {
      stable = true;
      break;
    }

    await new Promise(r => setTimeout(r, STABILITY.pollInterval));
  }

  // Extract all performance data
  const perfData = await page.evaluate(() => {
    const perf = window.__PERF__;
    const entries = perf.lcp.entries;
    const lastLCP = entries[entries.length - 1];

    // Sort images by endTime to get loading order
    const cdnImages = perf.images.completed
      .filter(img => img.isCDN)
      .sort((a, b) => a.endTime - b.endTime);

    // Calculate feed-specific metrics
    const feedMetrics = cdnImages.length > 0 ? {
      firstImageTime: cdnImages[0]?.endTime,
      thirdImageTime: cdnImages[2]?.endTime,
      fifthImageTime: cdnImages[4]?.endTime,
      tenthImageTime: cdnImages[9]?.endTime,
      images: cdnImages.slice(0, 10).map(img => ({
        url: img.url.length > 80 ? img.url.substring(0, 80) + '...' : img.url,
        duration: Math.round(img.duration),
        size: img.encodedSize,
        cached: img.cached,
        loadedAt: Math.round(img.endTime)
      }))
    } : null;

    // Find slowest images
    const slowestImages = [...cdnImages]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5)
      .map(img => ({
        url: img.url.length > 60 ? '...' + img.url.slice(-57) : img.url,
        duration: Math.round(img.duration),
        size: img.encodedSize
      }));

    return {
      lcp: lastLCP ? {
        time: lastLCP.startTime,
        element: lastLCP.element?.tagName || 'unknown',
        id: lastLCP.element?.id || null,
        className: lastLCP.element?.className || null,
        size: lastLCP.size,
        url: lastLCP.url || null,
        lcpCandidates: entries.length
      } : null,
      feed: feedMetrics,
      slowestImages,
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
      if (result && result.lcp) {
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

  const { url, runs, json, mobile, feed, feedImages } = options;

  if (!json) {
    console.log(`\nMeasuring ${feed ? 'feed performance' : 'LCP'} for ${url}${mobile ? ' (mobile)' : ''}...`);
    if (feed) console.log(`Waiting for ${feedImages} feed images to load...`);
    if (runs > 1) console.log(`Running ${runs} iterations...\n`);
  }

  const results = await runMultiple(url, runs, options);

  if (results.length === 0) {
    if (json) {
      console.log(JSON.stringify({ error: 'No data collected' }));
    } else {
      console.error('Failed to collect data');
    }
    process.exit(1);
  }

  const lcpStats = calculateStats(results.map(r => r.lcp.time));
  const lastResult = results[results.length - 1];
  const rating = getRating(lcpStats.avg);
  const allStable = results.every(r => r.stable);

  // Feed-specific stats
  let feedStats = null;
  if (feed && lastResult.feed) {
    feedStats = {
      firstImage: calculateStats(results.map(r => r.feed?.firstImageTime).filter(Boolean)),
      thirdImage: calculateStats(results.map(r => r.feed?.thirdImageTime).filter(Boolean)),
      fifthImage: calculateStats(results.map(r => r.feed?.fifthImageTime).filter(Boolean))
    };
  }

  if (json) {
    console.log(JSON.stringify({
      url,
      mobile,
      lcp: {
        value: lcpStats.avg,
        rating,
        element: lastResult.lcp.element,
        elementId: lastResult.lcp.id,
        size: lastResult.lcp.size,
        resourceUrl: lastResult.lcp.url,
        candidates: lastResult.lcp.lcpCandidates
      },
      feed: feed ? {
        imagesLoaded: lastResult.totalCDNImages,
        firstImageTime: feedStats?.firstImage?.avg,
        thirdImageTime: feedStats?.thirdImage?.avg,
        fifthImageTime: feedStats?.fifthImage?.avg,
        slowestImages: lastResult.slowestImages,
        images: lastResult.feed?.images
      } : undefined,
      stable: allStable,
      stats: runs > 1 ? { lcp: lcpStats, feed: feedStats } : undefined,
      timestamp: new Date().toISOString()
    }, null, 2));
  } else {
    const color = getColor(rating);

    console.log(`\n${BOLD}URL:${RESET} ${url}`);
    console.log(`${BOLD}LCP:${RESET} ${color}${lcpStats.avg.toFixed(0)}ms${RESET} (${rating})`);

    if (!allStable) {
      console.log(`${DIM}⚠ Warning: measurement may not be stable${RESET}`);
    }

    if (runs > 1) {
      console.log(`\n${BOLD}LCP Stats (${results.length} runs):${RESET}`);
      console.log(`  Min: ${lcpStats.min.toFixed(0)}ms | Max: ${lcpStats.max.toFixed(0)}ms | Median: ${lcpStats.median.toFixed(0)}ms`);
    }

    console.log(`\n${BOLD}LCP Element:${RESET}`);
    console.log(`  Tag: <${lastResult.lcp.element.toLowerCase()}> | Size: ${lastResult.lcp.size?.toLocaleString()} px²`);
    if (lastResult.lcp.url) {
      const shortUrl = lastResult.lcp.url.length > 60 ? '...' + lastResult.lcp.url.slice(-57) : lastResult.lcp.url;
      console.log(`  Resource: ${DIM}${shortUrl}${RESET}`);
    }

    if (feed && lastResult.feed) {
      console.log(`\n${BOLD}Feed Performance:${RESET}`);
      console.log(`  Images loaded: ${lastResult.totalCDNImages} CDN images (${lastResult.totalImages} total)`);

      if (feedStats?.firstImage) {
        console.log(`  1st image ready: ${feedStats.firstImage.avg.toFixed(0)}ms`);
      }
      if (feedStats?.thirdImage) {
        console.log(`  3rd image ready: ${feedStats.thirdImage.avg.toFixed(0)}ms`);
      }
      if (feedStats?.fifthImage) {
        console.log(`  5th image ready: ${feedStats.fifthImage.avg.toFixed(0)}ms`);
      }

      if (lastResult.slowestImages && lastResult.slowestImages.length > 0) {
        console.log(`\n${BOLD}Slowest Images:${RESET}`);
        lastResult.slowestImages.forEach((img, i) => {
          console.log(`  ${i + 1}. ${img.duration}ms (${formatBytes(img.size)})`);
          console.log(`     ${DIM}${img.url}${RESET}`);
        });
      }

      if (lastResult.feed?.images && lastResult.feed.images.length > 0) {
        console.log(`\n${BOLD}Image Load Timeline:${RESET}`);
        lastResult.feed.images.forEach((img, i) => {
          const cached = img.cached ? ' (cached)' : '';
          console.log(`  ${i + 1}. @${img.loadedAt}ms - ${img.duration}ms${cached} (${formatBytes(img.size)})`);
        });
      }
    }

    console.log(`\n${DIM}Thresholds: good ≤${THRESHOLDS.good}ms, poor >${THRESHOLDS.needsImprovement}ms${RESET}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
