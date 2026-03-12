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
  lcp https://zora.co/@user --mobile --json
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

  // Inject LCP observer before navigation
  await page.evaluateOnNewDocument(() => {
    window.__LCP_ENTRIES__ = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__LCP_ENTRIES__.push(entry);
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });

  const startTime = Date.now();

  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  } catch (err) {
    await browser.close();
    throw new Error(`Failed to load ${url}: ${err.message}`);
  }

  // Wait for LCP to settle (no user input, so LCP finalizes on load)
  await new Promise(r => setTimeout(r, 1500));

  const lcp = await page.evaluate(() => {
    const entries = window.__LCP_ENTRIES__;
    if (!entries || entries.length === 0) return null;

    const lastEntry = entries[entries.length - 1];
    return {
      time: lastEntry.startTime,
      element: lastEntry.element?.tagName || 'unknown',
      id: lastEntry.element?.id || null,
      className: lastEntry.element?.className || null,
      size: lastEntry.size,
      url: lastEntry.url || null
    };
  });

  const loadTime = Date.now() - startTime;

  await browser.close();

  return {
    ...lcp,
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
      const result = await measureLCP(url, options);
      if (result && result.time) {
        results.push(result);
      }
    } catch (err) {
      if (!options.json) {
        console.error(`\nRun ${i + 1} failed: ${err.message}`);
      }
    }
  }

  if (!options.json && runs > 1) {
    process.stdout.write('\r\x1b[K'); // Clear line
  }

  return results;
}

function calculateStats(results) {
  if (results.length === 0) return null;

  const times = results.map(r => r.time).sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);

  return {
    min: times[0],
    max: times[times.length - 1],
    avg: sum / times.length,
    median: times[Math.floor(times.length / 2)],
    p75: times[Math.floor(times.length * 0.75)] || times[times.length - 1],
    runs: results.length
  };
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const { url, runs, json, mobile } = options;

  if (!json) {
    console.log(`\nMeasuring LCP for ${url}${mobile ? ' (mobile)' : ''}...`);
    if (runs > 1) console.log(`Running ${runs} iterations...\n`);
  }

  const results = await runMultiple(url, runs, { mobile, json });

  if (results.length === 0) {
    if (json) {
      console.log(JSON.stringify({ error: 'No LCP data collected' }));
    } else {
      console.error('Failed to collect LCP data');
    }
    process.exit(1);
  }

  const stats = calculateStats(results);
  const lastResult = results[results.length - 1];
  const rating = getRating(stats.avg);

  if (json) {
    console.log(JSON.stringify({
      url,
      mobile,
      lcp: {
        value: stats.avg,
        rating,
        element: lastResult.element,
        elementId: lastResult.id,
        elementClass: lastResult.className,
        size: lastResult.size,
        resourceUrl: lastResult.url
      },
      stats: runs > 1 ? stats : undefined,
      timestamp: new Date().toISOString()
    }, null, 2));
  } else {
    const color = getColor(rating);

    console.log(`URL: ${url}`);
    console.log(`LCP: ${color}${stats.avg.toFixed(0)}ms${RESET} (${rating})`);

    if (runs > 1) {
      console.log(`\nStats (${stats.runs} runs):`);
      console.log(`  Min:    ${stats.min.toFixed(0)}ms`);
      console.log(`  Max:    ${stats.max.toFixed(0)}ms`);
      console.log(`  Median: ${stats.median.toFixed(0)}ms`);
      console.log(`  p75:    ${stats.p75.toFixed(0)}ms`);
    }

    console.log(`\nLCP Element:`);
    console.log(`  Tag:  <${lastResult.element.toLowerCase()}>`);
    if (lastResult.id) console.log(`  ID:   #${lastResult.id}`);
    if (lastResult.className) console.log(`  Class: .${lastResult.className.split(' ')[0]}`);
    console.log(`  Size: ${lastResult.size.toLocaleString()} px²`);
    if (lastResult.url) console.log(`  Resource: ${lastResult.url}`);

    console.log(`\nThresholds: good ≤${THRESHOLDS.good}ms, poor >${THRESHOLDS.needsImprovement}ms`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
