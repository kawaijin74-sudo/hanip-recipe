#!/usr/bin/env node
// 한입레시피 정적 페이지 검사 (의존성 없음). seo.mjs 가 끝에 자동으로 부르고, 따로 돌려도 된다.
// 실행: node tools/check-seo.mjs
// 1) 모든 JSON-LD 가 JSON.parse 되는지  2) 내부 링크·sitemap·llms.txt 주소가 실제 파일을 가리키는지
// 3) 페이지마다 제목·설명·canonical·h1 이 있는지  4) 비밀 값(열쇠·토큰)이 섞여 있지 않은지
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://kawaijin74-sudo.github.io/hanip-recipe/';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === '.git' || e.name === 'node_modules') return [];
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

// 사이트 주소(절대 또는 상대)를 저장소 안의 파일로 바꾼다. 없으면 null
function toFile(url, fromFile) {
  let u = url.split('#')[0].split('?')[0];
  if (u.startsWith(SITE)) u = path.join(ROOT, u.slice(SITE.length));
  else u = path.resolve(path.dirname(fromFile), decodeURIComponent(u || path.basename(fromFile)));
  if (url.split('#')[0] === '' ) return fromFile;
  if (u.endsWith(path.sep) || (fs.existsSync(u) && fs.statSync(u).isDirectory())) u = path.join(u, 'index.html');
  return fs.existsSync(u) ? u : null;
}

