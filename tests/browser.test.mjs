import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolveCdpEndpoint, waitFor, waitUntil} from '../src/browser.mjs';
import {prepareChromeLaunch} from '../templates/launch-chrome-cdp.mjs';

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'autobricks-cdp-'));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(root)), parent);
    await fs.rm(root, {recursive: true, force: true});
  });
  // Bound discovery even when the test itself runs inside a configured project.
  await fs.mkdir(path.join(root, '.git'));
  return root;
}

async function config(dir, text) {
  await fs.mkdir(path.join(dir, '.browser'), {recursive: true});
  await fs.writeFile(path.join(dir, '.browser', 'cdp.env'), text);
}

test('CDP settings follow the working project from a nested task directory', async t => {
  const root = await fixture(t);
  const cwd = path.join(root, 'data', 'run', 'tmp');
  await fs.mkdir(cwd, {recursive: true});
  await config(root, '\uFEFF# project browser\r\nCDP_PORT=9333\r\nPROFILE_DIR=.chrome_cdp-custom\r\n');
  assert.equal(await resolveCdpEndpoint({cwd, env: {}}), 'http://127.0.0.1:9333');
  await config(path.join(root, 'data'), 'CDP_PORT=9555\n');
  assert.equal(await resolveCdpEndpoint({cwd, env: {}}), 'http://127.0.0.1:9555');
});

test('explicit CDP URL still overrides the project file', async t => {
  const cwd = await fixture(t);
  await config(cwd, 'CDP_PORT=9333\n');
  assert.equal(await resolveCdpEndpoint({cwd, env: {AUTOBRICKS_CDP: ' https://cdp.example/proxy/ '}}), 'https://cdp.example/proxy');
  for (const value of ['localhost:9333', 'file:///tmp/cdp', 'http://localhost:9333/?other=1']) {
    await assert.rejects(resolveCdpEndpoint({cwd, env: {AUTOBRICKS_CDP: value}}), /AUTOBRICKS_CDP must/);
  }
});

test('missing port defaults to the launcher port without escaping a Git project', async t => {
  const root = await fixture(t);
  await config(root, 'CDP_PORT=9333\n');
  for (const gitMarker of ['directory', 'worktree-file']) {
    const cwd = path.join(root, gitMarker);
    await fs.mkdir(cwd);
    if (gitMarker === 'directory') await fs.mkdir(path.join(cwd, '.git'));
    else await fs.writeFile(path.join(cwd, '.git'), 'gitdir: /some/worktree\n');
    assert.equal(await resolveCdpEndpoint({cwd, env: {}}), 'http://127.0.0.1:9222');
  }
  await config(root, '# defaults\nPROFILE_DIR=.chrome_cdp\n');
  assert.equal(await resolveCdpEndpoint({cwd: root, env: {}}), 'http://127.0.0.1:9222');
});

test('invalid or unreadable CDP settings fail instead of connecting elsewhere', async t => {
  const cwd = await fixture(t);
  for (const port of ['', '0', '65536', '9.3', 'oops', '$(echo 9333)']) {
    await config(cwd, `CDP_PORT=${port}\n`);
    await assert.rejects(resolveCdpEndpoint({cwd, env: {}}), /Invalid CDP_PORT/);
  }
  await fs.unlink(path.join(cwd, '.browser', 'cdp.env'));
  await fs.mkdir(path.join(cwd, '.browser', 'cdp.env'));
  await assert.rejects(resolveCdpEndpoint({cwd, env: {}}));
});

