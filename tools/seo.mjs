#!/usr/bin/env node
// 한입레시피 검색 노출용 정적 페이지 생성기 (의존성 없음, Node 22)
// 실행: node tools/seo.mjs
// recipes.json 과 r/<id>.json 만 읽어서 아래를 매번 새로 만든다. 여러 번 돌려도 결과가 같다.
//   recipes/<id>/index.html, recipes/index.html, collections/<slug>/index.html, collections/index.html,
//   sitemap.xml, robots.txt, llms.txt, index.html 의 <!-- seo:start --> … <!-- seo:end --> 영역
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://kawaijin74-sudo.github.io/hanip-recipe/';
const SITE_NAME = '한입레시피';
const SITE_DESC = '유튜브 인기 요리 영상을 재료·양·추정 가격·단계별 영상 시점·팁·영양까지 정리한 레시피 모음. 냉장고 재료로 찾고 장보기까지 한 번에.';
const AFF_NOTE = '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
const MIN_COLLECTION = 3;

// ───────── 작은 도구들 ─────────
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, s) => { const f = path.join(ROOT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Math.round(n).toLocaleString('ko-KR');
const won = (n) => num(n) + '원';
const views = (n) => n == null ? '' : n >= 1e8 ? (n / 1e8).toFixed(1) + '억회' : n >= 1e4 ? (n / 1e4).toFixed(1) + '만회' : n + '회';
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const fmtQty = (q) => q == null ? '' : String(+(+q).toFixed(2));
const day = (iso) => String(iso || '').slice(0, 10);
const isoDur = (sec) => {
  if (!sec) return null;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '') + (s ? s + 'S' : '') || 'PT0S';
};
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; };
// 받침에 따라 조사 고르기: josa('두부조림','은','는')
const josa = (word, a, b) => {
  const w = String(word).replace(/\s*\(.*?\)\s*$/, '').trim();
  const c = w.charCodeAt(w.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return word + ((c - 0xac00) % 28 ? a : b);
  return `${word}${a}(${b})`;
};
// JSON-LD 는 </script> 로 끊기지 않게 < 를 이스케이프
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
// YouTube 썸네일 webp → 같은 이름의 jpg (카카오·네이버 미리보기 호환)
const jpgThumb = (u) => String(u || '').replace(/^https:\/\/i\.ytimg\.com\/vi_webp\/([\w-]+)\/(\w+)\.webp$/, 'https://i.ytimg.com/vi/$1/$2.jpg');
const ytWatch = (id, t) => `https://www.youtube.com/watch?v=${id}${t ? `&t=${t}s` : ''}`;

// ───────── 데이터 읽기 ─────────
const list = read('recipes.json');
const recipes = list.map((s) => {
  const d = read(`r/${s.id}.json`);
  const x = d.recipe;
  const price = x.ingredients.reduce((a, i) => a + (i.price_krw || 0), 0);
  return {
    id: s.id, d, x, video: d.video,
    title: x.title || s.title,
    summary: x.summary || '',
    minutes: x.cook_minutes ?? s.cook_minutes ?? null,
    servings: x.servings ?? s.servings ?? null,
    kcal: x.nutrition_per_serving?.kcal ?? s.kcal ?? null,
    price: price || s.total_price || null,
    tags: x.tags || s.tags || [],
    ingNames: x.ingredients.map((i) => i.name),
    views: d.video?.views ?? s.views ?? null,
    channel: d.video?.channel || s.channel || '',
    thumb: d.video?.thumbnail || s.thumbnail,
    created: d.created_at || s.created_at,
    aff: !!d.coupang_affiliate,
  };
});
const byId = Object.fromEntries(recipes.map((r) => [r.id, r]));
const byViews = (a, b) => (b.views || 0) - (a.views || 0) || a.id.localeCompare(b.id);
const lastmod = (items) => items.map((r) => day(r.created)).sort().at(-1) || '';

// ───────── 모음글 정의 (조건에 맞는 레시피가 3개 이상일 때만 만든다) ─────────
const tagHas = (r, ...ws) => r.tags.some((t) => ws.some((w) => t.includes(w)));
const ingHas = (r, ...ws) => r.ingNames.some((n) => ws.some((w) => n.includes(w)));
const perServing = (r) => r.price && r.servings ? r.price / r.servings : null;
const COLLECTIONS = [
  { slug: 'under-10000-won', emoji: '💰', name: '만원 이하 가성비 레시피', app: '#/c/CHEAP',
    test: (r) => r.price && r.price <= 10000, sort: (a, b) => a.price - b.price,
    intro: (it) => `재료비 합계(마트 가격 기준 추정)가 1만 원 이하인 레시피 ${it.length}개를 싼 순서로 모았어요. 가장 저렴한 ${josa(it[0].title, '은', '는')} 재료를 모두 사도 약 ${won(it[0].price)}이에요. 가격은 대략값이라 사는 곳과 시기에 따라 달라질 수 있어요.` },
  { slug: 'quick-20-minutes', emoji: '⏱', name: '20분 이내 빠른 요리', app: '#/c/QUICK',
    test: (r) => r.minutes && r.minutes <= 20, sort: (a, b) => a.minutes - b.minutes || byViews(a, b),
    intro: (it) => `조리 시간이 20분 이내인 레시피 ${it.length}개를 빠른 순서로 모았어요. 가장 빠른 ${josa(it[0].title, '은', '는')} 약 ${it[0].minutes}분이면 완성돼요. 조리 시간은 영상 내용을 바탕으로 정리한 값이에요.` },
  { slug: 'honbap', emoji: '🍚', name: '혼밥 레시피', app: '#/c/SOLO',
    test: (r) => tagHas(r, '혼밥') || r.servings === 1, sort: (a, b) => (perServing(a) ?? 1e9) - (perServing(b) ?? 1e9) || byViews(a, b),
    intro: (it) => { const p = it.filter(perServing); return `혼밥 태그가 붙었거나 1인분 기준인 레시피 ${it.length}개예요.${p.length ? ` 재료비를 인분으로 나눈 1인분 값이 싼 순서로 정렬했고, 가장 저렴한 ${josa(p[0].title, '은', '는')} 1인분 약 ${won(perServing(p[0]))}이에요.` : ''} 인분을 바꾸면 앱에서 재료 양과 가격이 함께 바뀌어요.`; } },
  { slug: 'anju', emoji: '🍶', name: '술안주 레시피', app: '#/c/LATE',
    test: (r) => tagHas(r, '술안주'), sort: byViews,
    intro: (it) => `술안주 태그가 붙은 레시피 ${it.length}개를 유튜브 조회수 순으로 모았어요. 원작 영상 조회수가 가장 많은 레시피는 ${it[0].title}(${it[0].channel}, 조회수 ${num(it[0].views)}회)이에요.` },
  { slug: 'diet', emoji: '🥗', name: '다이어트 레시피', app: '#/c/DIET',
    test: (r) => tagHas(r, '다이어트', '샐러드') || (r.kcal && r.kcal <= 450), sort: (a, b) => (a.kcal ?? 1e9) - (b.kcal ?? 1e9) || byViews(a, b),
    intro: (it) => `다이어트·샐러드 태그가 있거나 1인분 추정 열량이 450kcal 이하인 레시피 ${it.length}개를 열량이 낮은 순서로 모았어요. 가장 가벼운 ${josa(it[0].title, '은', '는')} 1인분 약 ${it[0].kcal}kcal예요. 열량은 재료로 계산한 추정값이에요.` },
  { slug: 'haejang-soup', emoji: '🍲', name: '해장·국물 요리', app: '#/c/HANGOVER',
    test: (r) => tagHas(r, '해장', '국물', '찌개') || r.tags.includes('국') || r.tags.includes('탕') || /찌개|(?<!그라)탕$/.test(r.title), sort: byViews,
    intro: (it) => `해장·국물요리 태그가 붙었거나 이름이 찌개·탕인 레시피 ${it.length}개를 조회수 순으로 모았어요. 조리 시간은 ${Math.min(...it.filter((r) => r.minutes).map((r) => r.minutes))}분부터 ${Math.max(...it.filter((r) => r.minutes).map((r) => r.minutes))}분까지 다양해요.` },
  { slug: 'noodles', emoji: '🍜', name: '면요리 레시피', app: '#/c/NOODLE',
    test: (r) => tagHas(r, '면요리') || /파스타|국수|라면|우동|소바|냉면|알리오/.test(r.title), sort: byViews,
    intro: (it) => `파스타·국수 같은 면요리 레시피 ${it.length}개를 조회수 순으로 모았어요.` },
  { slug: 'late-night', emoji: '🌙', name: '야식 레시피', app: '#/c/LATE',
    test: (r) => tagHas(r, '야식'), sort: byViews,
    intro: (it) => `야식 태그가 붙은 레시피 ${it.length}개를 조회수 순으로 모았어요. 1인분 추정 열량은 ${Math.min(...it.filter((r) => r.kcal).map((r) => r.kcal))}~${Math.max(...it.filter((r) => r.kcal).map((r) => r.kcal))}kcal예요.` },
  { slug: 'side-dishes', emoji: '🥢', name: '밑반찬·밥반찬 레시피', app: '#/c/SIDE',
    test: (r) => tagHas(r, '반찬'), sort: byViews,
    intro: (it) => `밑반찬·밥반찬 태그가 붙은 레시피 ${it.length}개를 조회수 순으로 모았어요.` },
  { slug: 'tofu', emoji: '🧈', name: '두부 요리', app: null,
    test: (r) => ingHas(r, '두부'), sort: byViews,
    intro: (it) => `재료에 두부가 들어가는 레시피 ${it.length}개를 조회수 순으로 모았어요. 남은 두부 한 모로 무엇을 할지 고를 때 참고하세요.` },
  { slug: 'pork', emoji: '🐷', name: '돼지고기 요리', app: null,
    test: (r) => r.ingNames.some((n) => /돼지|^삼겹살|^목살|^앞다리|^뒷다리/.test(n)), sort: byViews,
    intro: (it) => `재료에 돼지고기가 들어가는 레시피 ${it.length}개를 조회수 순으로 모았어요.` },
  { slug: 'chicken', emoji: '🍗', name: '닭고기 요리', app: null,
    test: (r) => r.ingNames.some((n) => /^닭|순살 닭|닭다리|닭가슴/.test(n)), sort: byViews,
    intro: (it) => `재료에 닭고기가 들어가는 레시피 ${it.length}개를 조회수 순으로 모았어요.` },
  { slug: 'mushroom', emoji: '🍄', name: '버섯 요리', app: null,
    test: (r) => ingHas(r, '버섯'), sort: byViews,
    intro: (it) => `재료에 버섯이 들어가는 레시피 ${it.length}개를 조회수 순으로 모았어요.` },
];
const collections = COLLECTIONS.map((c) => ({ ...c, items: recipes.filter(c.test).sort(c.sort) }))
  .filter((c) => c.items.length >= MIN_COLLECTION);
const collectionsOf = (r) => collections.filter((c) => c.items.includes(r));

// ───────── 공통 틀 ─────────
const CSS = `
:root{--bg:#fff;--soft:#f7f7f8;--ink:#1a1a1a;--sub:#8a8a8e;--line:#efeff1;--point:#ff5a1f;--point-soft:#fff2ec}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Pretendard Variable","Pretendard","Malgun Gothic",system-ui,sans-serif;letter-spacing:-.01em;-webkit-font-smoothing:antialiased;word-break:keep-all;overflow-wrap:anywhere}
a{color:inherit}
img{max-width:100%}
.top{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .in{max-width:1120px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.logo{font-size:21px;font-weight:800;text-decoration:none;color:var(--point);white-space:nowrap;letter-spacing:-.03em}
.top nav{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
.top nav a{padding:7px 12px;border-radius:999px;text-decoration:none;font-weight:600;color:#555;font-size:14px;white-space:nowrap}
.top nav a:hover{background:var(--soft)}
.wrap{max-width:760px;margin:0 auto;padding:18px 20px 60px}
.wide{max-width:1120px}
.crumb{font-size:13px;color:var(--sub);margin:0 0 12px;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:4px}
.crumb li:not(:last-child)::after{content:"›";margin-left:4px}
.crumb a{text-decoration:none}
h1{font-size:26px;line-height:1.3;letter-spacing:-.03em;margin:4px 0 8px}
h2{font-size:19px;letter-spacing:-.03em;margin:0 0 10px}
.lead{color:#444;margin:0 0 12px}
.sum3{background:var(--point-soft);border-radius:16px;padding:14px 18px;margin:14px 0;list-style:none}
.sum3 li{padding:2px 0;font-weight:600}
.sum3 b{color:var(--point)}
.video{position:relative;aspect-ratio:16/9;border-radius:16px;overflow:hidden;background:#000;margin:14px 0 0}
.video a,.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
.video img{width:100%;height:100%;object-fit:cover;opacity:.85}
.video .play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:68px;height:48px;border-radius:14px;background:#ff0000;color:#fff;display:grid;place-items:center;font-size:22px}
.box{border:1px solid var(--line);border-radius:16px;padding:18px;margin-top:14px}
.meta{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0;padding:0;list-style:none}
.meta li,.meta a{background:var(--soft);padding:4px 10px;border-radius:999px;font-size:13px;text-decoration:none}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:9px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--sub);font-weight:600;font-size:13px}
td.n{white-space:nowrap;text-align:right}
tfoot td{font-weight:800;border:0}
.total{color:var(--point);font-size:17px}
.buy{font-size:12px;color:#fff;background:#e52528;padding:2px 8px;border-radius:6px;text-decoration:none;white-space:nowrap}
.note{color:var(--sub);font-size:12px;margin:8px 0 0}
ol.steps{list-style:none;margin:0;padding:0;counter-reset:s}
ol.steps li{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);counter-increment:s}
ol.steps li:last-child{border:0}
ol.steps li::before{content:counter(s);flex:none;width:28px;height:28px;border-radius:50%;background:var(--point);color:#fff;display:grid;place-items:center;font-weight:700}
.t{color:var(--point);font-size:13px;font-weight:700;text-decoration:none}
.chips span{display:inline-block;font-size:12px;background:var(--soft);border-radius:6px;padding:1px 7px;margin:4px 4px 0 0}
ul.plain{margin:0;padding:0;list-style:none}
ul.plain li{padding:8px 0;border-bottom:1px solid var(--line)}
ul.plain li:last-child{border:0}
.faq h3{font-size:15px;margin:14px 0 4px}
.faq h3:first-of-type{margin-top:0}
.faq p{margin:0;color:#444}
.app{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.btn{display:inline-block;padding:10px 16px;border-radius:12px;background:var(--point);color:#fff;font-weight:700;text-decoration:none;font-size:14px}
.btn.ghost{background:var(--point-soft);color:var(--point)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px 12px}
.rc{text-decoration:none;display:flex;flex-direction:column;min-width:0}
.rc .th{position:relative;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:var(--soft);margin-bottom:8px}
.rc img{width:100%;height:100%;object-fit:cover;display:block}
.badge{position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.65);color:#fff;font-size:12px;font-weight:700;padding:3px 8px;border-radius:6px}
.rc b{font-size:15px;line-height:1.35}
.rc small{color:var(--sub);font-size:13px}
.rc p{margin:4px 0 0;font-size:13px;color:#555}
.cols{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.cl{display:block;border:1px solid var(--line);border-radius:16px;padding:16px;text-decoration:none}
.cl b{font-size:16px}.cl small{display:block;color:var(--sub);margin-top:4px}
footer{border-top:1px solid var(--line);color:var(--sub);font-size:12px;text-align:center;padding:28px 20px 40px;margin-top:30px}
@media (max-width:640px){
.top .in{padding:10px 16px;gap:6px}.top nav{margin-left:-8px;width:calc(100% + 8px);gap:0;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.top nav a{padding:6px 8px;font-size:13px}
.wrap{padding:14px 16px 40px}h1{font-size:22px}.box{padding:14px}
th,td{padding:8px 4px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}`;

const page = ({ rel, title, desc, canonical, image, type = 'website', body, jsonld = [], wide = false, extraHead = '' }) => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
${image ? `<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>${CSS}</style>
${extraHead}${jsonld.map(ld).join('\n')}
</head>
<body>
<header class="top"><div class="in">
  <a class="logo" href="${rel}">한입레시피</a>
  <nav><a href="${rel}">🏠 홈</a><a href="${rel}recipes/">📖 전체 레시피</a><a href="${rel}collections/">📚 모음글</a><a href="${rel}index.html#/find">🧊 재료로 찾기</a></nav>
</div></header>
<main class="wrap${wide ? ' wide' : ''}">
${body}
</main>
<footer>한입레시피 · 레시피 영상은 유튜브 공식 플레이어로 재생되며 조회수와 수익은 원작자에게 돌아갑니다.<br>
${AFF_NOTE}</footer>
</body>
</html>
`;

const crumbs = (rel, trail) => `<ol class="crumb">${trail.map(([name, href], i) => i === trail.length - 1
  ? `<li aria-current="page">${esc(name)}</li>` : `<li><a href="${href}">${esc(name)}</a></li>`).join('')}</ol>`;
const crumbLd = (trail) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, , url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })),
});

