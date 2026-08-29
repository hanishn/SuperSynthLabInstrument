/*
 * Recovered SSLI voicing sweep entrypoint.
 *
 * Reconstructed from migrated references. The exact original file was not
 * recovered. This wrapper delegates to the migrated Day 0 audio sweep script:
 * products/ssli/test_engine_surface_capture.js
 */
var childProcess = require('child_process');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PRODUCT_DIR = path.join(ROOT, 'products', 'ssli');
var CAPTURE_SCRIPT = path.join(PRODUCT_DIR, 'test_engine_surface_capture.js');
var RESULTS_DIR = path.join(__dirname, 'results');
var REPORTS_DIR = path.join(__dirname, 'reports');
var RESULTS_JSON = path.join(RESULTS_DIR, 'voicing_sweep.json');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function main() {
  ensureDir(RESULTS_DIR);
  ensureDir(REPORTS_DIR);

  if (!fs.existsSync(CAPTURE_SCRIPT)) {
    console.error('ERROR: missing capture script: ' + CAPTURE_SCRIPT);
    process.exit(1);
  }

var forwardedArgs = process.argv.slice(2);
var outputIdx = forwardedArgs.indexOf('--output');
if (outputIdx !== -1 && outputIdx + 1 < forwardedArgs.length && !path.isAbsolute(forwardedArgs[outputIdx + 1])) {
  forwardedArgs[outputIdx + 1] = path.resolve(ROOT, forwardedArgs[outputIdx + 1]);
}
  var cmd = [
    process.execPath,
    CAPTURE_SCRIPT
  ];
  if (forwardedArgs.indexOf('--output') === -1) {
    cmd.push('--output', RESULTS_JSON);
  }
  cmd = cmd.concat(forwardedArgs);

  console.log('Recovered voicing sweep');
  console.log('Working directory: ' + PRODUCT_DIR);
  console.log('Results: ' + RESULTS_JSON);
  console.log('Running: ' + cmd.join(' '));

  var result = childProcess.spawnSync(cmd[0], cmd.slice(1), {
    cwd: PRODUCT_DIR,
    stdio: 'inherit'
  });

  if (result.error) {
    console.error('ERROR: ' + result.error.message);
    process.exit(1);
  }
  process.exit(result.status || 0);
}

main();
