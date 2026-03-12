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

function getRating(time) {
  if (time <= THRESHOLDS.good) return 'good';
  if (time <= THRESHOLDS.needsImprovement) return 'needs-improvement';
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

const TIMEOUT = 30000;

async function measureFeedImage(url, options = {}) {
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

  // Track when the first priority feed image loads
  await page.evaluateOnNewDocument(() => {
    window.__FEED_PERF__ = {
      navigationStart: performance.now(),
      firstFeedImage: null,
      imageLoadTimes: []
    };

    // Watch for the first priority image (the feed's first image)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Look for priority images (first feed item)
            const imgs = node.tagName === 'IMG' ? [node] : node.querySelectorAll?.('img') || [];
            for (const img of imgs) {
              const src = img.src || '';
              const isPriority = img.fetchPriority === 'high' || img.loading === 'eager';
              const isCDN = src.includes('choicecdn.com') ||
                           src.includes('decentralized-content.com') ||
                           src.includes('ipfs');

              if (isPriority && isCDN && !window.__FEED_PERF__.firstFeedImage) {
                const startTime = performance.now();

                if (img.complete) {
                  window.__FEED_PERF__.firstFeedImage = {
                    loadedAt: startTime,
                    src: src,
                    wasComplete: true
                  };
                } else {
                  img.addEventListener('load', () => {
                    if (!window.__FEED_PERF__.firstFeedImage) {
                      window.__FEED_PERF__.firstFeedImage = {
                        loadedAt: performance.now(),
                        src: src,
                        wasComplete: false
                      };
                    }
                  }, { once: true });

                  img.addEventListener('error', () => {
                    window.__FEED_PERF__.imageLoadTimes.push({
                      src: src,
                      error: true,
                      time: performance.now()
                    });
                  }, { once: true });
                }
              }
            }
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });

  const startTime = Date.now();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    await browser.close();
    throw new Error(`Failed to load ${url}: ${err.message}`);
  }

  // Wait for first feed image to load
  const pollStart = Date.now();
  let result = null;

  while (Date.now() - pollStart < TIMEOUT) {
    result = await page.evaluate(() => {
      const perf = window.__FEED_PERF__;
      if (perf.firstFeedImage) {
        return {
          time: Math.round(perf.firstFeedImage.loadedAt),
          src: perf.firstFeedImage.src,
          wasAlreadyComplete: perf.firstFeedImage.wasComplete
        };
      }
      return null;
    });

    if (result) break;
    await new Promise(r => setTimeout(r, 100));
  }

  // Also get Resource Timing data for the image
  let resourceTiming = null;
  if (result?.src) {
    resourceTiming = await page.evaluate((imgSrc) => {
      const entries = performance.getEntriesByType('resource');
      const entry = entries.find(e => e.name === imgSrc);
      if (entry) {
        return {
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize,
          encodedSize: entry.encodedBodySize,
          cached: entry.transferSize === 0
        };
      }
      return null;
    }, result.src);
  }

  const loadTime = Date.now() - startTime;

  await browser.close();

  if (!result) {
    throw new Error('Timed out waiting for first feed image');
  }

  return {
    time: result.time,
    src: result.src,
    duration: resourceTiming?.duration || null,
    size: resourceTiming?.encodedSize || null,
    cached: resourceTiming?.cached || false,
    loadTime,
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
      const result = await measureFeedImage(url, options);
      results.push(result);
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
    console.log(`\nMeasuring first feed image for ${url}${mobile ? ' (mobile)' : ''}...`);
    if (runs > 1) console.log(`Running ${runs} iterations...\n`);
  }

  const results = await runMultiple(url, runs, options);

  if (results.length === 0) {
    if (json) {
      console.log(JSON.stringify({ error: 'No feed images detected' }));
    } else {
      console.error('Failed to detect feed images (no priority images with CDN src found)');
    }
    process.exit(1);
  }

  const timeStats = calculateStats(results.map(r => r.time));
  const durationStats = calculateStats(results.map(r => r.duration).filter(Boolean));
  const lastResult = results[results.length - 1];
  const rating = getRating(timeStats.avg);

  if (json) {
    console.log(JSON.stringify({
      url,
      mobile,
      firstFeedImage: {
        time: timeStats.avg,
        downloadDuration: durationStats?.avg || null,
        rating,
        size: lastResult.size,
        cached: lastResult.cached,
        url: lastResult.src
      },
      stats: runs > 1 ? {
        time: timeStats,
        duration: durationStats
      } : undefined,
      timestamp: new Date().toISOString()
    }, null, 2));
  } else {
    const color = getColor(rating);

    console.log(`\n${BOLD}URL:${RESET} ${url}`);
    console.log(`${BOLD}First Feed Image:${RESET} ${color}${timeStats.avg.toFixed(0)}ms${RESET} (${rating})`);

    if (durationStats) {
      console.log(`${BOLD}Download Time:${RESET} ${durationStats.avg.toFixed(0)}ms`);
    }
    console.log(`${BOLD}Size:${RESET} ${formatBytes(lastResult.size)}${lastResult.cached ? ' (cached)' : ''}`);

    if (runs > 1) {
      console.log(`\n${BOLD}Stats (${results.length} runs):${RESET}`);
      console.log(`  Load Time: Min ${timeStats.min.toFixed(0)}ms | Max ${timeStats.max.toFixed(0)}ms | Median ${timeStats.median.toFixed(0)}ms`);
      if (durationStats) {
        console.log(`  Download:  Min ${durationStats.min.toFixed(0)}ms | Max ${durationStats.max.toFixed(0)}ms | Median ${durationStats.median.toFixed(0)}ms`);
      }
    }

    const shortUrl = lastResult.src.length > 70
      ? '...' + lastResult.src.slice(-67)
      : lastResult.src;
    console.log(`\n${BOLD}Image:${RESET}`);
    console.log(`  ${DIM}${shortUrl}${RESET}`);

    console.log(`\n${DIM}Thresholds: good ≤${THRESHOLDS.good}ms, poor >${THRESHOLDS.needsImprovement}ms${RESET}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