const facts = (r) => [r.minutes && `${r.minutes}분`, r.servings && `${r.servings}인분`, r.price && `약 ${won(r.price)}`, r.kcal && `${r.kcal}kcal`].filter(Boolean).join(' · ');
const card = (r, rel, badge = '') => `<a class="rc" href="${rel}recipes/${r.id}/">
  <div class="th"><img src="${esc(r.thumb)}" alt="${esc(r.title)} 완성 사진(유튜브 썸네일)" loading="lazy" width="320" height="180">${badge ? `<span class="badge">${esc(badge)}</span>` : ''}</div>
  <b>${esc(r.title)}</b><small>${esc(r.channel)} · ▶ ${views(r.views)}</small><small>${esc(facts(r))}</small></a>`;

// ───────── 레시피 상세 페이지 ─────────
function qtyText(i) {
  if (i.qty == null) return i.unit || '적당량';
  return fmtQty(i.qty) + (i.unit || '');
}
function ingLine(i) {
  const q = i.qty == null ? (i.unit || '') : qtyText(i);
  return q ? `${i.name} ${q}` : i.name;
}
function category(r) {
  const map = [['국물', '국·찌개·탕'], ['해장', '국·찌개·탕'], ['국', '국·찌개·탕'], ['면요리', '면요리'], ['밑반찬', '반찬'], ['밥반찬', '반찬'], ['샐러드', '샐러드'], ['술안주', '술안주'], ['야식', '야식']];
  for (const [w, c] of map) if (r.tags.some((t) => w === '국' ? t === w : t.includes(w))) return c;
  if (/찌개|(?<!그라)탕$/.test(r.title)) return '국·찌개·탕';
  return r.tags[0] || '요리';
}
function faqs(r) {
  const x = r.x, t = r.title, out = [];
  if (r.minutes) out.push([`${t} 조리 시간은 얼마나 걸리나요?`, `약 ${r.minutes}분 걸려요. 원작 영상(${r.channel})의 과정을 바탕으로 정리한 시간이에요.`]);
  if (r.price) {
    const priced = x.ingredients.filter((i) => i.price_krw).sort((a, b) => b.price_krw - a.price_krw);
    out.push([`${t} 재료비는 얼마인가요?`, `${r.servings ? r.servings + '인분 기준 ' : ''}재료 ${x.ingredients.length}가지를 모두 사면 약 ${won(r.price)}이에요.${priced[0] ? ` 가장 비싼 재료는 약 ${won(priced[0].price_krw)}인 ${josa(priced[0].name, '이에요', '예요')}.` : ''} 마트 가격을 바탕으로 추정한 대략값이라 실제와 다를 수 있어요.`]);
  }
  if (r.servings) out.push([`${josa(t, '은', '는')} 몇 인분인가요?`, `${r.servings}인분 기준 레시피예요.${r.price && r.servings > 1 ? ` 1인분으로 나누면 재료비는 약 ${won(r.price / r.servings)}이에요.` : ''} 한입레시피 앱에서 인분을 바꾸면 재료 양과 가격이 자동으로 다시 계산돼요.`]);
  const n = x.nutrition_per_serving;
  if (n?.kcal) out.push([`${t} 칼로리는 얼마인가요?`, `1인분 약 ${n.kcal}kcal로 추정돼요${n.protein_g != null ? ` (단백질 ${n.protein_g}g, 탄수화물 ${n.carbs_g}g, 지방 ${n.fat_g}g)` : ''}. 재료와 양으로 계산한 추정값이에요.`]);
  if (x.tools?.length) out.push([`${josa(t, '을', '를')} 만들 때 필요한 도구는 무엇인가요?`, `${josa(x.tools.join(', '), '이', '가')} 필요해요.`]);
  return out;
}
function related(r) {
  const scored = recipes.filter((o) => o !== r).map((o) => ({ o, n: o.tags.filter((t) => r.tags.includes(t)).length }))
    .filter((s) => s.n > 0).sort((a, b) => b.n - a.n || byViews(a.o, b.o)).map((s) => s.o);
  return scored.slice(0, 6);
}

