import path from 'node:path';

function validateUrl(url, name) {
  try {
    if (typeof url !== 'string' || !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL`);
  }
}

export function buildCapturePages(rawPages, { url, outputPathBase }) {
  let pages = rawPages;
  if (typeof pages === 'string') {
    try { pages = JSON.parse(pages); } catch { throw new Error('pages / PAGES must be a JSON array'); }
  }
  if (!Array.isArray(pages)) throw new Error('pages must be an array');

  const outputDir = path.dirname(outputPathBase);
  if (pages.length === 0) {
    validateUrl(url, 'url');
    return [{ name: 'default', url, outputPathBase, playerPath: path.join(outputDir, 'index.html') }];
  }

  const names = new Set();
  return pages.map((page, index) => {
    const label = `pages[${index}]`;
    if (!page || typeof page !== 'object' || Array.isArray(page)) throw new Error(`${label} must be an object`);
    if (typeof page.name !== 'string' || page.name !== page.name.trim() || !/^[a-z0-9][a-z0-9_-]*$/.test(page.name)) {
      throw new Error(`${label}.name must use lowercase letters, numbers, hyphens or underscores and start with a letter or number`);
    }
    if (names.has(page.name)) throw new Error(`Duplicate page name: ${page.name}`);
    names.add(page.name);
    validateUrl(page.url, `${label}.url`);
    return {
      name: page.name,
      url: page.url,
      outputPathBase: path.join(outputDir, page.name),
      playerPath: path.join(outputDir, `${page.name}.html`),
    };
  });
}
