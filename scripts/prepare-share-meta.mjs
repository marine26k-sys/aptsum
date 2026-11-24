import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const productionOrigin = 'https://aptsum.kr';

function shareOrigin(env) {
  let origin = productionOrigin;
  if (['deploy-preview', 'branch-deploy'].includes(env.CONTEXT)) {
    const url = new URL(env.DEPLOY_PRIME_URL);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Expected an HTTPS deploy URL without credentials');
    }
    origin = url.origin;
  }
  return origin;
}

export function prepareShareMeta(html, env = process.env) {
  const origin = shareOrigin(env);
  const targets = [
    [/<meta property="og:image" content="[^"]*">/g, `<meta property="og:image" content="${origin}/assets/og-share-v3.png">`],
    [/<meta name="twitter:image" content="[^"]*">/g, `<meta name="twitter:image" content="${origin}/assets/og-share-v3.png">`],
    [/<meta property="og:url" content="[^"]*">/g, `<meta property="og:url" content="${origin}/">`],
    [/<link rel="canonical" href="[^"]*">/g, `<link rel="canonical" href="${origin}/">`],
  ];
  for (const [pattern, replacement] of targets) {
    if ([...html.matchAll(pattern)].length !== 1) throw new Error(`Missing or duplicated sharing metadata: ${pattern}`);
    html = html.replace(pattern, replacement);
  }
  return html;
}

export function prepareCardShareMeta(html, env = process.env) {
  const origin = shareOrigin(env);
  const targets = [
    [/<meta property="og:image" content="[^"]*">/g, `<meta property="og:image" content="${origin}/card/og-image-v2.png">`],
    [/<meta name="twitter:image" content="[^"]*">/g, `<meta name="twitter:image" content="${origin}/card/og-image-v2.png">`],
    [/<meta property="og:url" content="[^"]*">/g, `<meta property="og:url" content="${origin}/card/?v=2">`],
  ];
  for (const [pattern, replacement] of targets) {
    if ([...html.matchAll(pattern)].length !== 1) throw new Error(`Missing or duplicated card sharing metadata: ${pattern}`);
    html = html.replace(pattern, replacement);
  }
  return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = new URL('../index.html', import.meta.url);
  await writeFile(file, prepareShareMeta(await readFile(file, 'utf8')));
  const cardFile = new URL('../card/index.html', import.meta.url);
  await writeFile(cardFile, prepareCardShareMeta(await readFile(cardFile, 'utf8')));
  console.log('Sharing metadata prepared for this deployment');
}
