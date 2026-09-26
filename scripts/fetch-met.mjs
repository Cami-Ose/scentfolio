import fs from 'node:fs';

const UA = { headers: { 'User-Agent': 'ScentfolioPersonalArtProject/0.1 (local demo)' } };
const BASE = 'https://collectionapi.metmuseum.org/public/collection/v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ASSETS = [
  { file: 'plate-rose',     qs: ['rose Redoute', 'Roses plate', 'redouté roses'] },
  { file: 'plate-jasmine',  qs: ['jasminum', 'Jasminum grandiflorum', 'jasmine plant'] },
  { file: 'plate-iris',     qs: ['iris Les Liliacees', 'irid', 'iris botanical'] },
  { file: 'plate-lavender', qs: ['Lavandula', 'lavender plant', 'spurge olive'] },
  { file: 'plate-tobacco',  qs: ['Nicotiana', 'tobacco plant'] },
  { file: 'plate-tea',      qs: ['Thea viridis', 'tea plant', 'Camellia sinensis'] },
  { file: 'bottle',         qs: ['perfume bottle', 'bottle glass ornament'] },
  { file: 'ornament-exlibris', qs: ['ex libris', 'bookplate'] },
  { file: 'florilegium',    qs: ['Florilegium', 'Choix des plus belles fleurs', 'Les Liliacees'] },
];

const PROBE = process.argv.includes('--probe');

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, UA);
      if (r.ok) return await r.json();
      if (r.status === 403 || r.status === 429) { await sleep(3000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(2000); }
  }
  return null;
}

fs.mkdirSync('web/assets', { recursive: true });
const manifest = fs.existsSync('web/assets/manifest.json')
  ? JSON.parse(fs.readFileSync('web/assets/manifest.json', 'utf8')) : {};

nextTheme:
for (const { file, qs } of ASSETS) {
  if (manifest[file] && !PROBE) { console.log(`skip ${file} (已有)`); continue; }
  for (const q of qs) {
    await sleep(1200);
    const sr = await getJSON(`${BASE}/search?hasImage=true&q=${encodeURIComponent(q)}`);
    const ids = sr?.objectIDs ?? [];
    console.log(`? ${file} q="${q}" total=${sr?.total ?? 'ERR'}`);
    for (const id of ids.slice(0, PROBE ? 8 : 25)) {
      const o = await getJSON(`${BASE}/objects/${id}`);
      await sleep(900);
      if (!(o?.isPublicDomain ?? o?.publicDomain) || !o.primaryImage) continue;
      console.log(`  hit [${id}] ${o.title} — ${o.artistDisplayName ?? 'anon'} (${o.objectDate ?? ''})`);
      if (PROBE) continue nextTheme;
      const buf = Buffer.from(await (await fetch(o.primaryImage, UA)).arrayBuffer());
      const ext = o.primaryImage.match(/\.(jpg|jpeg|png)/i)?.[1] ?? 'jpg';
      fs.writeFileSync(`web/assets/${file}.${ext}`, buf);
      manifest[file] = {
        title: o.title, creator: o.artistDisplayName || 'Unknown', date: o.objectDate,
        source: 'The Metropolitan Museum of Art', page: o.objectURL,
        local: `assets/${file}.${ext}`, bytes: buf.length,
      };
      fs.writeFileSync('web/assets/manifest.json', JSON.stringify(manifest, null, 2));
      console.log(`✓ ${file} <- [${id}] ${(buf.length / 1024).toFixed(0)}KB`);
      continue nextTheme;
    }
  }
  console.log(`-- ${file}: 所有查询都无 PD 结果`);
}