function recipePage(r) {
  const { x, video, id } = r;
  const rel = '../../';
  const url = `${SITE}recipes/${id}/`;
  const title = `${r.title} 레시피 - 재료·만드는 법 | ${SITE_NAME}`;
  const desc = cut(`${r.summary} ${[r.minutes && `조리 ${r.minutes}분`, r.servings && `${r.servings}인분`, r.price && `재료비 약 ${won(r.price)}`, r.kcal && `1인분 ${r.kcal}kcal`].filter(Boolean).join(' · ')}`, 155);
  const ogImage = jpgThumb(r.thumb);
  const qa = faqs(r);
  const rels = related(r);
  const fill = rels.length < 4 ? [...recipes].filter((o) => o !== r && !rels.includes(o)).sort(byViews).slice(0, 4 - rels.length) : [];
  const cols = collectionsOf(r);
  const trail = [['홈', rel, SITE], ['전체 레시피', '../', `${SITE}recipes/`], [r.title, '', url]];
  const steps = x.steps || [];
  const secs = steps.map((s) => s.start_sec).filter((s) => s != null);
  const endOf = (s) => { const later = secs.filter((v) => v > s); return later.length ? Math.min(...later) : video.duration || null; };

  const recipeLd = {
    '@context': 'https://schema.org', '@type': 'Recipe',
    name: r.title,
    image: [...new Set([r.thumb, ogImage].filter(Boolean))],
    description: r.summary,
    author: { '@type': 'Person', name: r.channel },
    datePublished: day(r.created),
    ...(r.minutes ? { totalTime: isoDur(r.minutes * 60) } : {}),
    ...(r.servings ? { recipeYield: `${r.servings}인분` } : {}),
    recipeCategory: category(r),
    keywords: [r.title, ...r.tags].join(', '),
    recipeIngredient: x.ingredients.map(ingLine),
    ...(steps.length ? { recipeInstructions: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s.text, url: `${url}#step-${i + 1}`, ...(s.start_sec != null ? { video: { '@type': 'Clip', name: `${i + 1}단계`, startOffset: s.start_sec, ...(endOf(s.start_sec) ? { endOffset: endOf(s.start_sec) } : {}), url: ytWatch(id, s.start_sec) } } : {}) })) } : {}),
    ...(x.nutrition_per_serving ? { nutrition: { '@type': 'NutritionInformation', servingSize: '1인분',
      ...(x.nutrition_per_serving.kcal != null ? { calories: `${x.nutrition_per_serving.kcal} kcal` } : {}),
      ...(x.nutrition_per_serving.protein_g != null ? { proteinContent: `${x.nutrition_per_serving.protein_g} g` } : {}),
      ...(x.nutrition_per_serving.carbs_g != null ? { carbohydrateContent: `${x.nutrition_per_serving.carbs_g} g` } : {}),
      ...(x.nutrition_per_serving.fat_g != null ? { fatContent: `${x.nutrition_per_serving.fat_g} g` } : {}) } } : {}),
    ...(x.tools?.length ? { tool: x.tools.map((t) => ({ '@type': 'HowToTool', name: t })) } : {}),
    video: {
      '@type': 'VideoObject', name: video.title, description: cut(r.summary || video.title, 300),
      thumbnailUrl: [...new Set([r.thumb, ogImage].filter(Boolean))],
      contentUrl: ytWatch(id), embedUrl: `https://www.youtube.com/embed/${id}`,
      ...(video.duration ? { duration: isoDur(video.duration) } : {}),
      ...(video.views != null ? { interactionStatistic: { '@type': 'InteractionCounter', interactionType: { '@type': 'WatchAction' }, userInteractionCount: video.views } } : {}),
      author: { '@type': 'Person', name: r.channel },
    },
    isBasedOn: ytWatch(id),
    url,
  };
  const faqLd = qa.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) } : null;

  const n = x.nutrition_per_serving;
  const body = `${crumbs(rel, trail)}
<article>
<h1>${esc(r.title)} 레시피</h1>
<p class="lead">${esc(r.summary)}</p>
<ul class="sum3">
  <li>⏱ 조리 시간 <b>${r.minutes ? `약 ${r.minutes}분` : '영상에 안내 없음'}</b> · 🍽 ${r.servings ? `<b>${r.servings}인분</b> 기준` : '<b>인분 안내 없음</b>'}</li>
  <li>💰 재료비 합계 <b>${r.price ? `약 ${won(r.price)}` : '정보 없음'}</b>${r.price && r.servings > 1 ? ` (1인분 약 ${won(r.price / r.servings)})` : ''} · 재료 ${x.ingredients.length}가지</li>
  <li>🔥 칼로리 <b>${n?.kcal ? `1인분 약 ${n.kcal}kcal` : '정보 없음'}</b>${n?.protein_g != null ? ` · 단백질 ${n.protein_g}g` : ''}</li>
</ul>
<div class="video"><a href="${ytWatch(id)}" target="_blank" rel="noopener" data-yt="${id}" aria-label="${esc(r.title)} 영상 재생 (유튜브)"><img src="${esc(r.thumb)}" alt="${esc(video.title)}" width="640" height="360"><span class="play">▶</span></a></div>
<p class="note">원작: <a href="${ytWatch(id)}" target="_blank" rel="noopener">${esc(r.channel)} 유튜브 「${esc(video.title)}」</a>${video.views != null ? ` · 조회수 ${num(video.views)}회` : ''}${video.duration ? ` · 영상 길이 ${mmss(video.duration)}` : ''}. 영상은 유튜브 공식 플레이어로 재생되며 조회수와 수익은 원작자에게 돌아갑니다.</p>
<ul class="meta">${r.minutes ? `<li>⏱ ${r.minutes}분</li>` : ''}${(x.tools || []).map((t) => `<li>🍳 ${esc(t)}</li>`).join('')}</ul>

<section class="box" id="ingredients"><h2>재료${r.servings ? ` <small style="color:var(--sub);font-weight:400;font-size:14px">${r.servings}인분</small>` : ''}</h2>
<table><thead><tr><th>재료</th><th>양</th><th class="n">추정 가격</th><th class="n">구매</th></tr></thead><tbody>
${x.ingredients.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(qtyText(i))}</td><td class="n">${i.price_krw ? won(i.price_krw) : '-'}</td><td class="n">${i.coupang_url ? `<a class="buy" href="${esc(i.coupang_url)}" target="_blank" rel="sponsored nofollow noopener">쿠팡</a>` : ''}</td></tr>`).join('\n')}
</tbody>${r.price ? `<tfoot><tr><td colspan="2">합계</td><td class="n total" colspan="2">약 ${won(r.price)}</td></tr></tfoot>` : ''}</table>
<p class="note">가격은 AI가 추정한 마트 기준 대략값이에요.${r.servings ? ` 인분을 바꾸려면 <a href="${rel}index.html#/r/${id}">앱에서 인분 조절</a>을 써 보세요.` : ''}</p>
${r.aff ? `<p class="note">${AFF_NOTE}</p>` : ''}
</section>

