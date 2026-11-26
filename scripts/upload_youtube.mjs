#!/usr/bin/env node
// Headless YouTube upload for TitrationLab, adapted from the proven handoff recipe:
// copied main-Chrome profile files (Local State + Default/{Cookies,Preferences,
// Secure Preferences,Login Data,Web Data}) into a THROWAWAY dir, --headless=new,
// remote-debugging-port 9336 (never 9333), fetch the mp4 from a local CORS server
// (port 8123), assign to the deep shadow DOM input[type=file], fire change,
// fill title/description via textContent + InputEvent on the #textbox elements,
// answer Not made for kids, Next x3, UNLISTED, Done.
//
//   node upload_youtube.mjs /abs/path/to/demo.mp4
//
// Verifies the signed-in channel id in Studio is UC3-glu9aHHknKhsD5KSwSgg before
// uploading and aborts otherwise. Prints the youtu.be id at the end.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import http from 'node:http';

const VIDEO = resolve(process.argv[2]);
if (!existsSync(VIDEO)) { console.error(`no such file: ${VIDEO}`); process.exit(2); }
const EXPECTED_CHANNEL = 'UC3-glu9aHHknKhsD5KSwSgg';
const TITLE = 'TitrationLab - Offline Acid-Base Titration Workbench';
const DESC = [
  'TitrationLab is an offline acid-base titration workbench that solves charge balance by bisection at every titrant volume.',
  '',
  'Live site: https://aariv.me/titrationlab/',
  'Source: https://github.com/draarivpatel-ui/titrationlab',
  '',
  'Modeled educational simulation only, not instrument-grade measurement.',
  'AI coding assistants were used during development, and local voice synthesis was used for the narration.',
].join('\n');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Source of the copied Google session. Override with YT_SESSION_SRC.
// Default: the main Chrome profile's Default dir (holds the Google auth cookies).
// Never launch against the live profile itself, never port 9333.
const SRC = process.env.YT_SESSION_SRC || join(process.env.HOME, 'Library/Application Support/Google/Chrome');
const SRC_DEFAULT = join(SRC, 'Default');
const PORT = 9336, FILE_PORT = 8123;

// ---- CORS file server on 8123 -------------------------------------------
const srv = http.createServer((req, res) => {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'video/mp4',
  });
  createReadStream(VIDEO).pipe(res);
});
await new Promise((r) => srv.listen(FILE_PORT, '127.0.0.1', r));

// ---- throwaway profile copied from the signed-in main profile ------------
const profile = mkdtempSync(join(tmpdir(), 'titrationlab-yt-profile-'));
mkdirSync(join(profile, 'Default'), { recursive: true });
try { copyFileSync(join(SRC, 'Local State'), join(profile, 'Local State')); } catch { console.error('warn: no Local State copied'); }
for (const f of ['Cookies', 'Preferences', 'Secure Preferences', 'Login Data', 'Web Data']) {
  try { copyFileSync(join(SRC_DEFAULT, f), join(profile, 'Default', f)); }
  catch (e) { console.error(`warn: could not copy ${f}: ${e.message}`); }
}

