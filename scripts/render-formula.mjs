/* 单文件手帐页渲染器：把一支配方渲染成自包含 HTML（样式/图片全部内嵌） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLE = fs.readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8');
const THUMBS = path.join(ROOT, 'web', 'assets', 'thumbs');
/* 现成素材（The Met 版画缩略图 + Wikimedia Commons 公有领域花饰），见 web/assets/manifest.json */
const ORN = path.join(ROOT, 'web', 'assets', 'orn');
const ornSymbol = f => { try { return fs.readFileSync(path.join(ORN, f), 'utf8').trim(); } catch { return ''; } };
const GARDEN = path.join(ROOT, 'web', 'assets', 'garden');
/* 书后面那圈底图（印花图案），通过 CSS 变量注入到 style.css 的 body 背景里 */
const BGIMG = path.join(ROOT, 'web', 'assets', 'bg');
/* 素材只读，base64 结果常驻内存：HTTP 下每次 /f/<id> 都要重渲染，不能反复读盘编码。
   ponytail: 无上限、无失效机制。素材合计约 3MB，只改素材的开发期重启即生效。 */
const uriCache = new Map();
const dataURI = (p, mime) => {
  if (!uriCache.has(p))
    uriCache.set(p, fs.existsSync(p) ? `data:${mime};base64,${fs.readFileSync(p).toString('base64')}` : null);
  return uriCache.get(p);
};
const bgImageURI = () => dataURI(path.join(BGIMG, 'morris-sample.jpg'), 'image/jpeg');
/* 左页彩色底图：跟问卷的「香调」查表选图，不做任何计算（5 桶，均取自 The American Flora 1855 一卷） */
const GARDEN_FILES = { flower: 'flower.jpg', citrus: 'citrus.jpg', woody: 'woody.jpg', herbal: 'herbal.jpg', spicy: 'spicy.jpg' };
const ACCORD_TINT = {
  '花香调': 'flower',
  '果香调': 'citrus', '柑橘调': 'citrus', '美食调': 'citrus',
  '木质调': 'woody', '东方调': 'woody', '西普调': 'woody', '皮革调': 'woody',
  '芳草调': 'herbal', '绿叶调': 'herbal', '茶香调': 'herbal', '馥奇调': 'herbal', '水生调': 'herbal',
  '辛辣调': 'spicy', '动物调': 'spicy',
};
/* 书外面那圈底图跟着香调走的色调：不换图，只在印花上叠一层淡色。
   颜色跟着左页那张版画的主色走（玫瑰粉 / 苦橙金 / 夏栎橄榄 / 鸢尾灰紫 / 肉豆蔻肉桂） */
const BG_TINT = {
  flower: 'rgba(207, 156, 168, .20)',
  citrus: 'rgba(212, 170, 96, .20)',
  woody: 'rgba(150, 132, 96, .20)',
  herbal: 'rgba(150, 150, 172, .20)',
  spicy: 'rgba(168, 122, 100, .20)',
};
const normAccord = s => String(s).replace(/[（(].*?[)）]/g, '').trim();
function gardenTint(f) {
  for (const a of f.questionnaire?.accords ?? []) {
    const t = ACCORD_TINT[normAccord(a)];
    if (t) return t;
  }
  return 'flower';
}
const gardenURI = tint =>
  dataURI(path.join(GARDEN, GARDEN_FILES[tint] ?? GARDEN_FILES.flower), 'image/jpeg');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hash = str => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const layerCN = { top: '前调', heart: '中调', base: '后调' };
const matColor = (hue, s = 32, l = 58) => { if (hue > 275 && hue < 345) s *= .68; return `hsl(${hue} ${s}% ${l}%)`; };

/* 香调五行：低饱和、不浑浊的一套固定色（Gemini 定），未收录的香族回退到原料 hue */
const FAMILY_COLOR = {
  floral: '#b5838d', woody: '#9c7a69', citrus: '#c9a875',
  resin: '#b8977e', spicy: '#a86b67',
};
const familyColor = (family, fallback) => FAMILY_COLOR[family] ?? fallback;

