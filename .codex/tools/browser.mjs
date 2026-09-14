// Small CDP bridge for observing an already-running Chrome; Node 22+, no packages.
import fs from 'node:fs/promises';
import path from 'node:path';

const endpoint = process.env.AUTOBRICKS_CDP || 'http://127.0.0.1:9444';
const [command, targetArg, arg, ...rest] = process.argv.slice(2);

async function connect(target) {
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const info = targets.find(t => t.id === target);
  if (!info) throw new Error(`No target ${target}`);
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  };
  const send = (method, params = {}, timeout = 35000) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, timeout);
    pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return {send, evaluate, close: () => ws.close()};
}

async function save(file, data) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, data);
}

async function screenshot(client, file) {
  const shot = await client.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
  await save(file, Buffer.from(shot.data, 'base64'));
}

let target = targetArg;
if (command === 'list') {
  console.log(JSON.stringify(await (await fetch(`${endpoint}/json/list`)).json(), null, 2));
  process.exit(0);
}
if (command === 'open') {
  target = (await (await fetch(`${endpoint}/json/new?about:blank`, {method: 'PUT'})).json()).id;
}
const client = await connect(target);
try {
  await client.send('Page.enable');
  await client.send('Page.bringToFront');
  if (command === 'open') {
    await client.send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
    const result = await client.send('Page.navigate', {url: targetArg});
    if (result.errorText) throw new Error(result.errorText);
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (await client.evaluate('document.readyState === "complete"')) break;
    }
    await client.evaluate('Promise.race([document.fonts.ready, new Promise(r=>setTimeout(r,5000))]).then(()=>true)');
    await new Promise(r => setTimeout(r, 700));
    const meta = await client.evaluate('({url:location.href,title:document.title,width:innerWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight,text:document.body.innerText.slice(0,14000)})');
    await save(path.join(arg, 'browser.json'), JSON.stringify({target, ...meta}, null, 2));
    await screenshot(client, path.join(arg, 'first.png'));
    console.log(JSON.stringify({target, ...meta,text:meta.text.slice(0,900)}, null, 2));
  } else if (command === 'eval') {
    const value = await client.evaluate(await fs.readFile(arg, 'utf8'));
    if (rest[0]) { await save(rest[0], JSON.stringify(value, null, 2)); console.log(`Saved ${rest[0]}`); }
    else console.log(JSON.stringify(value, null, 2));
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
    await new Promise(r=>setTimeout(r,650));
    console.log(JSON.stringify({command,selector:arg,...pos}));
  } else if (command === 'cdp') {
    const requests = JSON.parse(await fs.readFile(arg, 'utf8'));
    const results = [];
    for (const req of requests) results.push(await client.send(req.method, req.params || {}));
    console.log(JSON.stringify(results, null, 2));
  } else throw new Error('Usage: browser.mjs open URL DIR | eval TARGET FILE [OUTPUT] | shot TARGET PNG [Y] [WIDTH] | cdp TARGET REQUESTS.json | list');
} finally { client.close(); }