const chrome = spawn(CHROME, [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

async function shutdown(code) {
  if (chrome.exitCode === null) {
    const gone = new Promise((r) => chrome.once('exit', r));
    chrome.kill('SIGTERM');
    await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  srv.close();
  rmSync(profile, { recursive: true, force: true });
  process.exit(code);
}
process.on('unhandledRejection', (e) => { console.error(e); shutdown(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(200);
  try { ({ webSocketDebuggerUrl: wsUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()); } catch {}
}
if (!wsUrl) { console.error('Chrome did not start'); await shutdown(1); }

const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++msgId;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const listeners = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(`${m.error.message}`)) : p.res(m.result);
  } else if (m.method) listeners.forEach((l) => l(m));
};
await new Promise((r, x) => { ws.onopen = r; ws.onerror = x; });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sid);
await page('Page.enable');
await page('Runtime.enable');

const js = async (expression, awaitPromise = true) => {
  const r = await page('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
};

const deepFind = `(() => {
  const q = (root, sel) => {
    const hit = root.querySelector(sel);
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) { const r2 = q(el.shadowRoot, sel); if (r2) return r2; }
    }
    return null;
  };
  window.__q = (sel) => q(document, sel);
  window.__wait = (sel, ms = 30000) => new Promise((done, fail) => {
    const t0 = Date.now();
    (function f() { const e = window.__q(sel); if (e) return done(e);
      if (Date.now() - t0 > ms) return fail(new Error('timeout waiting for ' + sel));
      setTimeout(f, 300); })();
  });
  return 'helpers installed';
})()`;

// ---- 1. verify channel in Studio -----------------------------------------
await page('Page.navigate', { url: 'https://studio.youtube.com/' });
await sleep(6000);
await js(deepFind, false);
// Studio is a Polymer app: the channel id lands in the URL (/channel/UC.../...)
// and the DOM only after XHR. Poll up to 45 s.
const chanOk = await js(`(async () => {
  const want = '${EXPECTED_CHANNEL}';
  for (let i = 0; i < 90; i++) {
    const ids = [...new Set([...(location.href.match(/UC[A-Za-z0-9_-]{22}/g) || []),
      ...(document.documentElement.innerHTML.match(/UC[A-Za-z0-9_-]{22}/g) || [])])];
    if (ids.includes(want)) return { ok: true, ids: ids.slice(0, 6), url: location.href };
    await new Promise(r => setTimeout(r, 500));
  }
  return { ok: false, ids: [], url: location.href, title: document.title,
    body: document.body ? document.body.innerText.slice(0, 400) : null };
})()`);
console.log('studio channel check:', JSON.stringify(chanOk).slice(0, 600));
if (!chanOk.ok) { console.error(`ABORT: expected channel ${EXPECTED_CHANNEL} not confirmed in Studio`); await shutdown(3); }

// ---- 2. upload ------------------------------------------------------------
await page('Page.navigate', { url: 'https://www.youtube.com/upload' });
await sleep(6000);
await js(deepFind, false);
const inputOk = await js(`(async () => {
  const input = await window.__wait('input[type=file]');
  const b = await (await fetch('http://127.0.0.1:${FILE_PORT}/demo.mp4')).blob();
  const file = new File([b], 'demo.mp4', { type: 'video/mp4' });
  const dt = new DataTransfer(); dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'file assigned, size ' + b.size;
})()`);
console.log(inputOk);
await sleep(8000);

// Title + description (two-way bound textareas; textContent + InputEvent).
await js(`(async () => {
  const t = await window.__wait('#title-textarea #textbox', 60000);
  t.focus(); t.textContent = ${JSON.stringify(TITLE)};
  t.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return 'title set';
})()`);
await sleep(1500);
await js(`(async () => {
  const d = await window.__wait('#description-textarea #textbox', 60000);
  d.focus(); d.textContent = ${JSON.stringify(DESC)};
  d.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return 'description set';
})()`);
await sleep(1500);

// Not made for kids
await js(`(async () => {
  const r = await window.__wait('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]', 60000);
  r.click(); return 'not made for kids selected';
})()`);
await sleep(1500);
await js(`(async () => { const n = await window.__wait('#next-button', 60000); n.click(); return 'next 1'; })()`);
await sleep(2500);
await js(`(async () => { const n = await window.__wait('#next-button', 60000); n.click(); return 'next 2'; })()`);
await sleep(2500);
await js(`(async () => { const n = await window.__wait('#next-button', 60000); n.click(); return 'next 3'; })()`);
await sleep(2500);

// Visibility: UNLISTED
await js(`(async () => {
  const r = await window.__wait('tp-yt-paper-radio-button[name="VIDEO_PRIVACY_UNLISTED"]', 120000);
  r.click(); return 'unlisted selected';
})()`);
await sleep(2000);

// Wait for the Done button to be enabled, then click it.
const done = await js(`(async () => {
  const b = await window.__wait('#done-button', 120000);
  for (let i = 0; i < 60; i++) { if (b.getAttribute('aria-disabled') !== 'true') break; await new Promise(r2 => setTimeout(r2, 1000)); }
  if (b.getAttribute('aria-disabled') === 'true') { b.click(); return 'done force-clicked while disabled'; }
  b.click(); return 'done clicked';
})()`);
console.log(done);
await sleep(6000);

// Grab the youtu.be link from the dialog, then fall back to Studio.
let videoId = null;
try {
  videoId = await js(`(() => {
    const a = [...document.querySelectorAll('a')].map(a => a.href).find(h => h && h.includes('youtu.be/'));
    if (a) return a.split('youtu.be/')[1].split(/[?/]/)[0];
    const m = document.documentElement.innerHTML.match(/youtu\\.be\\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  })()`, false);
} catch {}
if (!videoId) {
  await page('Page.navigate', { url: 'https://studio.youtube.com/' });
  await sleep(8000);
  videoId = await js(`(() => {
    const m = document.documentElement.innerHTML.match(/(?:youtu\\.be\\/|"videoId":")([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  })()`, false);
}
console.log(`VIDEO_ID ${videoId || 'NOT_FOUND'}`);
await shutdown(videoId ? 0 : 4);