/* 金字塔三调：极淡底 + 细描边 + 45° 版画排线（填充不再是实心大色块）。
   后调比原来压深一档：三层亮度 238 / 230 / 213，差 8 与 17 —— 原来 225 只差 5，三层看不出区别 */
const TIER_SKIN = {
  top: { fill: '#f4ede2', stroke: '#bda07e' },
  heart: { fill: '#f0e2e1', stroke: '#a36b73' },
  base: { fill: '#dcd0c2', stroke: '#8c766b' },
};

/* 金字塔三调用固定色阶（浅→深），原料色只留在配比环与原料表里 —— 见 style.css 的 --tier-* */

const DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="i-lozenge" viewBox="0 0 120 12">
      <path d="M0 6 H44 M76 6 H120" stroke="currentColor" stroke-width=".8"/>
      <path d="M60 1 L65 6 L60 11 L55 6 Z" fill="none" stroke="currentColor" stroke-width="1"/>
      <circle cx="60" cy="6" r="1.2" fill="currentColor"/>
      <circle cx="49.5" cy="6" r=".9" fill="currentColor"/><circle cx="70.5" cy="6" r=".9" fill="currentColor"/>
    </symbol>
    <symbol id="i-fleur" viewBox="0 0 24 26">
      <path d="M12 1 C13.6 4.6 12.9 7.6 10.6 10.2 C12.1 9.2 14.3 9.4 15.6 11 C14 11.9 12.4 11.8 11 10.9 C12.9 12.6 13.6 14.9 12.8 17.2 L11.2 17.2 C10.4 14.9 11.1 12.6 13 10.9 C11.6 11.8 10 11.9 8.4 11 C9.7 9.4 11.9 9.2 13.4 10.2 C11.1 7.6 10.4 4.6 12 1 Z" fill="currentColor"/>
      <path d="M12 17.6 C10 16.4 7.6 16.6 6 17.6 C8 18.4 9 19.6 9.2 21.2 C10.4 20 11.4 19.4 12 19.2 C12.6 19.4 13.6 20 14.8 21.2 C15 19.6 16 18.4 18 17.6 C16.4 16.6 14 16.4 12 17.6 Z" fill="currentColor"/>
      <rect x="10.6" y="17.4" width="2.8" height="1.4" rx=".5" fill="currentColor"/>
      <path d="M12 21.6 C11.4 23 10.8 24 10 24.8 C11.2 24.6 12 24 12 22.8 C12 24 12.8 24.6 14 24.8 C13.2 24 12.6 23 12 21.6 Z" fill="currentColor"/>
    </symbol>
    <symbol id="i-corner" viewBox="0 0 16 16">
      <path d="M1 15V1H15" fill="none" stroke="currentColor" stroke-width=".75"/>
      <path d="M4.2 4.2H11.8V11.8H4.2Z" fill="none" stroke="currentColor" stroke-width=".55"/>
      <circle cx="8" cy="8" r="1.4" fill="currentColor"/>
    </symbol>
    <symbol id="i-bloom" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
      <circle cx="8" cy="3.6" r="2.2" fill="none" stroke="currentColor" stroke-width=".9"/>
      <circle cx="11.8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width=".9"/>
      <circle cx="8" cy="12.4" r="2.2" fill="none" stroke="currentColor" stroke-width=".9"/>
      <circle cx="4.2" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width=".9"/>
    </symbol>
    <symbol id="i-leaf" viewBox="0 0 16 16">
      <path d="M8 1.4C11.7 4.6 12.6 9.6 8 14.6 3.4 9.6 4.3 4.6 8 1.4Z" fill="none" stroke="currentColor" stroke-width="1"/>
      <path d="M8 4.2V14" stroke="currentColor" stroke-width=".6"/>
    </symbol>
    <symbol id="i-drop" viewBox="0 0 16 16">
      <path d="M8 1.5c2.5 3.9 4.4 5.9 4.4 8.2a4.4 4.4 0 0 1-8.8 0C3.6 7.4 5.5 5.4 8 1.5Z" fill="none" stroke="currentColor" stroke-width="1"/>
    </symbol>
    <symbol id="i-spark" viewBox="0 0 16 16">
      <path d="M8 1.2 9.4 6.6 14.8 8 9.4 9.4 8 14.8 6.6 9.4 1.2 8 6.6 6.6Z" fill="none" stroke="currentColor" stroke-width=".9"/>
    </symbol>
    ${ornSymbol('corner.svg')}
    ${ornSymbol('flourish.svg')}
  </defs>