export function check() {
  const errors = [];
  const files = walk(ROOT);
  const htmls = files.filter((f) => f.endsWith('.html'));
  let ldCount = 0, linkCount = 0;
  const types = {};

  for (const f of htmls) {
    let html = fs.readFileSync(f, 'utf8');
    const name = rel(f);
    // index.html 은 앱 스크립트 안의 템플릿 문자열이 있으니 seo 영역과 head 만 본다
    if (name === 'index.html') {
      const m = html.match(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/g) || [];
      if (m.length !== 1) errors.push(`index.html: seo 영역이 ${m.length}개 (1개여야 함)`);
      html = m.join('\n');
    } else {
      for (const [re, what] of [[/<title>[^<]+<\/title>/, '제목'], [/<meta name="description" content="[^"]+">/, '설명'], [/<link rel="canonical" href="https:\/\/[^"]+">/, 'canonical'], [/<meta property="og:title"/, 'og:title']]) {
        if (!re.test(html)) errors.push(`${name}: ${what} 없음`);
      }
      const h1 = (html.match(/<h1[\s>]/g) || []).length;
      if (h1 !== 1) errors.push(`${name}: h1 이 ${h1}개`);
      const canon = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
      if (canon && toFile(canon, f) !== f) errors.push(`${name}: canonical(${canon})이 자기 파일을 가리키지 않음`);
    }

    // JSON-LD
    for (const [, body] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      ldCount++;
      let obj;
      try { obj = JSON.parse(body); } catch (e) { errors.push(`${name}: JSON-LD 파싱 실패 (${e.message})`); continue; }
      types[obj['@type']] = (types[obj['@type']] || 0) + 1;
      if (obj['@type'] === 'Recipe') {
        for (const k of ['name', 'image', 'author', 'recipeIngredient']) if (!obj[k] || (Array.isArray(obj[k]) && !obj[k].length)) errors.push(`${name}: Recipe.${k} 없음`);
      }
      // JSON-LD 안의 우리 사이트 주소도 실제 파일이어야 한다
      for (const [, u] of JSON.stringify(obj).matchAll(/"(https:\/\/kawaijin74-sudo\.github\.io\/hanip-recipe\/[^"]*)"/g)) {
        linkCount++;
        if (!toFile(u, f)) errors.push(`${name}: JSON-LD 주소 ${u} 에 해당하는 파일 없음`);
      }
    }

    // href / src
    const ids = new Set([...fs.readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, u] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      if (/^(mailto:|tel:|javascript:|data:)/.test(u)) continue;
      if (/^https?:\/\//.test(u) && !u.startsWith(SITE)) continue; // 외부 주소
      if (u.startsWith('#')) { if (u.length > 1 && !u.startsWith('#/') && !ids.has(u.slice(1))) errors.push(`${name}: 페이지 안 앵커 ${u} 없음`); continue; }
      linkCount++;
      const target = toFile(u, f);
      if (!target) { errors.push(`${name}: 깨진 링크 ${u}`); continue; }
      const hash = u.split('#')[1];
      if (hash && !hash.startsWith('/') && !new RegExp(`\\sid="${hash}"`).test(fs.readFileSync(target, 'utf8'))) errors.push(`${name}: ${u} 의 앵커 #${hash} 없음`);
    }
  }

  // sitemap.xml
  const sm = fs.existsSync(path.join(ROOT, 'sitemap.xml')) ? fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8') : '';
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!locs.length) errors.push('sitemap.xml 이 없거나 비었음');
  const inMap = new Set();
  for (const u of locs) {
    if (!u.startsWith(SITE)) { errors.push(`sitemap.xml: 다른 사이트 주소 ${u}`); continue; }
    const t = toFile(u, path.join(ROOT, 'sitemap.xml'));
    if (!t) errors.push(`sitemap.xml: ${u} 에 해당하는 파일 없음`); else inMap.add(t);
  }
  for (const f of htmls) {
    const n = rel(f);
    if (n === 'index.html' || n.startsWith('recipes/') || n.startsWith('collections/')) { if (!inMap.has(f)) errors.push(`sitemap.xml 에 ${n} 이 빠짐`); }
  }

  // robots.txt · llms.txt
  const robots = fs.existsSync(path.join(ROOT, 'robots.txt')) ? fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8') : '';
  for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'Yeti']) if (!new RegExp(`User-agent: ${bot}\\nAllow: /`).test(robots)) errors.push(`robots.txt: ${bot} 허용 없음`);
  if (/^Disallow:\s*\S/m.test(robots)) errors.push('robots.txt: 막는 규칙이 있음');
  if (!robots.includes(`Sitemap: ${SITE}sitemap.xml`)) errors.push('robots.txt: sitemap 위치 없음');
  const llms = fs.existsSync(path.join(ROOT, 'llms.txt')) ? fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8') : '';
  if (!llms) errors.push('llms.txt 없음');
  for (const [, u] of llms.matchAll(/\((https:\/\/[^)]+)\)/g)) if (!toFile(u, path.join(ROOT, 'llms.txt'))) errors.push(`llms.txt: ${u} 에 해당하는 파일 없음`);

  // 비밀 값 검사 (저장소 전체)
  const SECRETS = [
    [/AKIA[0-9A-Z]{16}/, 'AWS 열쇠'], [/\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/, 'API 열쇠(sk-)'], [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub 토큰'],
    [/AIza[0-9A-Za-z_-]{35}/, 'Google API 열쇠'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '개인 키'], [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack 토큰'],
    [/(?:COUPANG|ANTHROPIC|OPENAI|YOUTUBE)_[A-Z_]*(?:KEY|SECRET|TOKEN)\s*[=:]\s*["']?[A-Za-z0-9]/, '환경변수 값'],
    [/(?:access|secret)[_-]?key["']?\s*[:=]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i, '열쇠 값'],
  ];
  for (const f of files) {
    if (rel(f) === 'tools/check-seo.mjs') continue; // 검사 규칙 자신은 제외
    if (/(^|\/)\.env(\.|$)/.test(rel(f))) { errors.push(`${rel(f)}: .env 파일이 저장소에 있음`); continue; }
    const s = fs.readFileSync(f, 'utf8');
    for (const [re, what] of SECRETS) if (re.test(s)) errors.push(`${rel(f)}: 비밀 값 의심 (${what})`);
  }

  const pages = htmls.filter((f) => rel(f) !== 'index.html').length;
  console.log(`검사: HTML ${htmls.length}개(새로 만든 페이지 ${pages}개), JSON-LD ${ldCount}개 [${Object.entries(types).map(([k, v]) => `${k} ${v}`).join(', ')}], 내부 링크 ${linkCount}개, sitemap 주소 ${locs.length}개, 비밀 값 검사 파일 ${files.length}개`);
  if (errors.length) { console.log(`❌ 문제 ${errors.length}개`); for (const e of errors) console.log('  - ' + e); return false; }
  console.log('✅ 문제 없음: JSON-LD 모두 정상, 내부 링크 모두 실제 파일, 비밀 값 없음');
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = check() ? 0 : 1;
