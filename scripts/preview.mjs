import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFormulaHTML } from './render-formula.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(ROOT, 'formulas');
const latest = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().at(-1);
const src = process.argv[2] ? path.resolve(process.argv[2]) : path.join(dir, latest ?? '');
if (!latest && !process.argv[2]) {
  console.error('formulas/ 里还没有档案，先 npm run demo 或指定 json 路径。');
  process.exit(1);
}
// 输出位置：第三个参数 > PREVIEW_OUT 环境变量 > 项目根下的 preview.html（已 gitignore）
const out = process.argv[3] || process.env.PREVIEW_OUT || path.join(ROOT, 'preview.html');
fs.writeFileSync(out, renderFormulaHTML(JSON.parse(fs.readFileSync(src, 'utf8'))));
console.log(`preview → ${out}　← ${src}`);