test('CLI and imported helper use project settings even from a plugin cache', async t => {
  const root = await fixture(t);
  const project = path.join(root, 'work');
  const cwd = path.join(project, 'data', 'run', 'tmp');
  const cache = path.join(root, 'plugin-cache');
  await fs.mkdir(cwd, {recursive: true});
  await config(cache, 'CDP_PORT=1\n');
  await fs.mkdir(path.join(cache, 'src'), {recursive: true});
  await fs.mkdir(path.join(cache, 'templates'), {recursive: true});
  const tool = path.join(cache, 'src', 'browser.mjs');
  await fs.copyFile(fileURLToPath(new URL('../src/browser.mjs', import.meta.url)), tool);
  await fs.copyFile(fileURLToPath(new URL('../templates/launch-chrome-cdp.mjs', import.meta.url)),
    path.join(cache, 'templates', 'launch-chrome-cdp.mjs'));
  const routes = [];
  const targets = [{id: 'project-browser', type: 'page'}];
  const server = http.createServer((req, res) => {
    routes.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(targets));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  await config(project, `CDP_PORT=${server.address().port}\n`);
  const env = {...process.env};
  delete env.AUTOBRICKS_CDP;
  const execute = promisify(execFile);
  const listed = await execute(process.execPath, [tool, 'list'], {cwd, env});
  assert.deepEqual(JSON.parse(listed.stdout), targets);
  assert.deepEqual(routes, ['/json/list']);
  const imported = await execute(process.execPath, ['--input-type=module', '-e',
    'const tool = await import(process.argv[1]); console.log(await tool.resolveCdpEndpoint());',
    pathToFileURL(tool).href], {cwd, env});
  assert.equal(imported.stdout.trim(), endpoint);
});

test('launcher and CDP client agree on BOM, CRLF, whitespace, duplicates and defaults', async t => {
  const cwd = await fixture(t);
  const directory = path.join(cwd, '.browser');
  for (const [settings, expected] of [
    ['', 9222],
    ['\uFEFFCDP_PORT=9333\r\n', 9333],
    ['\uFEFF  cdp_port = 009444  \r\n', 9444],
    ['CDP_PORT=9333\nCDP_PORT=9555', 9555],
  ]) {
    await config(cwd, `${settings}\nCHROME_PATH=${process.execPath}\n`);
    const launch = await prepareChromeLaunch({directory});
    assert.equal(launch.port, expected);
    assert.equal(await resolveCdpEndpoint({cwd, env: {}}), `http://127.0.0.1:${expected}`);
    assert.deepEqual(launch.args, [`--remote-debugging-port=${expected}`, `--user-data-dir=${launch.profile}`]);
    assert.equal(path.dirname(launch.profile), directory);
  }
});

test('invalid launcher ports fail, and explicit port and profile overrides are preserved', async t => {
  const cwd = await fixture(t);
  const directory = path.join(cwd, '.browser');
  for (const port of ['', '0', '65536', 'oops', '$(echo 9333)']) {
    await config(cwd, `CDP_PORT=${port}\nCHROME_PATH=${process.execPath}\n`);
    await assert.rejects(prepareChromeLaunch({directory}), /Invalid CDP_PORT/);
  }
  const profile = '.profile with spaces & literal chars';
  await config(cwd, `CDP_PORT=invalid\r\nPROFILE_DIR=${profile}\r\nCHROME_PATH=${process.execPath}\r\n`);
  const launch = await prepareChromeLaunch({directory, portOverride: '9334'});
  assert.equal(launch.port, 9334);
  assert.equal(launch.profile, path.join(directory, profile));
  assert.equal(launch.executable, process.execPath);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['cdp.env']); // No unused output/profile directories.
});

test('wait observes a delayed state and awaits Promise results', async () => {
  let ready = false;
  const timer = setTimeout(() => { ready = true; }, 30);
  try {
    const result = await waitFor({evaluate: async () => ready}, 'page state', 1000);
    assert.equal(result.ready, true);
    assert.ok(result.elapsedMs >= 30);
  } finally { clearTimeout(timer); }
});

test('only boolean true confirms completion, timeout includes the last value', async () => {
  await assert.rejects(waitUntil(() => ({ready: false}), 30, 'import result'),
    /waiting for import result; last result: \{"ready":false\}/);
});

test('a Promise that never resolves cannot exceed the waiting deadline', async () => {
  await assert.rejects(waitFor({evaluate: () => new Promise(() => {})}, 'hung promise', 30),
    /Timed out after 30ms/);
});

test('navigation context errors can recover within the same deadline', async () => {
  let calls = 0;
  const navigationErrors = [
    'Execution context was destroyed.',
    'Cannot find context with specified id',
    'Inspected target navigated or closed'
  ];
  const client = {evaluate: async () => {
    const message = navigationErrors[calls++];
    if (message) {
      throw Object.assign(new Error(message), {cdpCode: -32000});
    }
    return true;
  }};
  assert.equal((await waitFor(client, 'read-only predicate', 1000)).ready, true);
  assert.equal(calls, 4);
});

test('script errors and disconnects fail immediately without retrying', async () => {
  for (const error of [new SyntaxError('Unexpected token'), new Error('CDP disconnected')]) {
    let calls = 0;
    await assert.rejects(waitUntil(() => { calls++; throw error; }), error);
    assert.equal(calls, 1);
  }
});

test('invalid timeouts are rejected before evaluating page code', async () => {
  for (const timeout of [0, -1, NaN, Infinity, 2147483648]) {
    await assert.rejects(waitUntil(() => assert.fail('must not evaluate'), timeout), /Timeout must/);
  }
});
