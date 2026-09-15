// Small CDP bridge for observing an already-running Chrome; Node 22+, no packages.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const endpoint = process.env.AUTOBRICKS_CDP || 'http://127.0.0.1:9444';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(route, options = {}) {
  const response = await fetch(`${endpoint}${route}`, {...options, signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}: ${route}`);
  return response.json();
}

export async function connect(target) {
  const targets = await request('/json/list');
  const info = targets.find(t => t.id === target);
  if (!info) throw new Error(`No target ${target}`);
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('CDP connection timeout')); ws.close(); }, 10000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection failed')); };
  });
  let next = 0;
  const pending = new Map();
  const loaded = new Set();
  const failPending = error => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    pending.clear();
  };
  ws.onclose = () => failPending(new Error(`CDP disconnected: ${target}`));
  ws.onerror = () => failPending(new Error(`CDP connection failed: ${target}`));
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Page.lifecycleEvent' && message.params.name === 'load') {
      loaded.add(`${message.params.frameId}:${message.params.loaderId}`);
    }
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(Object.assign(new Error(message.error.message), {cdpCode: message.error.code}));
    else waiter.resolve(message.result);
  };
  const send = (method, params = {}, timeout = 35000) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error(`CDP disconnected: ${target}`)); return; }
    const id = ++next;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`${method} timed out after ${timeout}ms`), {code: 'CDP_TIMEOUT'}));
    }, timeout);
    pending.set(id, {resolve, reject, timer});
    try { ws.send(JSON.stringify({id, method, params})); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  const evaluate = async (expression, timeout) => {
    const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, timeout);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return {
    send, evaluate, hasLoaded: (frame, loader) => loaded.has(`${frame}:${loader}`),
    close: () => { failPending(new Error('CDP client closed')); ws.close(); }
  };
}

export async function waitUntil(probe, timeout = 15000, label = 'page condition') {
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483647) {
    throw new Error('Timeout must be a positive number of milliseconds, at most 2147483647');
  }
  const started = performance.now();
  let last = 'not checked';
  let detail = '';
  while (performance.now() - started < timeout) {
    const remaining = Math.max(1, Math.ceil(timeout - (performance.now() - started)));
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => probe(remaining)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('Deadline reached'), {code: 'CDP_TIMEOUT'})), remaining);
        })
      ]);
      if (value === true) return {ready: true, elapsedMs: Math.round(performance.now() - started)};
      last = JSON.stringify(value) ?? String(value);
    } catch (error) {
      if (error.code === 'CDP_TIMEOUT') { detail = `; ${error.message}`; break; }
      // Only retry protocol errors caused by navigation, never arbitrary page exceptions or actions.
      const navigationError = /Execution context was destroyed|Cannot find context with specified id|Inspected target navigated or closed/i;
      if (error.cdpCode !== -32000 || !navigationError.test(error.message)) {
        throw error;
      }
      last = error.message;
    } finally { clearTimeout(timer); }
    await delay(Math.min(100, Math.max(0, timeout - (performance.now() - started))));
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${label}; last result: ${last.slice(0, 300)}${detail}`);
}

export function waitFor(client, expression, timeout = 15000, label = 'page condition') {
  return waitUntil(remaining => client.evaluate(expression, remaining), timeout, label);
}

async function save(file, data) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, data);
}

async function screenshot(client, file) {
  const shot = await client.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
  await save(file, Buffer.from(shot.data, 'base64'));
}