</svg>`;

/* 香族 → 小植物标（木香/树脂用叶，花香用花，柑橘用水滴，辛辣用芒星） */
const FAMILY_ICON = { floral: 'i-bloom', woody: 'i-leaf', citrus: 'i-drop', resin: 'i-leaf', spicy: 'i-spark' };
const familyIcon = family => FAMILY_ICON[family] ?? 'i-leaf';
const h4Orn = '<svg class="h4-orn" viewBox="0 0 1920 620.4" aria-hidden="true"><use href="#i-flourish"/></svg>';

/* 单页古典金框 + 四角版画角花 */
const pageFrame = `
      <div class="page-frame" aria-hidden="true">
        <svg class="pf-corner tl" viewBox="0 0 205 205"><use href="#i-corner-orn"/></svg>
        <svg class="pf-corner tr" viewBox="0 0 205 205"><use href="#i-corner-orn"/></svg>
        <svg class="pf-corner bl" viewBox="0 0 205 205"><use href="#i-corner-orn"/></svg>
        <svg class="pf-corner br" viewBox="0 0 205 205"><use href="#i-corner-orn"/></svg>
      </div>`;

function thumbURI(key) {
  return dataURI(path.join(THUMBS, `${key}.jpg`), 'image/jpeg');
}

function botanicals(f) {
  const fams = new Set(['top', 'heart', 'base'].flatMap(k => (f.materials_detail?.[k] ?? []).map(m => m.family)));
  const pick = cands => cands.find(c => fs.existsSync(path.join(THUMBS, `${c}.jpg`)));
  return {
    tl: pick(['plate-rose', 'florilegium', 'plate-jasmine']) ?? 'plate-rose',
    tr: pick([...fams].map(fm => ({ floral: 'plate-jasmine', tea: 'plate-tea', tobacco: 'plate-tobacco', woody: 'florilegium', resin: 'plate-crown' }[fm])).filter(Boolean)) ?? 'plate-iris',
  };
}

/* 金字塔：三层梯形 + 极细描边 + 45° 版画排线（浅底，不做实心大色块） */
function pyramidSVG(f) {
  const W = 340, H = 300, pad = 8, gap = 6;
  const ws = ['top', 'heart', 'base'].map(k => f.layers[k].weight);
  const total = ws.reduce((a, b) => a + b, 0) || 100;
  let y = pad, prevBottom = 92, out = '';
  ['top', 'heart', 'base'].forEach((k, i) => {
    const h = (H - 2 * pad - 2 * gap) * ws[i] / total;
    const topW = i === 0 ? 92 : prevBottom;
    const botW = 92 + (W - 2 * pad - 92) * ((ws.slice(0, i + 1).reduce((a, b) => a + b, 0)) / total);
    prevBottom = botW;
    const cx = W / 2;
    const pts = `${cx - topW / 2},${y} ${cx + topW / 2},${y} ${cx + botW / 2},${y + h} ${cx - botW / 2},${y + h}`;
    out += `<polygon class="seg" data-tip="${layerCN[k]}层 · 全瓶的 ${ws[i]}%" points="${pts}" fill="${TIER_SKIN[k].fill}" stroke="url(#g-gold)"/>
      <polygon class="seg-hatch" points="${pts}" fill="url(#p-hatch)"/>
      <path class="tier-diamond" d="M${cx} ${y - 3.2} L${cx + 3.2} ${y} L${cx} ${y + 3.2} L${cx - 3.2} ${y} Z"/>`;
    const ty = y + h / 2 + 4;
    /* 字号是在 viewBox 用户单位里给的：金字塔实际只渲染到 ~248px 宽（缩放 0.73×），
       所以 11 单位只有 8px、9 单位只有 6.6px。这里按「缩放后 ≥10px」反推。 */
    if (h > 46) out += `<text x="${cx}" y="${ty}" text-anchor="middle" font-size="14" font-weight="500" letter-spacing="3">${layerCN[k]}</text>
      <text x="${cx}" y="${ty + 20}" text-anchor="middle" font-size="16" fill="#8c766b">${ws[i]}%</text>`;
    else out += `<text x="${cx}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="14">${layerCN[k]} ${ws[i]}%</text>`;
    y += h + gap;
  });
  const defs = `<defs>
      <pattern id="p-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#c4a482" stroke-width="0.6" stroke-opacity="0.4"/></pattern>
      <linearGradient id="g-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4a67f"/><stop offset=".5" stop-color="#e8d8c3"/><stop offset="1" stop-color="#9e7e56"/></linearGradient>
    </defs>`;
  return `<svg id="sp-pyramid" viewBox="0 0 ${W} ${H}" role="img" aria-label="气味金字塔">${defs}${out}</svg>`;
}

