import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { buildCapturePages } from '../pages.js';

const defaults = { url: 'http://homeassistant:8123/lovelace?kiosk', outputPathBase: path.join('www', 'ha-extractor', 'output') };

test('an empty list preserves the legacy media filename and index.html', () => {
  const [page] = buildCapturePages([], defaults);
  assert.equal(page.url, defaults.url);
  assert.equal(page.outputPathBase, defaults.outputPathBase);
  assert.equal(page.playerPath, path.join('www', 'ha-extractor', 'index.html'));
});

test('named pages use independent outputs beside output_path, including JSON environment input', () => {
  const pages = buildCapturePages(JSON.stringify([
    { name: 'living-room', url: defaults.url },
    { name: 'kitchen', url: 'https://other-ha.example/dashboard/kitchen' },
  ]), { ...defaults, url: 'unused' });
  assert.deepEqual(pages.map((page) => path.basename(page.playerPath)), ['living-room.html', 'kitchen.html']);
  assert.deepEqual(pages.map((page) => path.basename(page.outputPathBase)), ['living-room', 'kitchen']);
  assert.equal(pages[1].url, 'https://other-ha.example/dashboard/kitchen');
});

test('invalid lists, unsafe filenames, duplicates and invalid URLs fail before recording', () => {
  for (const input of [null, {}, 'not json', '{}', [null], ['page'], [{ name: 'missing-url' }]]) {
    assert.throws(() => buildCapturePages(input, defaults));
  }
  for (const name of ['', '../outside', 'a/b', 'a\\b', 'Living Room', 'a.html', '-page', '<script>', 'page\n']) {
    assert.throws(() => buildCapturePages([{ name, url: defaults.url }], defaults), /name/);
  }
  assert.throws(() => buildCapturePages([
    { name: 'same', url: defaults.url }, { name: 'same', url: defaults.url },
  ], defaults), /Duplicate page name/);
  for (const url of ['relative/path', 'file:///etc/passwd', 'javascript:alert(1)', undefined, 123]) {
    assert.throws(() => buildCapturePages([{ name: 'page', url }], defaults), /HTTP or HTTPS/);
  }
  assert.throws(() => buildCapturePages([], { ...defaults, url: 'invalid' }), /url/);
});
