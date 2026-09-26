import './scripts/polyfill.mjs'; // 必须最先求值：给 Node 18 补 globalThis.crypto
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { renderFormulaHTML } from './scripts/render-formula.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FORMULAS_DIR = process.env.SCENTFOLIO_FORMULAS || path.join(ROOT, 'formulas');
const MATERIALS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'materials.json'), 'utf8')
).materials;
const NAME2MAT = new Map(MATERIALS.map(m => [m.name, m]));

export const ACCORDS = ['花香调', '果香调', '柑橘调', '木质调', '水生调', '美食调',
  '皮革调', '芳草调（药草）', '绿叶调', '动物调', '辛辣调', '东方调', '馥奇调',
  '西普调', '茶香调', '无'];
export const ORIENTATIONS = ['男香', '中性香', '女香'];

/** 档案文件名：14 位数字（YYYYMMDDHHMMSS）。HTTP 端 /f/<id> 也按此校验，防目录穿越。 */
export const ID_RE = /^\d{14}$/;

const QUESTIONNAIRE_TEXT =
`请你根据你自身的气味回答以下问题，以用于香水定制，在现实复刻你真实的气味：
1. 香调 —— 最多可选择三种；选择「无」时将不可选择其他香调。
   可选：${ACCORDS.join(' | ')}
2. 香味取向：${ORIENTATIONS.join(' | ')}
3. 香精（基）浓度 —— 自由填，5~100 的整数，指香精基占整瓶的百分比。
然后请从原料库中挑选原料，交出前调 / 中调 / 后调三层配方（各层内百分比合计 100%，
并给出三层各自的重量分配 weight，合计 100%），附一段这支香的气味说明书。`;

function suggest(name) {
  const sub = [...NAME2MAT.keys()].filter(k => k.includes(name) || name.includes(k)
    || [...name].some(ch => k.includes(ch) && '精油净油浸膏'.indexOf(ch) < 0));
  return [...new Set(sub)].slice(0, 5);
}

function validateFormula(body) {
  const errors = [];
  const { questionnaire, layers } = body;
  const acc = questionnaire.accords;
  if (acc.length === 0 || acc.length > 3) errors.push('香调必须选择 1~3 种');
  if (acc.includes('无') && acc.length > 1) errors.push('选择「无」时不可再选其他香调');
  for (const a of acc) if (!ACCORDS.includes(a)) errors.push(`未知香调：${a}`);
  if (!ORIENTATIONS.includes(questionnaire.orientation)) errors.push('香味取向必须是 男香/中性香/女香');
  const conc = body.concentration;
  if (typeof conc !== 'number' || !Number.isFinite(conc) || conc < 5 || conc > 100)
    errors.push(`香精（基）浓度必须是 5~100 的数字（收到：${String(conc)}）`);

  for (const [layerKey, cn] of [['top', '前调'], ['heart', '中调'], ['base', '后调']]) {
    const L = layers[layerKey];
    if (!L.materials.length) { errors.push(`${cn}层至少需要一种原料`); continue; }
    const sum = L.materials.reduce((s, x) => s + x.pct, 0);
    if (Math.abs(sum - 100) > 0.5) errors.push(`${cn}层原料百分比合计为 ${sum.toFixed(1)}%，应为 100%`);
    const names = new Set();
    for (const x of L.materials) {
      if (names.has(x.name)) errors.push(`${cn}层原料重复：${x.name}`);
      names.add(x.name);
      if (!NAME2MAT.has(x.name)) {
        const s = suggest(x.name);
        errors.push(`${cn}层原料不在库中：「${x.name}」${s.length ? `，近似原料：${s.join('、')}` : ''}`);
      }
      if (x.pct <= 0 || x.pct > 100) errors.push(`${cn}层 ${x.name} 的百分比非法：${x.pct}`);
    }
  }
  const wSum = layers.top.weight + layers.heart.weight + layers.base.weight;
  if (Math.abs(wSum - 100) > 0.5) errors.push(`三层 weight 分配合计为 ${wSum}%，应为 100%`);
  for (const k of ['top', 'heart', 'base'])
    if (layers[k].weight < 0) errors.push(`${k} 层 weight 不能为负`);
  if (!body.story || body.story.trim().length < 20) errors.push('story（气味说明书）至少 20 字');
  return errors;
}