/* 配比环 */
function arc(cx, cy, r, w, a0, a1, fill, tip) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (a, rr) => `${cx + rr * Math.cos(a)} ${cy + rr * Math.sin(a)}`;
  const d = `M${p(a0, r)}A${r} ${r} 0 ${large} 1 ${p(a1, r)}L${p(a1, r - w)}A${r - w} ${r - w} 0 ${large} 0 ${p(a0, r - w)}Z`;
  return `<path d="${d}" fill="${fill}" stroke="#fcfbf9" stroke-width="1.5" data-tip="${tip}"/>`;
}
function donutSVG(f) {
  const cx = 110, cy = 110, R = 75, ring = 25;
  const segs = [];
  for (const k of ['top', 'heart', 'base'])
    for (const m of f.materials_detail?.[k] ?? [])
      segs.push({ ...m, global: m.pct * f.layers[k].weight / 10000, layer: k });
  let a = -Math.PI / 2, out = '';
  for (const s of segs) {
    const a1 = a + s.global * Math.PI * 2;
    out += arc(cx, cy, R, ring, a, a1, familyColor(s.family, matColor(s.hue, 30, 62)),
      `${layerCN[s.layer]} · ${esc(s.name)}<br><b>${s.pct}%</b>（层内） / ${(s.global * 100).toFixed(1)}%（全瓶）<br>[${esc(s.family_zh)}]`);
    a = a1;
  }
  const rim = 'rgba(200,181,168,';
  out += `<circle cx="${cx}" cy="${cy}" r="${R - ring - 1.5}" fill="none" stroke="${rim}.8)" stroke-width=".8"/>
    <circle cx="${cx}" cy="${cy}" r="${R + 2}" fill="none" stroke="${rim}.8)" stroke-width=".8"/>
    <circle cx="${cx}" cy="${cy}" r="${R + 6}" fill="none" stroke="rgba(196,166,127,.5)" stroke-width=".5" stroke-dasharray="0.5 4"/>`;
  /* 日晷主刻度：只有 12/3/6/9 点伸出 */
  for (let d = 0; d < 360; d += 90) {
    const rad = (d - 90) * Math.PI / 180;
    out += `<line x1="${cx + (R + 4.5) * Math.cos(rad)}" y1="${cy + (R + 4.5) * Math.sin(rad)}" x2="${cx + (R + 8) * Math.cos(rad)}" y2="${cy + (R + 8) * Math.sin(rad)}" stroke="rgba(196,166,127,.75)" stroke-width=".5"/>`;
  }
  /* viewBox 裁到内容本身（环 + 外圈刻度最远到 110±83），原来留了 27 单位空白，白白缩小 28% */
  return {
    svg: `<svg id="sp-donut" viewBox="24 24 172 172" role="img" aria-label="配比环">${out}</svg>`,
    n: segs.length,
    /* 图例：全瓶占比原来只藏在悬停提示里，触屏点不出来 —— 补成看得见的列表 */
    legend: segs.map(s => ({
      name: s.name,
      color: familyColor(s.family, matColor(s.hue, 30, 62)),
      pct: (s.global * 100).toFixed(1),
      layer: layerCN[s.layer],
    })),
  };
}

