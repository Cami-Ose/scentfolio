import fs from 'node:fs';

const FAMILIES = {
  '柑橘': { en: 'citrus', hue: 50 },
  '青香': { en: 'green', hue: 105 },
  '茶香': { en: 'tea', hue: 80 },
  '芳香药草': { en: 'aromatic', hue: 130 },
  '果香': { en: 'fruity', hue: 22 },
  '花香': { en: 'floral', hue: 332 },
  '辛辣': { en: 'spicy', hue: 8 },
  '木香': { en: 'woody', hue: 28 },
  '树脂/香草': { en: 'resin', hue: 36 },
  '皮革': { en: 'leather', hue: 16 },
  '烟草': { en: 'tobacco', hue: 42 },
  '动物': { en: 'animalic', hue: 26 },
  '麝香': { en: 'musk', hue: 215 },
  '醛香': { en: 'aldehydic', hue: 198 },
  '海洋': { en: 'marine', hue: 190 },
  '酒香': { en: 'boozy', hue: 12 },
  '美食': { en: 'gourmand', hue: 38 },
};

const txt = fs.readFileSync(new URL('../data/pmt-source.txt', import.meta.url), 'utf8');
const materials = [];
let n = 0;
for (const rawLine of txt.split(/\r?\n/)) {
  const line = rawLine.trim();
  const idx = line.indexOf('：');
  if (idx < 0) continue;
  const fam = line.slice(0, idx);
  if (!FAMILIES[fam]) continue;
  const items = line.slice(idx + 1).split('|').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  items.forEach((name, i) => {
    const f = FAMILIES[fam];
    materials.push({
      id: 'm' + String(++n).padStart(3, '0'),
      name,
      family: f.en,
      family_zh: fam,
      hue: (f.hue + ((i % 7) - 3) * 4 + 360) % 360,
    });
  });
}

const seen = new Map();
for (const it of materials) {
  if (seen.has(it.name)) { console.error('DUPLICATE:', it.name); process.exit(1); }
  seen.set(it.name, 1);
}

fs.writeFileSync(new URL('../data/materials.json', import.meta.url),
  JSON.stringify({ generated_from: 'pmt-source.txt', count: materials.length, materials }, null, 2));
const byFam = {};
for (const it of materials) byFam[it.family_zh] = (byFam[it.family_zh] || 0) + 1;
console.log('total:', materials.length);
console.log(byFam);
