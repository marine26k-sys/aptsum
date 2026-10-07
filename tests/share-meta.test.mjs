import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareShareMeta } from '../scripts/prepare-share-meta.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const previewEnv = { CONTEXT: 'deploy-preview', DEPLOY_PRIME_URL: 'https://deploy-preview-159--aptsum.netlify.app/' };

test('preview sharing metadata uses the preview image and page before JavaScript runs', () => {
  const output = prepareShareMeta(html, previewEnv);
  assert.ok(output.includes('<meta property="og:image" content="https://deploy-preview-159--aptsum.netlify.app/assets/og-share-v3.png">'));
  assert.ok(output.includes('<meta name="twitter:image" content="https://deploy-preview-159--aptsum.netlify.app/assets/og-share-v3.png">'));
  assert.ok(output.includes('<meta property="og:url" content="https://deploy-preview-159--aptsum.netlify.app/">'));
  assert.ok(output.includes('<link rel="canonical" href="https://deploy-preview-159--aptsum.netlify.app/">'));
  assert.equal(prepareShareMeta(output, previewEnv), output);
  assert.equal(output.slice(output.indexOf('<body')), html.slice(html.indexOf('<body')));
});

test('production and local builds keep production sharing URLs even after a preview build', () => {
  const preview = prepareShareMeta(html, previewEnv);
  for (const env of [{}, { CONTEXT: 'production', DEPLOY_PRIME_URL: previewEnv.DEPLOY_PRIME_URL }]) {
    const output = prepareShareMeta(preview, env);
    assert.ok(output.includes('<meta property="og:image" content="https://aptsum.kr/assets/og-share-v3.png">'));
    assert.ok(output.includes('<meta property="og:url" content="https://aptsum.kr/">'));
    assert.ok(!output.includes('<link rel="canonical" href="https://deploy-preview-'));
  }
});

test('invalid preview deployment URL or missing tags fails instead of publishing incorrect metadata', () => {
  for (const url of [undefined, 'invalid', 'http://example.com', 'https://user:secret@example.com']) {
    assert.throws(() => prepareShareMeta(html, { CONTEXT: 'deploy-preview', DEPLOY_PRIME_URL: url }));
  }
  assert.throws(() => prepareShareMeta(html.replace(/<meta property="og:image"[^>]*>/, ''), previewEnv));
});
