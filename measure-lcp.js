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

  try {
    // Wait for network to be mostly idle
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch (err) {
    await browser.close();
    throw new Error(`Failed to load ${url}: ${err.message}`);
  }

  // Poll for first CDN image in Resource Timing
  const pollStart = Date.now();
  let result = null;

  while (Date.now() - pollStart < TIMEOUT) {
    result = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource');

      // Find first choicecdn.com image (sorted by responseEnd)
      const cdnImages = entries
        .filter(e => e.initiatorType === 'img' && e.name.includes('choicecdn.com'))
        .sort((a, b) => a.responseEnd - b.responseEnd);

      if (cdnImages.length > 0) {
        const first = cdnImages[0];
        return {
          time: Math.round(first.responseEnd),
          duration: Math.round(first.duration),
          size: first.encodedBodySize,
          cached: first.transferSize === 0,
          src: first.name
        };
      }
      return null;
    });

    if (result) break;
    await new Promise(r => setTimeout(r, 200));
  }

  await browser.close();

  if (!result) {
    throw new Error('No CDN images found in Resource Timing');
  }

  return {
    ...result,
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
      console.error('Failed to detect feed images');
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
