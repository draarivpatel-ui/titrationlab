#!/usr/bin/env node
// Browser-level CDP checks for the real rendered page. No dependencies.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = normalize(join(root, pathname));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;

const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chromePath)) {
  console.error(`Chrome not found at ${chromePath}`);
  process.exit(2);
}
const profile = mkdtempSync(join(tmpdir(), 'titrationlab-checks-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function shutdown(code) {
  try { server.close(); } catch {}
  if (chrome.exitCode === null) {
    const exited = new Promise((resolveExit) => chrome.once('exit', resolveExit));
    chrome.kill('SIGTERM');
    await Promise.race([exited, sleep(2500)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(profile, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 7) console.error(`warning: could not remove temporary Chrome profile: ${error.message}`);
      else await sleep(400);
    }
  }
  process.exit(code);
}
process.on('unhandledRejection', async (error) => { console.error(error); await shutdown(1); });

let cdpPort = null;
for (let i = 0; i < 100 && !cdpPort; i++) {
  await sleep(100);
  const activePort = join(profile, 'DevToolsActivePort');
  if (existsSync(activePort)) cdpPort = readFileSync(activePort, 'utf8').split('\n')[0].trim();
}
if (!cdpPort) {
  console.error('headless Chrome did not expose CDP');
  await shutdown(1);
}

const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => { ws.onopen = resolveOpen; ws.onerror = rejectOpen; });

let nextId = 0;
const pending = new Map();
const consoleErrors = [];
const uncaughtExceptions = [];
const send = (method, params = {}, sessionId) => new Promise((resolveSend, rejectSend) => {
  const id = ++nextId;
  pending.set(id, { resolveSend, rejectSend });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callbacks.rejectSend(new Error(message.error.message));
    else callbacks.resolveSend(message.result);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push((message.params.args || []).map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    uncaughtExceptions.push(details.exception?.description || details.text || 'uncaught exception');
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    consoleErrors.push(`${message.params.entry.source}: ${message.params.entry.text}`);
  }
};

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params = {}) => send(method, params, sessionId);
await page('Page.enable');
await page('Runtime.enable');
await page('Log.enable');
await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

async function evaluate(expression) {
  const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

let total = 0;
let failed = 0;
function reportChecks(checks, phase) {
  for (const item of checks) {
    total += 1;
    if (item.pass) {
      console.log(`ok ${total} - ${phase}: ${item.name}`);
    } else {
      failed += 1;
      console.log(`not ok ${total} - ${phase}: ${item.name}${item.detail ? ` (${item.detail})` : ''}`);
    }
  }
}

await page('Page.navigate', { url: `http://127.0.0.1:${port}/` });
await sleep(1200);
await evaluate('document.fonts.ready');

reportChecks(await evaluate(`(() => {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail: detail || '' });
  const text = (selector) => (document.querySelector(selector)?.textContent || '').trim();
  const rows = [...document.querySelectorAll('#meter-body tr')];
  const canvas = document.querySelector('#titration-chart');
  const presetValues = [...document.querySelectorAll('#preset-select option')].map((option) => option.value);

  check('preset scenarios loaded', presetValues.join('|') === 'strong|acetic|dilute|manual', presetValues.join('|'));
  check('strong preset selected on load', document.querySelector('#preset-select').value === 'strong', document.querySelector('#preset-select').value);
  check(
    'strong solve readouts rendered',
    text('#eq-volume') === '50.00 mL' && text('#eq-ph') === '7.0000' && text('#initial-ph') === '1.0000' && text('#final-ph') === '12.3010',
    [text('#eq-volume'), text('#eq-ph'), text('#initial-ph'), text('#final-ph')].join(' | '),
  );
  check(
    'canvas chart rendered with accessible solve summary',
    canvas.width >= 320 && canvas.height >= 280 && (canvas.getAttribute('aria-label') || '').includes('equivalence at 50.00 mL'),
    canvas.width + 'x' + canvas.height + ' ' + (canvas.getAttribute('aria-label') || ''),
  );
  check('meter table populates seven rows', rows.length === 7, String(rows.length));
  check(
    'meter exact and rounded columns populate',
    rows[0]?.cells.length === 4 && rows[4]?.cells[0].textContent.trim() === 'equivalence' && rows[4]?.cells[3].textContent.trim().split('.')[1]?.length === 2,
    rows[4] ? [...rows[4].cells].map((cell) => cell.textContent.trim()).join(' | ') : 'missing equivalence row',
  );
  check(
    'strong-benchmark indicator recommendation appears',
    text('#indicator-recommendation').includes('Bromothymol blue') && text('#indicator-recommendation').includes('contains equivalence pH'),
    text('#indicator-recommendation'),
  );
  check(
    'validity assumptions populate',
    document.querySelectorAll('#flags-list li').length >= 5 && document.querySelector('#flags-list').textContent.includes('not instrument-grade'),
    String(document.querySelectorAll('#flags-list li').length),
  );
  check(
    'scrubbed point starts at zero volume and solved initial pH',
    document.querySelector('#scrub-output').value === '0.000 mL' && text('#point-ph') === '1.0000',
    document.querySelector('#scrub-output').value + ' | ' + text('#point-ph'),
  );
  return checks;
})()`), 'initial strong preset');

await evaluate(`(() => {
  const select = document.querySelector('#preset-select');
  select.value = 'acetic';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(250);

reportChecks(await evaluate(`(() => {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail: detail || '' });
  const text = (selector) => (document.querySelector(selector)?.textContent || '').trim();
  const rows = [...document.querySelectorAll('#meter-body tr')];

  check('acetic preset selected', document.querySelector('#preset-select').value === 'acetic', document.querySelector('#preset-select').value);
  check(
    'weak-acid mode activated',
    document.querySelector('input[name="acid-type"][value="weak"]').checked && !document.querySelector('#ka-field').hidden,
    'hidden=' + document.querySelector('#ka-field').hidden,
  );
  check(
    'weak solve readouts rendered',
    text('#eq-volume') === '50.00 mL' && text('#eq-ph') === '8.7219' && text('#initial-ph') === '2.8753',
    [text('#eq-volume'), text('#eq-ph'), text('#initial-ph')].join(' | '),
  );
  check(
    'buffer and pKa readouts rendered',
    text('#pka-value') === '4.7447' && text('#buffer-value') === '4.545 mL to 45.45 mL',
    text('#pka-value') + ' | ' + text('#buffer-value'),
  );
  check(
    'phenolphthalein recommendation appears',
    text('#indicator-recommendation').includes('Phenolphthalein') && text('#indicator-recommendation').includes('contains equivalence pH'),
    text('#indicator-recommendation'),
  );
  check(
    'weak meter row exposes exact model pH and meter rounding',
    rows[4]?.cells[2].textContent.trim() === '8.72190' && rows[4]?.cells[3].textContent.trim() === '8.72',
    rows[4] ? [...rows[4].cells].map((cell) => cell.textContent.trim()).join(' | ') : 'missing equivalence row',
  );
  return checks;
})()`), 'acetic preset');

await evaluate(`(() => {
  const scrub = document.querySelector('#scrub-input');
  scrub.value = '500';
  scrub.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

reportChecks(await evaluate(`(() => {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail: detail || '' });
  const text = (selector) => (document.querySelector(selector)?.textContent || '').trim();
  check(
    'scrub slider updates inspected volume and point pH',
    document.querySelector('#scrub-output').value === '37.50 mL' && text('#point-ph').split('.')[1]?.length === 4,
    document.querySelector('#scrub-output').value + ' | ' + text('#point-ph'),
  );
  return checks;
})()`), 'inspection scrubber');

await evaluate(`(() => {
  const input = document.querySelector('#acid-concentration');
  input.value = '0';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

reportChecks(await evaluate(`(() => {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail: detail || '' });
  const error = document.querySelector('#input-error');
  const text = (selector) => (document.querySelector(selector)?.textContent || '').trim();
  check(
    'zero acid concentration shows the specific validation message',
    error.textContent.trim() === 'analyteConcentration must be between 0.000001 and 2 M',
    error.textContent.trim(),
  );
  check(
    'validation alert is visible while the prior valid readout remains intact',
    !error.hidden && error.getAttribute('role') === 'alert' && text('#eq-ph') === '8.7219',
    'hidden=' + error.hidden + ' role=' + error.getAttribute('role') + ' eqPh=' + text('#eq-ph'),
  );
  return checks;
})()`), 'invalid input');

await evaluate(`(() => {
  const input = document.querySelector('#acid-concentration');
  input.value = '0.1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

reportChecks(await evaluate(`(() => {
  const error = document.querySelector('#input-error');
  return [{
    name: 'valid recovery clears the input error',
    pass: error.hidden && error.textContent.trim() === '',
    detail: 'hidden=' + error.hidden + ' text=' + error.textContent.trim(),
  }];
})()`), 'input recovery');

total += 1;
if (consoleErrors.length === 0 && uncaughtExceptions.length === 0) {
  console.log(`ok ${total} - browser hygiene: no console errors or uncaught exceptions`);
} else {
  failed += 1;
  console.error(`not ok ${total} - browser hygiene: consoleErrors=${JSON.stringify(consoleErrors)} uncaughtExceptions=${JSON.stringify(uncaughtExceptions)}`);
}

console.log(`browser checks: ${total - failed}/${total} passed`);
try { ws.close(); } catch {}
await shutdown(failed === 0 ? 0 : 1);