function famBlock(f) {
  const fams = new Map();
  for (const k of ['top', 'heart', 'base'])
    for (const m of f.materials_detail?.[k] ?? []) {
      const g = m.pct * f.layers[k].weight / 10000;
      const e = fams.get(m.family_zh) ?? { pct: 0, hx: 0, hy: 0, family: m.family };
      e.pct += g; e.hx += Math.cos(m.hue * Math.PI / 180) * g; e.hy += Math.sin(m.hue * Math.PI / 180) * g;
      fams.set(m.family_zh, e);
    }
  const arr = [...fams].sort((a, b) => b[1].pct - a[1].pct);
  const hueOf = e => ((Math.atan2(e.hy, e.hx) * 180 / Math.PI) + 360) % 360;
  const colorOf = e => familyColor(e.family, matColor(hueOf(e), 30, 64));
  const bar = arr.map(([zh, e]) =>
    `<i style="width:${(e.pct * 100).toFixed(1)}%;--c:${colorOf(e)}" data-tip="${esc(zh)}香族 · 全瓶的 ${(e.pct * 100).toFixed(1)}%"></i>`).join('');
  const lg = arr.map(([zh, e]) =>
    `<span><b style="--c:${colorOf(e)}"></b>${esc(zh)} ${(e.pct * 100).toFixed(1)}%</span>`).join('');
  return { bar, lg };
}

function matsHTML(f) {
  return ['top', 'heart', 'base'].map(k => {
    const ms = f.materials_detail?.[k] ?? [];
    return `<div class="mat-layer"><h4><span>${layerCN[k]}之部</span><span class="lw">${f.layers[k].weight}% of flask</span></h4>${h4Orn}` +
      ms.map(m => `<div class="mat-row">
        <span class="mname"><svg class="mi" viewBox="0 0 16 16" aria-hidden="true"><use href="#${familyIcon(m.family)}"/></svg>${esc(m.name)}</span>
        <span class="dots" aria-hidden="true"></span>
        <span class="pct">${m.pct}%</span>
        <span class="fam-tag">${esc(m.family_zh)}</span></div>`).join('') + `</div>`;
  }).join('');
}