<section class="box" id="steps"><h2>만드는 법</h2>
${steps.length ? `<ol class="steps">
${steps.map((s, i) => `<li id="step-${i + 1}"><div>${s.start_sec != null ? `<a class="t" href="${ytWatch(id, s.start_sec)}" target="_blank" rel="noopener" data-s="${s.start_sec}">▶ 영상 ${mmss(s.start_sec)}</a>` : ''}
<p style="margin:0">${esc(s.text)}</p>${s.ingredients?.length ? `<div class="chips">${s.ingredients.map((g) => `<span>${esc(g)}</span>`).join('')}</div>` : ''}</div></li>`).join('\n')}
</ol>` : `<p style="margin:0">이 영상은 단계별 순서가 따로 정리되지 않았어요. <a href="${ytWatch(id)}" target="_blank" rel="noopener">원작 영상</a>에서 과정을 확인해 주세요.</p>`}
</section>

${x.tips?.length ? `<section class="box" id="tips"><h2>요리 팁</h2><ul class="plain">${x.tips.map((t) => `<li>💡 ${esc(t)}</li>`).join('')}</ul></section>` : ''}

${n ? `<section class="box" id="nutrition"><h2>영양성분 <small style="color:var(--sub);font-weight:400;font-size:14px">1인분 · 추정</small></h2>
<table><tbody>${[['열량', n.kcal, 'kcal'], ['단백질', n.protein_g, 'g'], ['탄수화물', n.carbs_g, 'g'], ['지방', n.fat_g, 'g']].filter((v) => v[1] != null).map(([k, v, u]) => `<tr><td>${k}</td><td class="n">${v}${u}</td></tr>`).join('')}</tbody></table></section>` : ''}

