import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 显式把环境变量传给子进程：SDK 默认只传一个白名单，SCENTFOLIO_FORMULAS 之类的会丢
const t = new StdioClientTransport({
  command: process.execPath,
  args: ['server.mjs'],
  env: { ...process.env },
});
const c = new Client({ name: 'smoke', version: '0.0.1' });
await c.connect(t);

const tools = await c.listTools();
console.log('tools:', tools.tools.map(x => x.name).join(', '));

const call = async (name, args) => {
  const r = await c.callTool({ name, arguments: args ?? {} });
  return (r.content?.[0]?.text ?? '').slice(0, 400);
};
console.log('\n[questionnaire]\n' + await call('get_questionnaire'));
console.log('\n[materials no-arg]\n' + await call('get_materials'));
console.log('\n[materials rose]\n' + await call('get_materials', { keyword: '玫瑰' }));

const good = {
  artist: '演示', formula_name: '测试配方',
  questionnaire: { accords: ['木质调', '东方调'], orientation: '中性香' },
  layers: {
    top: { weight: 20, materials: [{ name: '香柠檬精油', pct: 60 }, { name: '粉红胡椒精油', pct: 40 }] },
    heart: { weight: 35, materials: [{ name: '土耳其玫瑰净油', pct: 50 }, { name: '依兰精油 完全', pct: 30 }, { name: '鸢尾凝脂 15% lrone', pct: 20 }] },
    base: { weight: 45, materials: [{ name: '沉香精油 越南野生', pct: 40 }, { name: '龙涎酮ISO E Super', pct: 35 }, { name: '香兰素', pct: 25 }] },
  },
  story: '自测用的一支配方：柑橘先亮一下，玫瑰与鸢尾在中段慢慢铺开，最后落在沉香和香草的底子上，尾调带一点树脂的暖。',
  mood_words: ['自测', '树脂', '暖'],
};
console.log('\n[submit good]\n' + await call('submit_formula', good));

const bad = structuredClone(good);
bad.formula_name = '错误示范';
bad.layers.top.materials = [{ name: '香柠檬精油', pct: 50 }, { name: '不存在的玫瑰', pct: 40 }];
bad.questionnaire.accords = ['无', '花香调'];
bad.story = '太短';
console.log('\n[submit bad]\n' + await call('submit_formula', bad));
console.log('\n[list]\n' + await call('list_formulas'));
await t.close();
process.exit(0);