export function renderFormulaHTML(f) {
  const h = hash(f.id);
  const b = botanicals(f);
  const tlURI = thumbURI(b.tl), trURI = thumbURI(b.tr);
  const gTint = gardenTint(f);
  const gURI = gardenURI(gTint);
  const bgURI = bgImageURI();
  const donut = donutSVG(f);
  const fam = famBlock(f);
  const date = (f.created_at ?? '').slice(0, 10);
  const stamps = f.questionnaire.accords.map((a, i) =>
    `<span class="stamp" style="--sr:${(((h >> (i * 3)) % 90) - 45) / 14}deg">${esc(a)}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>「${esc(f.formula_name)}」· 香遇手帐</title>
<link rel="preconnect" href="https://fonts.loli.net" crossorigin>
<link href="https://fonts.loli.net/css2?family=Noto+Serif+SC:wght@400;600;900&family=Ma+Shan+Zheng&family=Cinzel:wght@500;600&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&display=swap" rel="stylesheet">
<style>
${STYLE}
</style>
${bgURI ? `<style>:root{--bg-img:url(${bgURI});--bg-tint:${BG_TINT[gTint] ?? 'transparent'}}</style>` : ''}
</head>
<body>
${DEFS}
<section id="spread" class="view">
  <div class="book">
    <div class="gutter"></div>
    <article class="page page-left paper">
      <div class="garden garden-${gTint}"${gURI ? ` style="background-image:url(${gURI})"` : ''}></div>${pageFrame}
      <div class="page-head">
        <svg class="ph-rule" viewBox="0 0 120 12"><use href="#i-lozenge"/></svg>
        <span class="ph-no">档案 № ${esc(f.id.slice(-6))}</span>
        <span class="ph-date">${esc(date)}</span>
      </div>
      <div class="left-grid">
        <div class="cartouche"><h2 class="fn-title">${esc(f.formula_name)}</h2></div>
        <div class="fn-side">
          <div class="stamps">${stamps}</div>
          <div class="orient">${esc(f.questionnaire.orientation)}</div>
          <div class="parfumeur">调香师 · ${esc(f.artist)}</div>
          ${f.mood_words?.length ? `<p class="anno anno-mood">「${esc(f.mood_words.join(' '))}」</p>` : ''}
        </div>
        <div class="question-copy">问：此香以何气味为本？ 答：<b>${f.questionnaire.accords.map(esc).join('、')}</b>，取向<b>${esc(f.questionnaire.orientation)}</b>。三层之重量分配为 前 ${f.layers.top.weight}% · 中 ${f.layers.heart.weight}% · 后 ${f.layers.base.weight}%。</div>
        <div class="fam-block">
          <h5>香族构成 <em>Composition des Familles</em></h5>${h4Orn}
          <div class="fam-bar">${fam.bar}</div>
          <div class="fam-legend">${fam.lg}</div>
        </div>
        <p class="anno anno-underline">抄录校验于提交之时 · 层内百分比合计 100%</p>
      </div>
      <div class="page-foot">Scentfolio · ${esc(date)}</div>
    </article>
    <article class="page page-right paper">
      <div class="botanical tr"${trURI ? ` style="background-image:url(${trURI})"` : ''}></div>${pageFrame}
      <div class="page-head right">
        <span class="ph-no">配方誊本 · Formule</span>
        <svg class="ph-rule" viewBox="0 0 120 12"><use href="#i-lozenge"/></svg>
      </div>
      <div class="right-grid">
        <div class="pyr-wrap">
          <div class="pyr-box">${pyramidSVG(f)}</div>
          <div class="donut-wrap">
            <div class="donut-ring">
              ${donut.svg}
              <div class="donut-center"><span>香精</span><span>${donut.n} 味原料</span></div>
            </div>
            <ul class="donut-legend">${donut.legend.map(x =>
              `<li><i style="--c:${x.color}"></i><span>${esc(x.name)}</span><b>${x.pct}%</b></li>`).join('')}</ul>
          </div>
        </div>
        <div class="mat-table">${matsHTML(f)}</div>
        <div class="story">
          <h3>气味说明书</h3>
          <p>${esc(f.story)}</p>
        </div>
      </div>
      <div class="page-foot">Scentfolio</div>
    </article>
  </div>
  <div class="tooltip" id="tip"></div>
</section>
<script>
const tip = document.getElementById('tip');
document.addEventListener('mousemove', e => {
  const t = e.target.closest?.('[data-tip]');
  if (t) { tip.innerHTML = t.dataset.tip; tip.classList.add('show');
    tip.style.left = Math.min(innerWidth - 300, e.clientX + 16) + 'px';
    tip.style.top = (e.clientY + 18) + 'px'; }
  else tip.classList.remove('show');
});
</script>
</body>
</html>
`;
}