${r.tags.length ? `<section class="box" id="tags"><h2>태그</h2><ul class="meta">${r.tags.map((t) => `<li>#${esc(t)}</li>`).join('')}</ul>
${cols.length ? `<p class="note" style="margin-top:12px">이 레시피가 들어 있는 모음글</p><ul class="meta">${cols.map((c) => `<li><a href="${rel}collections/${c.slug}/" style="padding:0;background:none">${c.emoji} ${esc(c.name)}</a></li>`).join('')}</ul>` : ''}</section>` : ''}

${qa.length ? `<section class="box faq" id="faq"><h2>자주 묻는 질문</h2>
${qa.map(([q, a]) => `<h3>Q. ${esc(q)}</h3><p>${esc(a)}</p>`).join('\n')}
</section>` : ''}

<section class="box" id="app"><h2>인분 조절·재료로 찾기</h2>
<p style="margin:0">한입레시피 앱에서는 인분을 바꾸면 재료 양과 가격이 자동으로 계산되고, 단계를 누르면 영상이 그 시점부터 재생돼요. 냉장고에 있는 재료로 만들 수 있는 레시피도 찾아 드려요.</p>
<div class="app"><a class="btn" href="${rel}index.html#/r/${id}">앱에서 인분 조절하기</a><a class="btn ghost" href="${rel}index.html#/find">🧊 재료로 찾기</a></div>
</section>
</article>

${rels.length ? `<section style="margin-top:30px"><h2>‘${esc(r.tags.filter((t) => rels.some((o) => o.tags.includes(t))).slice(0, 2).join('’·‘'))}’ 관련 레시피</h2><div class="grid">${rels.map((o) => card(o, rel)).join('')}</div></section>` : ''}
${fill.length ? `<section style="margin-top:30px"><h2>다른 인기 레시피</h2><div class="grid">${fill.map((o) => card(o, rel)).join('')}</div></section>` : ''}
<script>
// 영상은 누를 때만 youtube-nocookie 플레이어를 불러온다 (자바스크립트가 없으면 유튜브로 이동)
(function(){var v=document.querySelector('[data-yt]');if(!v)return;var box=v.parentNode;
function load(s){var f=document.createElement('iframe');f.src='https://www.youtube-nocookie.com/embed/'+v.dataset.yt+'?autoplay=1&rel=0'+(s?'&start='+s:'');f.title=v.getAttribute('aria-label');f.allow='autoplay; encrypted-media; picture-in-picture';f.allowFullscreen=true;box.innerHTML='';box.appendChild(f);}
v.addEventListener('click',function(e){e.preventDefault();load(0);});
document.querySelectorAll('[data-s]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();load(+a.dataset.s);box.scrollIntoView({behavior:'smooth',block:'center'});});});})();
</script>`;
  return page({ rel, title, desc, canonical: url, image: ogImage, type: 'article', body,
    jsonld: [recipeLd, faqLd, crumbLd(trail)].filter(Boolean),
    extraHead: `<meta property="article:published_time" content="${esc(r.created)}">\n` });
}