/** 同一秒内并发提交会撞 id；往后挪一秒重试，保持 14 位格式不变。 */
function allocId() {
  const base = Date.now();
  for (let i = 0; i < 120; i++) {
    const id = new Date(base + i * 1000).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    if (!fs.existsSync(path.join(FORMULAS_DIR, `${id}.json`))) return id;
  }
  throw new Error('无法分配档案编号（同一分钟内提交过于密集）');
}

/** 只在 SCENTFOLIO_KEEP > 0 时裁剪，默认不动任何档案。 */
function pruneFormulas(keep) {
  if (!keep) return;
  const files = fs.readdirSync(FORMULAS_DIR).filter(f => /^\d{14}\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep)))
    for (const ext of ['.json', '.html'])
      fs.rmSync(path.join(FORMULAS_DIR, f.replace(/\.json$/, ext)), { force: true });
}

/** 把秒数说成人话：3600 → 「1 小时」，5400 → 「1 小时 30 分钟」，8 → 「8 秒」 */
function fmtSpan(sec) {
  if (sec < 60) return `${sec} 秒`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (!h) return `${m} 分钟`;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

/** 按时区给出可读的失效时刻 */
function fmtLocal(d) {
  return d.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * 建一个 MCP server 实例。
 * @param {object} opts
 * @param {string|null} opts.baseUrl 公开基址（如 https://example.com/mcp/scentfolio）。
 *   给了就走「只存 JSON + 返回在线 URL」；不给（本地 stdio）就落地 HTML 并返回文件路径。
 * @param {object|null} opts.stats 计数器（线上模式才有），记成功/失败调香次数
 */
export function buildServer({ baseUrl = null, formulasDir = FORMULAS_DIR, stats = null } = {}) {
  const server = new McpServer({ name: 'scentfolio', version: '0.3.0' });

  server.registerTool('get_questionnaire', {
    title: '获取调香问卷',
    description: '获取香水定制问卷。请 AI 以「自身的气味」为题认真作答，随后据此调香。返回题目与可选值。',
    inputSchema: {},
  }, async () => ({
    content: [{ type: 'text', text: QUESTIONNAIRE_TEXT }],
  }));

  server.registerTool('get_materials', {
    title: '查询香料原料库',
    description: '列出可用的真实香水原料（187 味）。可按香族(family，如 floral/woody/citrus)或关键词(keyword，中文子串)过滤；不传参数返回全部香族目录。',
    inputSchema: {
      family: z.string().optional().describe('香族英文名，如 citrus, floral, woody, musk…'),
      keyword: z.string().optional().describe('原料名中文子串，如 玫瑰、PX、精油'),
    },
  }, async ({ family, keyword }) => {
    let list = MATERIALS;
    if (!family && !keyword) {
      const fams = {};
      for (const m of MATERIALS) (fams[m.family] ??= { zh: m.family_zh, count: 0 }).count++;
      return { content: [{ type: 'text', text: '香族目录：\n' +
        Object.entries(fams).map(([en, v]) => `  ${en}（${v.zh}）× ${v.count}`).join('\n') +
        '\n用 family 或 keyword 参数取具体原料清单。' }] };
    }
    if (family) list = list.filter(m => m.family === family.toLowerCase());
    if (keyword) list = list.filter(m => m.name.includes(keyword));
    if (!list.length) return { content: [{ type: 'text', text: '没有匹配的原料。' }], isError: true };
    const text = list.map(m => `${m.name}　[${m.family_zh}]`).join('\n');
    return { content: [{ type: 'text', text: `${list.length} 味：\n${text}` }] };
  });

  const layerSchema = z.object({
    weight: z.number().min(0).max(100).describe('该层在整瓶香精中的重量占比%，三层合计=100'),
    materials: z.array(z.object({
      name: z.string().describe('原料名，必须与原料库完全一致'),
      pct: z.number().min(0).max(100).describe('该原料在本层内占比%，本层合计=100'),
    })).describe('本层原料及层内百分比'),
  });

  server.registerTool('submit_formula', {
    title: '提交香水配方',
    description: '提交完整配方：问卷答案 + 前调/中调/后调三层配比 + 气味说明书。通过校验后生成一页自包含的单文件 HTML 手帐页（双击即开、可直接发送），并留存 json 档案。\n\n' + QUESTIONNAIRE_TEXT,
    inputSchema: {
      artist: z.string().describe('调香师（AI）的名号'),
      formula_name: z.string().describe('香水命名，中文佳'),
      questionnaire: z.object({
        accords: z.array(z.enum(ACCORDS)).min(1).max(3).describe('香调，1~3 种；「无」不可与其他同选'),
        orientation: z.enum(ORIENTATIONS),
      }),
      layers: z.object({ top: layerSchema, heart: layerSchema, base: layerSchema }),
      concentration: z.number().min(5).max(100)
        .describe('香精（基）浓度：香精基占整瓶的百分比，5~100 的整数，自由填'),
      story: z.string().describe('这支香的气味说明书文案（≥20 字）'),
      mood_words: z.array(z.string()).max(6).optional().describe('3~6 个气质关键词'),
    },
  }, async (body) => {
    const errors = validateFormula(body);
    if (errors.length) {
      stats?.bump('submit_fail');
      return { content: [{ type: 'text', text: '配方未通过校验：\n- ' + errors.join('\n- ') }], isError: true };
    }

    const id = allocId();
    const record = {
      id,
      created_at: new Date().toISOString(),
      ...body,
      materials_detail: Object.fromEntries(['top', 'heart', 'base'].map(k => [k,
        body.layers[k].materials.map(x => {
          const m = NAME2MAT.get(x.name);
          return { name: x.name, pct: x.pct, family: m.family, family_zh: m.family_zh, hue: m.hue };
        })])),
    };
    fs.mkdirSync(formulasDir, { recursive: true });
    // 线上模式的手帐有时效（默认 1 小时），到期由 http 层清掉；本地档案不带这个字段，永久保留
    const ttlSec = Number(process.env.SCENTFOLIO_TTL ?? 3600);
    const expiresAt = (baseUrl && ttlSec > 0) ? new Date(Date.now() + ttlSec * 1000) : null;
    if (expiresAt) record.expires_at = expiresAt.toISOString();

    const file = path.join(formulasDir, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    stats?.bump('submit_ok'); // 真正调香成功一次

    if (baseUrl) {
      // 服务端只留 2KB 的档案，658KB 的 HTML 由 /f/<id> 现算
      pruneFormulas(Number(process.env.SCENTFOLIO_KEEP) || 0);
      const page = `${baseUrl}/f/${id}`;
      const dl = `${baseUrl}/f/${id}.html?dl=1`;
      const keep = expiresAt
        ? '\n⚠ 本页 ' + fmtSpan(ttlSec) + '后失效（' + fmtLocal(expiresAt) + '），失效后链接就打不开了。' +
          '\n   要留存请让用户点这个链接下载到本地（自包含单文件，断网也能打开）：\n   ' + dl
        : '';
      return { content: [{ type: 'text',
        text: `✓ 「${body.formula_name}」已誊成一页手帐。\n档案编号 ${id}\n` +
          `手帐页（在线打开，可直接分享给人）：${page}${keep}\n` +
          `原始档案：${page}.json` }] };
    }

    const htmlFile = path.join(formulasDir, `${id}.html`);
    fs.writeFileSync(htmlFile, renderFormulaHTML(record));
    return { content: [{ type: 'text',
      text: `✓ 「${body.formula_name}」已誊成一页手帐。\n档案编号 ${id}\n手帐页（单文件 HTML，可直接打开或发送）：${htmlFile}\n原始档案：${file}` }] };
  });

  server.registerTool('list_formulas', {
    title: '查看手帐档案',
    description: '列出已收录的所有香水配方（按时间倒序）。',
    inputSchema: {},
  }, async () => {
    if (!fs.existsSync(formulasDir)) return { content: [{ type: 'text', text: '手帐还是空的。' }] };
    const recs = fs.readdirSync(formulasDir).filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(formulasDir, f), 'utf8')))
      .sort((a, b) => b.id.localeCompare(a.id));
    if (!recs.length) return { content: [{ type: 'text', text: '手帐还是空的。' }] };
    const text = recs.map(r => `${r.id}  「${r.formula_name}」 by ${r.artist}  ` +
      `[${r.questionnaire.accords.join('/')}] ${r.questionnaire.orientation}` +
      (baseUrl ? `  ${baseUrl}/f/${r.id}` : '')).join('\n');
    return { content: [{ type: 'text', text: `${recs.length} 支香水：\n${text}` }] };
  });

  return server;
}

export { FORMULAS_DIR };

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--http')) {
    const { startHttp } = await import('./scripts/http.mjs');
    await startHttp({ buildServer, formulasDir: FORMULAS_DIR });
  } else {
    const transport = new StdioServerTransport();
    await buildServer().connect(transport);
    console.error('[scentfolio] MCP server ready on stdio');
  }
}
