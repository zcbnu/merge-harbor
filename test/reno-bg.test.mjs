// 修复背景三段透明度：p=0 仅旧港，p≈0.5 以中景为主，p=1 以修复后为主。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const game = readFileSync(new URL('game.js', root), 'utf8');
const html = readFileSync(new URL('index.html', root), 'utf8');
const css = readFileSync(new URL('style.css', root), 'utf8');

function loadRenoBgOpacity(src) {
  const start = src.indexOf('function renoBgOpacity');
  assert.notEqual(start, -1, 'game.js 应定义 renoBgOpacity');
  let i = src.indexOf('{', start);
  let depth = 0;
  let end = i;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}') {
      depth--;
      if (depth === 0) { end++; break; }
    }
  }
  return vm.runInNewContext(`${src.slice(start, end)}\nrenoBgOpacity;`);
}

const renoBgOpacity = loadRenoBgOpacity(game);

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const at0 = renoBgOpacity(0);
assert.equal(at0.before, 1);
assert.ok(near(at0.mid, 0), 'p=0 中景应为 0');
assert.ok(near(at0.after, 0), 'p=0 修复后应为 0');

const mid = renoBgOpacity(0.5);
assert.equal(mid.before, 1);
assert.ok(near(mid.mid, 1), 'p=0.5 应以中景为主');
assert.ok(near(mid.after, 0), 'p=0.5 修复后尚未淡入');

const done = renoBgOpacity(1);
assert.equal(done.before, 1);
assert.ok(near(done.mid, 0), 'p=1 中景应淡出');
assert.ok(near(done.after, 1), 'p=1 应以修复后为主');

const early = renoBgOpacity(0.25);
assert.ok(near(early.mid, 0.5));
assert.ok(near(early.after, 0));

const late = renoBgOpacity(0.75);
assert.ok(near(late.mid, 0.5), '后半段中景应随进度淡出');
assert.ok(near(late.after, 0.5), '后半段修复后应随进度淡入');

assert.deepEqual(renoBgOpacity(-1), renoBgOpacity(0));
assert.deepEqual(renoBgOpacity(2), renoBgOpacity(1));
assert.deepEqual(renoBgOpacity(NaN), renoBgOpacity(0));

assert.match(html, /id="bgBefore"[\s\S]*id="bgMid"[\s\S]*id="bgAfter"/, '中景层应夹在旧港与修复后之间');
assert.match(css, /#bgMid\{[^}]*assets\/backgrounds\/harbor_mid\.svg/);
assert.match(css, /#bgMid\{[^}]*opacity:\s*0/);
assert.match(game, /\$\('bgMid'\)\.style\.opacity\s*=/);
assert.match(game, /\$\('bgAfter'\)\.style\.opacity\s*=/);
assert.doesNotMatch(game, /\$\('bgAfter'\)\.style\.opacity\s*=\s*\(S\.renovations\.length\s*\/\s*total\)/);

console.log('reno-bg tests passed');