// ───────── 전체 레시피 목록 ─────────
function recipesIndex() {
  const rel = '../', url = `${SITE}recipes/`;
  const items = [...recipes].sort(byViews);
  const trail = [['홈', rel, SITE], ['전체 레시피', '', url]];
  const title = `전체 레시피 ${items.length}개 - 유튜브 요리 영상 레시피 | ${SITE_NAME}`;
  const desc = `유튜브 인기 요리 영상 ${items.length}개를 재료·양·추정 가격·만드는 법으로 정리했어요. ${items.slice(0, 5).map((r) => r.title).join(', ')} 등.`;
  const body = `${crumbs(rel, trail)}
<h1>전체 레시피 <small style="color:var(--sub);font-size:15px">${items.length}개</small></h1>
<p class="lead">유튜브 요리 영상을 재료·양·추정 가격·단계별 영상 시점·팁·영양까지 정리한 레시피예요. 조회수가 많은 순서로 보여 드려요.</p>
<div class="grid">${items.map((r) => card(r, rel)).join('')}</div>
${collections.length ? `<section style="margin-top:30px"><h2>모음글</h2><div class="cols">${collections.map((c) => `<a class="cl" href="${rel}collections/${c.slug}/"><b>${c.emoji} ${esc(c.name)}</b><small>${c.items.length}개 레시피</small></a>`).join('')}</div></section>` : ''}`;
  const itemLd = { '@context': 'https://schema.org', '@type': 'ItemList', name: '전체 레시피', numberOfItems: items.length,
    itemListElement: items.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}recipes/${r.id}/`, name: r.title })) };
  return page({ rel, title, desc: cut(desc, 155), canonical: url, image: jpgThumb(items[0]?.thumb), body, wide: true, jsonld: [itemLd, crumbLd(trail)] });
}

// ───────── 모음글 ─────────
function collectionPage(c) {
  const rel = '../../', url = `${SITE}collections/${c.slug}/`;
  const trail = [['홈', rel, SITE], ['모음글', '../', `${SITE}collections/`], [c.name, '', url]];
  const intro = c.intro(c.items);
  const title = `${c.name} 모음 ${c.items.length}가지 | ${SITE_NAME}`;
  const others = collections.filter((o) => o !== c);
  const badge = (r) => c.slug === 'under-10000-won' ? (r.price ? `약 ${won(r.price)}` : '')
    : c.slug === 'quick-20-minutes' ? `${r.minutes}분` : c.slug === 'diet' ? (r.kcal ? `${r.kcal}kcal` : '')
    : c.slug === 'honbap' ? (perServing(r) ? `1인분 약 ${won(perServing(r))}` : '') : '';
  const body = `${crumbs(rel, trail)}
<h1>${c.emoji} ${esc(c.name)} <small style="color:var(--sub);font-size:15px">${c.items.length}가지</small></h1>
<p class="lead">${esc(intro)}</p>
<ol class="plain" style="list-style:none;padding:0;margin:18px 0 0">
${c.items.map((r, i) => `<li class="box" style="display:flex;gap:14px;align-items:flex-start;margin-top:12px">
<a href="${rel}recipes/${r.id}/" style="flex:none;width:38%;max-width:220px"><img src="${esc(r.thumb)}" alt="${esc(r.title)} 완성 사진(유튜브 썸네일)" loading="lazy" width="320" height="180" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:12px;display:block"></a>
<div style="min-width:0"><h2 style="font-size:17px;margin:0 0 4px"><a href="${rel}recipes/${r.id}/" style="text-decoration:none">${i + 1}. ${esc(r.title)}</a></h2>
<small style="color:var(--sub)">${esc(r.channel)} · ▶ ${views(r.views)}${badge(r) ? ` · <b style="color:var(--point)">${esc(badge(r))}</b>` : ''}</small>
<p style="margin:6px 0 0;font-size:14px;color:#444">${esc(cut(r.summary, 110))}</p>
<p class="note" style="margin-top:4px">${esc(facts(r))}</p></div></li>`).join('\n')}
</ol>
<p class="note" style="margin-top:14px">재료비와 열량은 레시피 재료로 계산한 추정값이에요.${c.app ? ` 앱에서 같은 분류 보기: <a href="${rel}index.html${c.app}">${esc(c.name)}</a>` : ''}</p>
${others.length ? `<section style="margin-top:30px"><h2>다른 모음글</h2><div class="cols">${others.map((o) => `<a class="cl" href="../${o.slug}/"><b>${o.emoji} ${esc(o.name)}</b><small>${o.items.length}개 레시피</small></a>`).join('')}</div></section>` : ''}`;
  const itemLd = { '@context': 'https://schema.org', '@type': 'ItemList', name: c.name, description: intro, numberOfItems: c.items.length,
    itemListElement: c.items.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}recipes/${r.id}/`, name: r.title })) };
  return page({ rel, title, desc: cut(intro, 155), canonical: url, image: jpgThumb(c.items[0].thumb), body, jsonld: [itemLd, crumbLd(trail)] });
}
function collectionsIndex() {
  const rel = '../', url = `${SITE}collections/`;
  const trail = [['홈', rel, SITE], ['모음글', '', url]];
  const title = `레시피 모음글 ${collections.length}개 - 가성비·빠른 요리·혼밥·술안주 | ${SITE_NAME}`;
  const desc = `${collections.map((c) => c.name).join(', ')}. 주제별로 골라 보는 유튜브 요리 레시피 모음이에요.`;
  const body = `${crumbs(rel, trail)}
<h1>📚 레시피 모음글</h1>
<p class="lead">주제별로 레시피를 골라 모았어요. 각 모음글은 레시피가 ${MIN_COLLECTION}개 이상일 때만 열려요.</p>
<div class="cols">${collections.map((c) => `<a class="cl" href="${c.slug}/"><b>${c.emoji} ${esc(c.name)}</b><small>${c.items.length}개 레시피 · ${esc(c.items.slice(0, 3).map((r) => r.title).join(', '))}</small></a>`).join('')}</div>`;
  const itemLd = { '@context': 'https://schema.org', '@type': 'ItemList', name: '레시피 모음글', numberOfItems: collections.length,
    itemListElement: collections.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}collections/${c.slug}/`, name: c.name })) };
  return page({ rel, title, desc: cut(desc, 155), canonical: url, body, jsonld: [itemLd, crumbLd(trail)] });
}

// ───────── index.html 정적 링크 영역 ─────────
function seoBlock() {
  const items = [...recipes].sort(byViews);
  const websiteLd = { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: SITE, inLanguage: 'ko', description: SITE_DESC };
  return `<!-- seo:start -->
<!-- 이 영역은 node tools/seo.mjs 가 자동으로 넣고 바꿉니다. 직접 고치지 마세요. -->
<style>
#seo-links{max-width:1120px;margin:0 auto;padding:10px 20px 30px;font-size:14px}
#seo-links h2{font-size:17px;margin:22px 0 10px;letter-spacing:-.03em}
#seo-links ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
#seo-links li a{display:inline-block;background:var(--soft,#f7f7f8);padding:6px 12px;border-radius:999px;text-decoration:none;color:#444}
#seo-links li a:hover{background:var(--point-soft,#fff2ec);color:var(--point,#ff5a1f)}
@media (max-width:820px){#seo-links{padding:6px 16px 20px}}
</style>
<section id="seo-links" aria-label="전체 레시피와 모음글">
<h2>📖 전체 레시피 <a href="recipes/" style="font-size:13px;color:var(--sub,#8a8a8e);font-weight:400">목록 보기 ›</a></h2>
<ul>${items.map((r) => `<li><a href="recipes/${r.id}/">${esc(r.title)} 레시피</a></li>`).join('')}</ul>
${collections.length ? `<h2>📚 모음글 <a href="collections/" style="font-size:13px;color:var(--sub,#8a8a8e);font-weight:400">전체 보기 ›</a></h2>
<ul>${collections.map((c) => `<li><a href="collections/${c.slug}/">${c.emoji} ${esc(c.name)} (${c.items.length})</a></li>`).join('')}</ul>` : ''}
</section>
${ld(websiteLd)}
<script>(function(){var s=document.getElementById('seo-links'),f=document.querySelector('footer');if(s&&f)f.parentNode.insertBefore(s,f);})();</script>
<!-- seo:end -->`;
}
function patchIndex() {
  const f = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(f, 'utf8');
  html = html.replace(/\n?<!-- seo:start -->[\s\S]*?<!-- seo:end -->\n?/g, '\n');
  const at = html.lastIndexOf('</body>');
  if (at < 0) throw new Error('index.html 에 </body> 가 없어요.');
  html = html.slice(0, at).replace(/\n*$/, '\n') + seoBlock() + '\n' + html.slice(at);
  fs.writeFileSync(f, html);
}

// ───────── sitemap · robots · llms ─────────
function sitemap() {
  const all = lastmod(recipes);
  const urls = [
    [SITE, all], [`${SITE}recipes/`, all], [`${SITE}collections/`, lastmod(collections.flatMap((c) => c.items)) || all],
    ...collections.map((c) => [`${SITE}collections/${c.slug}/`, lastmod(c.items)]),
    ...[...recipes].sort((a, b) => a.id.localeCompare(b.id)).map((r) => [`${SITE}recipes/${r.id}/`, day(r.created)]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `  <url><loc>${esc(u)}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}
const robots = () => `# 한입레시피 - 모든 검색엔진과 AI 수집기를 허용합니다.
User-agent: *
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Yeti
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Bingbot
Allow: /

Sitemap: ${SITE}sitemap.xml
`;
function llms() {
  const items = [...recipes].sort(byViews);
  return `# ${SITE_NAME}

> ${SITE_DESC}

한입레시피는 유튜브 요리 영상을 레시피로 정리한 한국어 사이트입니다. 레시피마다 재료와 양, 마트 기준 추정 가격, 단계별 영상 시점, 요리 팁, 1인분 추정 영양성분, 원작 유튜브 채널 출처가 있습니다. 가격과 영양성분은 추정값입니다. 재료의 쿠팡 링크는 쿠팡 파트너스 제휴 링크입니다.

- 홈: ${SITE}
- 전체 레시피: ${SITE}recipes/
- 모음글: ${SITE}collections/
- 사이트맵: ${SITE}sitemap.xml

## 레시피

${items.map((r) => `- [${r.title} 레시피](${SITE}recipes/${r.id}/): ${cut(r.summary, 120)} (${[facts(r), `원작 ${r.channel}`].filter(Boolean).join(' · ')})`).join('\n')}

## 모음글

${collections.map((c) => `- [${c.name}](${SITE}collections/${c.slug}/): ${cut(c.intro(c.items), 140)}`).join('\n')}
`;
}

// ───────── 실행 ─────────
for (const dir of ['recipes', 'collections']) fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
for (const r of recipes) write(`recipes/${r.id}/index.html`, recipePage(r));
write('recipes/index.html', recipesIndex());
for (const c of collections) write(`collections/${c.slug}/index.html`, collectionPage(c));
write('collections/index.html', collectionsIndex());
write('sitemap.xml', sitemap());
write('robots.txt', robots());
write('llms.txt', llms());
patchIndex();

console.log(`레시피 페이지 ${recipes.length}개, 모음글 ${collections.length}개 (${collections.map((c) => `${c.name} ${c.items.length}`).join(', ')})`);
console.log(`건너뛴 모음글(레시피 ${MIN_COLLECTION}개 미만): ${COLLECTIONS.filter((c) => !collections.some((o) => o.slug === c.slug)).map((c) => c.name).join(', ') || '없음'}`);

// 만든 결과를 바로 검사한다
const { check } = await import('./check-seo.mjs');
process.exitCode = check() ? 0 : 1;
