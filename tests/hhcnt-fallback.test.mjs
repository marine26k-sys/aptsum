import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../netlify/functions/hhcnt.mjs', import.meta.url), 'utf8');

test('uses the supplementary complex mapping only as a K-apt fallback', () => {
  assert.match(source, /fetch\(`\$\{origin\}\/data\/hhcnt-naver\/\$\{encodeURIComponent\(lawd\)\}\.json`\)/);
  assert.match(source, /if \(result && result\.found && result\.hhcnt > 0\) return result;/);
  assert.match(source, /const fallbackMap = await loadNaverHh\(new URL\(req\.url\)\.origin, lawd\)/);
  assert.match(source, /applyFallback\(fallbackMap, lawd, nm, results\[nm\]\)/);
  assert.doesNotMatch(source, /applyNaver\(/);
});
