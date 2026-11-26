#!/usr/bin/env node
// Capture three real 1440x900 TitrationLab PNGs in a throwaway headless-Chrome profile.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize, resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'assets');
mkdirSync(outDir, { recursive: true });

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
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'titrationlab-shots-'));
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
if (!cdpPort) { console.error('headless Chrome did not expose CDP'); await shutdown(1); }

const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => { ws.onopen = resolveOpen; ws.onerror = rejectOpen; });

let nextId = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => new Promise((resolveSend, rejectSend) => {
  const id = ++nextId;
  pending.set(id, { resolveSend, rejectSend });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const callbacks = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) callbacks.rejectSend(new Error(message.error.message));
  else callbacks.resolveSend(message.result);
};

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params = {}) => send(method, params, sessionId);
await page('Page.enable');
await page('Runtime.enable');
await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

async function evaluate(expression) {
  const result = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function capture(name) {
  const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(file);
}

await page('Page.navigate', { url: `http://127.0.0.1:${port}/` });
await sleep(1800);
await evaluate('document.fonts.ready');
await capture('titrationlab-strong-1440x900.png');

await evaluate(`(() => {
  const select = document.querySelector('#preset-select');
  select.value = 'acetic';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const scrub = document.querySelector('#scrub-input');
  scrub.value = '520';
  scrub.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(700);
await capture('titrationlab-weak-1440x900.png');

await evaluate(`document.querySelector('.meter').scrollIntoView({ block: 'start' })`);
await sleep(700);
await capture('titrationlab-meter-1440x900.png');

try { ws.close(); } catch {}
await shutdown(0);