async function main() {
  const [command, targetArg, arg, ...rest] = process.argv.slice(2);
  let target = targetArg;
  if (command === 'list') {
    console.log(JSON.stringify(await request('/json/list'), null, 2));
    return;
  }
  if (command === 'open') {
    target = (await request('/json/new?about:blank', {method: 'PUT'})).id;
  }
  const client = await connect(target);
  try {
    await client.send('Page.enable');
    await client.send('Page.bringToFront');
    if (command === 'open') {
      await client.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
      await client.send('Page.setLifecycleEventsEnabled', {enabled: true});
      const result = await client.send('Page.navigate', {url: targetArg});
      if (result.errorText) throw new Error(result.errorText);
      if (result.isDownload) throw new Error(`Navigation started a download instead of a page: ${targetArg}`);
      if (result.loaderId) {
        await waitUntil(() => client.hasLoaded(result.frameId, result.loaderId), 30000, `document load (${target})`);
      }
      await waitFor(client, 'document.readyState === "complete" && document.fonts.status === "loaded"', 15000, `document and fonts (${target})`);
      const meta = await client.evaluate('({url:location.href,title:document.title,width:innerWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight,text:document.body.innerText.slice(0,14000)})');
      await save(path.join(arg, 'browser.json'), JSON.stringify({target, ...meta}, null, 2));
      await screenshot(client, path.join(arg, 'first.png'));
      console.log(JSON.stringify({target, ...meta,text:meta.text.slice(0,900)}, null, 2));
    } else if (command === 'eval') {
      const value = await client.evaluate(await fs.readFile(arg, 'utf8'));
      if (rest[0]) { await save(rest[0], JSON.stringify(value, null, 2)); console.log(`Saved ${rest[0]}`); }
      else console.log(JSON.stringify(value, null, 2));
    } else if (command === 'wait') {
      const result = await waitFor(client, await fs.readFile(arg, 'utf8'), rest[0] === undefined ? 15000 : Number(rest[0]), arg);
      console.log(JSON.stringify({target, ...result}, null, 2));
    } else if (command === 'shot') {
      if (rest[1]) await client.send('Emulation.setDeviceMetricsOverride', {width: Number(rest[1]), height: 1000, deviceScaleFactor: 1, mobile: false});
      if (rest[0] !== undefined) await client.evaluate(`document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,${Number(rest[0])});true`);
      await new Promise(r => setTimeout(r, 600));
      await screenshot(client, arg);
      console.log(`Saved ${arg}`);
    } else if (command === 'survey') {
      const reports=[];
      for(const width of (rest[0] ? rest[0].split(',').map(Number) : [1440,768,390])) {
        await client.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
        await client.evaluate(`(()=>{document.documentElement.style.scrollBehavior='auto';document.querySelectorAll('details[open]').forEach(e=>e.open=false);const root=document.querySelector('header').parentElement;root.parentElement===document.querySelector('#app')&&document.querySelector('#app > .pointer-events-none')?.style.setProperty('visibility','hidden');document.querySelectorAll('#app > .pointer-events-none').forEach(e=>e.style.visibility='hidden');window.scrollTo(0,0);})()`);
        await new Promise(r=>setTimeout(r,400));
        const report=await client.evaluate(`(()=>{const root=document.querySelector('header').parentElement;const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y+scrollY,w:r.width,h:r.height}};return {width:innerWidth,pageHeight:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth-innerWidth,text:root.textContent,regions:[...root.querySelectorAll('header,section,footer')].map(e=>({tag:e.tagName,title:e.querySelector('h1,h2')?.textContent||e.textContent.slice(0,45),...rect(e)})),headings:[...root.querySelectorAll('h1,h2,h3,h4')].map(e=>({text:e.textContent,...rect(e),font:getComputedStyle(e).fontSize})),images:[...root.querySelectorAll('img')].map(e=>({alt:e.alt,loaded:e.complete&&e.naturalWidth>0,...rect(e)})),links:[...root.querySelectorAll('a')].map(e=>({text:e.textContent,href:e.getAttribute('href')}))}})()`);
        reports.push(report);
        for(let i=0;i<report.regions.length;i++) {
          const y=Math.max(0,report.regions[i].y);
          await client.evaluate(`window.scrollTo(0,${y});true`);
          await new Promise(r=>setTimeout(r,150));
          await screenshot(client,path.join(arg,`${width}-${String(i).padStart(2,'0')}.png`));
        }
      }
      await save(path.join(arg,'survey.json'),JSON.stringify(reports,null,2));
      console.log(JSON.stringify(reports.map(r=>({width:r.width,height:r.pageHeight,overflow:r.overflow,regions:r.regions.length,images:r.images.length,broken:r.images.filter(i=>!i.loaded).length})),null,2));
    } else if (command === 'click' || command === 'hover') {
      const pos = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(arg)});if(!e)throw Error('selector missing');e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await client.send('Input.dispatchMouseEvent', {type:'mouseMoved',...pos});
      if(command==='click') {
        await client.send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...pos});
        await client.send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...pos});
      }
      console.log(JSON.stringify({command,selector:arg,...pos,dispatched:true}));
    } else if (command === 'cdp') {
      const requests = JSON.parse(await fs.readFile(arg, 'utf8'));
      if (!Array.isArray(requests) || !requests.every(req => req && typeof req.method === 'string')) {
        throw new Error('CDP requests must be a JSON array of {method, params?} objects');
      }
      const results = [];
      for (const req of requests) results.push(await client.send(req.method, req.params || {}));
      console.log(JSON.stringify(results, null, 2));
    } else throw new Error('Usage: browser.mjs open URL DIR | eval TARGET FILE [OUTPUT] | wait TARGET FILE [TIMEOUT_MS] | shot TARGET PNG [Y] [WIDTH] | click TARGET SELECTOR | hover TARGET SELECTOR | survey TARGET DIR [WIDTHS] | cdp TARGET REQUESTS.json | list');
  } finally { client.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
