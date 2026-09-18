// Shared by the launchers and src/browser.mjs; Node 22+, no packages.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

export function parseCdpSettings(contents, source = 'cdp.env', portOverride) {
  const settings = {CDP_PORT: '9222', PROFILE_DIR: '', CHROME_PATH: ''};
  for (const line of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^(CDP_PORT|PROFILE_DIR|CHROME_PATH)\s*=(.*)$/i.exec(line.trim());
    if (match) settings[match[1].toUpperCase()] = match[2].trim();
  }
  const value = portOverride === undefined ? settings.CDP_PORT : portOverride.trim();
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`Invalid CDP_PORT in ${portOverride === undefined ? source : 'argument'}; use an integer from 1 to 65535`);
  }
  return {...settings, CDP_PORT: Number(value)};
}

export async function prepareChromeLaunch({directory, portOverride, env = process.env} = {}) {
  directory = path.resolve(directory ?? path.dirname(fileURLToPath(import.meta.url)));
  const file = path.join(directory, 'cdp.env');
  let contents = '';
  try { contents = await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const {CDP_PORT: port, PROFILE_DIR: profileDir, CHROME_PATH: chromePath} = parseCdpSettings(contents, file, portOverride);
  const profile = path.resolve(directory, profileDir || (port === 9222 ? '.chrome_cdp' : `.chrome_cdp-${port}`));
  const candidates = chromePath ? [path.resolve(directory, chromePath)] : process.platform === 'win32'
    ? [env.ProgramFiles, env['ProgramFiles(x86)'], env.LocalAppData]
      .filter(Boolean).map(dir => path.join(dir, 'Google/Chrome/Application/chrome.exe'))
    : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ...(env.PATH || '').split(path.delimiter).filter(Boolean)
        .flatMap(dir => ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(name => path.join(dir, name)))];
  for (const executable of candidates) {
    try { await fs.access(executable, constants.X_OK); if (!(await fs.stat(executable)).isFile()) continue; }
    catch { continue; }
    return {executable, port, profile, args: [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`]};
  }
  throw new Error('Chrome/Chromium not found; set CHROME_PATH to an executable in cdp.env');
}

async function main() {
  if (process.argv.length > 3) throw new Error('Usage: node launch-chrome-cdp.mjs [port]');
  const launch = await prepareChromeLaunch({portOverride: process.argv[2]});
  const child = spawn(launch.executable, launch.args, {detached: true, stdio: 'ignore', windowsHide: false});
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  console.log(`[ok] Chrome launched with CDP debug port ${launch.port}\n     profile: ${launch.profile}`);
  console.log(`Keep Chrome running. CDP endpoint: http://127.0.0.1:${launch.port}`);
  console.log('Run AutoBricks browser.mjs from the working project; it reads .browser/cdp.env.');
  if (process.argv[2] !== undefined) {
    console.log(`Temporary port override: set AUTOBRICKS_CDP=http://127.0.0.1:${launch.port} for the tool.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
