/* Recovered minimal SSLI test harness. ES5 only. */
var path = require('path');
var fs = require('fs');
var playwright = require(path.join(__dirname, '..', 'products', 'ssli', 'node_modules', 'playwright'));

var ROOT = path.resolve(__dirname, '..');
var PRODUCT_DIR = path.join(ROOT, 'products', 'ssli');
var DEFAULT_HTML = path.join(PRODUCT_DIR, 'export', 'SuperSynthLabInstrument.html');
var state = { name: '', assertions: 0, failures: [], started: Date.now() };

function initTest(name) {
  state.name = name;
  state.assertions = 0;
  state.failures = [];
  state.started = Date.now();
}

function assertPass(name, condition, detail) {
  state.assertions += 1;
  if (!condition) {
    state.failures.push(name + ': ' + detail);
  }
}

function launchPage(opts) {
  opts = opts || {};
  var htmlPath = opts.htmlPath || DEFAULT_HTML;
  var viewport = opts.viewport || { width: 1280, height: 720 };
  var browser;
  return playwright.chromium.launch().then(function(b) {
    browser = b;
    return browser.newContext({ viewport: viewport });
  }).then(function(context) {
    return context.newPage();
  }).then(function(page) {
    var url = 'file:///' + path.resolve(htmlPath).replace(/\\/g, '/');
    return page.goto(url, { waitUntil: 'networkidle' }).then(function() {
      return page.waitForTimeout(500);
    }).then(function() {
      return { browser: browser, page: page, htmlPath: htmlPath };
    });
  });
}

function closeBrowser(browser) {
  if (browser) {
    return browser.close();
  }
  return Promise.resolve();
}

function reportResults() {
  var result = {
    name: state.name,
    pass: state.failures.length === 0,
    assertions: state.assertions,
    failures: state.failures,
    duration_ms: Date.now() - state.started
  };
  console.log(JSON.stringify(result));
  return result.pass ? 0 : 1;
}

module.exports = {
  ROOT: ROOT,
  PRODUCT_DIR: PRODUCT_DIR,
  DEFAULT_HTML: DEFAULT_HTML,
  fs: fs,
  initTest: initTest,
  assertPass: assertPass,
  launchPage: launchPage,
  closeBrowser: closeBrowser,
  reportResults: reportResults
};
