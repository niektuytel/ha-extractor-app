import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { buildCapturePages } from '../pages.js';

const indexUrl = new URL('../index.js', import.meta.url);
const source = await fsp.readFile(indexUrl, 'utf8');

async function startApp(t, overrides = {}, { failNavigation, failEncoding } = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'ha-extractor-test-'));
  const options = {
    url: 'http://ha.example/lovelace',
    pages: [
      { name: 'living-room', url: 'http://ha.example/lovelace/living-room' },
      { name: 'kitchen', url: 'https://other-ha.example/lovelace/kitchen' },
    ],
    token: 'test-token', output_path: path.join(directory, 'www', 'output'),
    duration: 1, delay_after_loaded: 0, ...overrides,
  };
  const navigations = [];
  const recordings = [];
  const authScripts = [];
  const errors = [];
  const browserPages = [];
  let recordingGate;
  let tick;
  let activeRecordings = 0;
  let maxRecordings = 0;
  let activeEncodings = 0;
  let maxEncodings = 0;
  let launchCount = 0;

  function newContext() {
    const pages = [];
    return {
      addInitScript: async (fn, args) => { authScripts.push({ fn, args }); },
      newPage: async () => {
        let url;
        let closed = false;
        let videoPath;
        const page = {
          isClosed: () => closed,
          url: () => url,
          goto: async (target) => {
            navigations.push(target);
            if (target === failNavigation) throw new Error('Dashboard unavailable');
            url = target;
          },
          waitForFunction: async () => {}, evaluate: async () => {},
          waitForTimeout: async () => { if (recordingGate) await recordingGate; },
          close: async () => { closed = true; },
          screencast: {
            start: async ({ path: target }) => {
              activeRecordings += 1;
              maxRecordings = Math.max(maxRecordings, activeRecordings);
              videoPath = target;
              recordings.push(url);
              await fsp.writeFile(videoPath, url);
            },
            stop: async () => { activeRecordings -= 1; },
          },
        };
        pages.push(page);
        browserPages.push(page);
        return page;
      },
      close: async () => { await Promise.all(pages.map((page) => page.close())); },
      newCDPSession: async () => ({ send: async () => {}, detach: async () => {} }),
    };
  }

  const browser = { isConnected: () => true, once: () => {}, newContext: async () => newContext(), close: async () => {} };
  const chromium = {
    launch: async () => { launchCount += 1; return browser; },
    launchPersistentContext: async () => { launchCount += 1; return newContext(); },
  };
  const spawn = (command, args) => {
    assert.equal(command, 'ffmpeg');
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    activeEncodings += 1;
    maxEncodings = Math.max(maxEncodings, activeEncodings);
    setImmediate(async () => {
      try {
        const target = args.at(-1);
        const input = await fsp.readFile(args[args.indexOf('-i') + 1], 'utf8');
        if (input === failEncoding) {
          child.stderr.emit('data', 'Encoding failed');
          child.emit('close', 1);
        } else {
          await fsp.writeFile(target, input);
          child.emit('close', 0);
        }
      } catch (error) {
        child.emit('error', error);
      } finally {
        activeEncodings -= 1;
      }
    });
    return child;
  };
  const context = vm.createContext({
    URL, setTimeout,
    console: { log() {}, warn() {}, error: (message) => errors.push(message) },
    process: {
      pid: process.pid,
      env: { TEMP_VIDEO_DIR: path.join(directory, 'temp'), CHROMIUM_PROFILE_DIR: path.join(directory, 'profile'), NO_COLOR: '1' },
      once() {}, exit() {},
    },
  });
  const mocks = {
    playwright: { chromium },
    'node-cron': { default: { validate: () => true, schedule: (schedule, callback) => { tick = callback; return { stop() {} }; } } },
    'node:child_process': { spawn },
    dotenv: { default: { config() {} } },
    'node:fs': { default: {
      ...fs,
      existsSync: (target) => target === '/data/options.json' || fs.existsSync(target),
      readFileSync: (target, encoding) => target === '/data/options.json' ? JSON.stringify(options) : fs.readFileSync(target, encoding),
    } },
    'node:fs/promises': { default: fsp },
    'node:path': { default: path },
    './pages.js': { buildCapturePages },
  };
  // Expose the batch and its queue to the harness without changing runtime exports.
  const app = new vm.SourceTextModule(`${source}\nexport { captureDashboard, closeSharedBrowser };\nexport async function idle() { while (captureRunning || pendingEncodes > 0) await new Promise(resolve => setTimeout(resolve, 1)); }`, {
    context, initializeImportMeta: (meta) => { meta.url = indexUrl.href; },
  });
  await app.link((specifier) => {
    const exports = mocks[specifier];
    assert.ok(exports, `Unexpected dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  t.after(async () => {
    recordingGate = undefined;
    await app.namespace.idle();
    await app.namespace.closeSharedBrowser();
    await fsp.rm(directory, { recursive: true, force: true });
  });
  await app.evaluate();
  await app.namespace.idle();
  return {
    options, directory, navigations, recordings, authScripts, errors, browserPages,
    tick: () => tick(), idle: () => app.namespace.idle(), capture: () => app.namespace.captureDashboard(),
    setGate: (gate) => { recordingGate = gate; },
    stats: () => ({ maxRecordings, maxEncodings, launchCount }),
  };
}

for (const outputType of ['mp4', 'webp']) {
  for (const retainProfile of [false, true]) {
    test(`${outputType} pages have independent players and refresh correctly (retain_profile=${retainProfile})`, async (t) => {
      const app = await startApp(t, { output_type: outputType, retain_profile: retainProfile });
      const outputDir = path.dirname(app.options.output_path);
      for (const page of app.options.pages) {
        const html = await fsp.readFile(path.join(outputDir, `${page.name}.html`), 'utf8');
        assert.ok(html.includes(`var sourceName = "${page.name}.${outputType}"`));
        assert.ok(html.includes(`var versionName = "${page.name}.${outputType}.version"`));
        assert.ok(html.includes(`var outputType = "${outputType}"`));
        assert.ok(!html.includes('__SOURCE_NAME__'));
        assert.equal(await fsp.readFile(path.join(outputDir, `${page.name}.${outputType}`), 'utf8'), page.url);
        const version = await fsp.readFile(path.join(outputDir, `${page.name}.${outputType}.version`), 'utf8');
        assert.match(version, /^\d+\n$/);
        await fsp.writeFile(path.join(outputDir, `${page.name}.${outputType}.version`), 'old-version');
      }
      assert.ok(!fs.existsSync(path.join(outputDir, 'index.html')));
      assert.equal(app.recordings.length, 2);

      app.tick();
      await app.idle();
      assert.equal(app.recordings.length, 4);
      assert.equal(app.navigations.length, retainProfile ? 2 : 4);
      assert.equal(app.browserPages.length, retainProfile ? 2 : 4);
      for (const page of app.options.pages) {
        assert.notEqual(await fsp.readFile(path.join(outputDir, `${page.name}.${outputType}.version`), 'utf8'), 'old-version');
      }
      for (const { fn, args } of app.authScripts) {
        for (const origin of ['http://ha.example', 'https://other-ha.example']) {
          const stored = {};
          vm.runInNewContext(`(${fn.toString()})(args)`, {
            args, window: { location: { origin }, localStorage: { setItem: (key, value) => { stored[key] = value; } } },
          });
          assert.equal(JSON.parse(stored.hassTokens).hassUrl, origin);
        }
      }
      assert.deepEqual(app.stats(), { maxRecordings: 1, maxEncodings: 1, launchCount: 1 });
      assert.deepEqual(await fsp.readdir(path.join(app.directory, 'temp')), []);
      assert.deepEqual(app.errors, []);
    });
  }
}

test('legacy configuration still generates index.html and output media', async (t) => {
  const app = await startApp(t, { pages: [] });
  const html = await fsp.readFile(path.join(path.dirname(app.options.output_path), 'index.html'), 'utf8');
  assert.ok(html.includes('var sourceName = "output.mp4"'));
  assert.equal(await fsp.readFile(`${app.options.output_path}.mp4`, 'utf8'), app.options.url);
});

test('a failed dashboard does not prevent later captures and is retried next run', async (t) => {
  const failedUrl = 'http://ha.example/lovelace/living-room';
  const app = await startApp(t, { retain_profile: true }, { failNavigation: failedUrl });
  assert.equal(app.recordings.length, 1);
  const kitchenPath = path.join(path.dirname(app.options.output_path), 'kitchen.mp4');
  assert.equal(await fsp.readFile(kitchenPath, 'utf8'), app.options.pages[1].url);
  app.tick();
  await app.idle();
  assert.equal(app.recordings.length, 2);
  assert.equal(app.navigations.filter((url) => url === failedUrl).length, 2);
  assert.equal(app.navigations.filter((url) => url === app.options.pages[1].url).length, 1);
  assert.equal(app.errors.length, 2);
});

test('an encoding failure leaves other page outputs and the queue intact', async (t) => {
  const app = await startApp(t, {}, { failEncoding: 'http://ha.example/lovelace/living-room' });
  const outputDir = path.dirname(app.options.output_path);
  assert.ok(!fs.existsSync(path.join(outputDir, 'living-room.mp4.version')));
  assert.equal(await fsp.readFile(path.join(outputDir, 'kitchen.mp4'), 'utf8'), app.options.pages[1].url);
  assert.equal(app.errors.length, 1);
  assert.deepEqual(await fsp.readdir(path.join(app.directory, 'temp')), []);
  assert.ok(!(await fsp.readdir(outputDir)).some((name) => name.includes('.tmp-')));
});

test('a scheduled run cannot overlap any page in an active batch', async (t) => {
  const app = await startApp(t);
  let release;
  app.setGate(new Promise((resolve) => { release = resolve; }));
  t.after(() => release());
  const capture = app.capture();
  try {
    while (app.recordings.length < 3) await new Promise((resolve) => setTimeout(resolve, 1));
    app.tick();
    await app.capture();
    assert.equal(app.recordings.length, 3);
  } finally {
    app.setGate(undefined);
    release();
  }
  await capture;
  await app.idle();
  assert.equal(app.recordings.length, 4);
  assert.equal(app.stats().maxRecordings, 1);
});
