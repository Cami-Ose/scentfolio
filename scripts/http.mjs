/**
 * 远程 MCP 的 HTTP 层（Streamable HTTP，无状态）。
 *
 * 路由：
 *   POST /mcp            MCP 端点（客户端填 https://<域名>/mcp/scentfolio）
 *   GET  /f/<id>         手帐单文件 HTML（现场渲染）
 *   GET  /f/<id>.html    同上
 *   GET  /f/<id>.json    原始档案
 *   GET  /f/<id>?dl=1    强制下载到本地
 *   GET  /health         存活 + 已收录数量（部署核对用）
 *
 * 时效：档案里带 expires_at 的到期即被清掉（线上模式才有；本地档案不带，永不清）。
 * 只监听回环，公网入口一律由 nginx 反代；因此 X-Forwarded-For 可信。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { renderFormulaHTML } from './render-formula.mjs';

/* 与 server.mjs 的 allocId 保持一致：14 位数字，另允许 .html / .json 后缀 */
const FILE_RE = /^\/f\/(\d{14})(\.html|\.json)?$/;

const RATE_MAX = Number(process.env.SCENTFOLIO_RATE || 30); // 每 IP 每小时 POST /mcp 次数
const BODY_MAX = 256 * 1024;
const DEV = !process.env.PUBLIC_BASE_URL;

const hits = new Map(); // ip -> 时间戳数组

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

function rateOk(ip) {
  if (!RATE_MAX) return true;
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 3600_000);
  if (arr.length >= RATE_MAX) { hits.set(ip, arr); return false; }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [ip, arr] of hits) {
    const kept = arr.filter(t => t > cutoff);
    if (kept.length) hits.set(ip, kept); else hits.delete(ip);
  }
}, 300_000).unref();

function send(res, code, type, body, extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

const json = (res, code, obj, extra) =>
  send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj), extra);

const rpcError = (res, code, httpCode, msg) => json(res, httpCode,
  { jsonrpc: '2.0', error: { code, message: msg }, id: null });

/* ── 手帐失效后的说明页（比干巴巴的 404 友好） ─────────────── */
function noticePage(base, title, lines) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:#131314;color:#b2dfdb;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif">
<div style="max-width:440px;padding:40px 28px;text-align:center">
  <div style="font-family:Consolas,monospace;font-size:11px;letter-spacing:.3em;color:rgba(138,219,210,.45);margin-bottom:20px">
    // SCENTFOLIO
  </div>
  <div style="font-size:19px;color:#8adbd2;margin-bottom:18px">${title}</div>
  ${lines.map(t => `<p style="margin:0 0 10px;font-size:13px;line-height:1.9;color:rgba(178,223,219,.62)">${t}</p>`).join('')}
  <a href="${base}/" style="display:inline-block;margin-top:22px;
     font-family:Consolas,monospace;font-size:12px;color:rgba(138,219,210,.6);text-decoration:none;
     border:1px solid rgba(138,219,210,.2);border-radius:2px;padding:8px 16px">← 回到服务首页</a>
</div></body></html>`;
}

/** 只清带 expires_at 的档案；本地档案不带这个字段，永远不会被碰 */
function sweepExpired(dir) {
  let removed = 0;
  let files;
  try { files = fs.readdirSync(dir); } catch { return 0; }
  const now = Date.now();
  for (const f of files) {
    if (!/^\d{14}\.json$/.test(f)) continue;
    const p = path.join(dir, f);
    try {
      const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (rec.expires_at && Date.parse(rec.expires_at) < now) { fs.rmSync(p, { force: true }); removed++; }
    } catch { /* 读坏的档案不动它 */ }
  }
  return removed;
}

/** 下载时给个像样的文件名；中文走 filename*，另留一个纯 ASCII 兜底 */
function contentDisposition(id, name) {
  const ascii = `scentfolio-${id}.html`;
  const chinese = `香遇手帐-${String(name || '').replace(/[\\/:*?"<>|\s]/g, '').slice(0, 24) || id}.html`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(chinese)}`;
}

export async function startHttp({ buildServer, formulasDir }) {
  if (!formulasDir) throw new Error('startHttp 缺少 formulasDir');
  const port = Number(process.env.PORT || 5011);
  const host = process.env.HOST || '127.0.0.1';
  const baseUrl = (process.env.PUBLIC_BASE_URL || `http://${host}:${port}`).replace(/\/+$/, '');

  // 定时清过期档案（每 5 分钟一次）
  setInterval(() => {
    const n = sweepExpired(formulasDir);
    if (n) console.log(`[http] 清理过期手帐 ${n} 份`);
  }, 300_000).unref();

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    res.on('finish', () => console.log(
      `[http] ${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - t0}ms ${clientIp(req)}`));

    try {
      if (p === '/mcp') {
        /* 浏览器直接打开端点时跳到给人看的介绍页。
           AI 客户端用的是 POST，不受影响；本地开发态（无 PUBLIC_BASE_URL）不跳，方便调试。 */
        if ((req.method === 'GET' || req.method === 'HEAD') && baseUrl && !DEV) {
          res.writeHead(302, { Location: `${baseUrl}/`, 'Cache-Control': 'no-store' });
          return res.end();
        }
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          return rpcError(res, -32000, 405, '本服务为无状态模式，只接受 POST');
        }
        const len = Number(req.headers['content-length'] || 0);
        if (len > BODY_MAX) return rpcError(res, -32600, 413, '请求体过大');
        if (!rateOk(clientIp(req)))
          return rpcError(res, -32000, 429, `提交过于频繁，每小时上限 ${RATE_MAX} 次，请稍后再试`);

        const mcp = buildServer({ baseUrl, formulasDir });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => { transport.close().catch(() => {}); mcp.close().catch(() => {}); });
        await mcp.connect(transport);
        return void await transport.handleRequest(req, res);
      }

      if (p === '/health')
        return json(res, 200, { ok: true, formulas: countFormulas(formulasDir), base: baseUrl });

      const m = FILE_RE.exec(p);
      if (m && req.method === 'GET') {
        const [, id, ext] = m;
        const file = path.join(formulasDir, `${id}.json`);
        if (!fs.existsSync(file))
          return send(res, 404, 'text/html; charset=utf-8', noticePage(baseUrl, '没有这页手帐', [
            '这个编号不存在，或者它已经过期被清掉了。',
            '线上服务的手帐有 1 小时时效，过期后链接就无法再打开。',
          ]), { 'Cache-Control': 'no-store' });

        const rec = readRecord(file);
        if (rec.expires_at && Date.parse(rec.expires_at) < Date.now())
          return send(res, 410, 'text/html; charset=utf-8', noticePage(baseUrl, '这页手帐已过期', [
            '线上服务的手帐保留 1 小时，这条已经到期并已被清除。',
            '重新让 AI 调一次 submit_formula 就会生成新的。',
          ]), { 'Cache-Control': 'no-store' });

        // 档案一旦写入就不再变，但本地迭代时渲染器常改，开发态不缓存。
        const cache = DEV ? 'no-store' : 'public, max-age=600';
        const dl = url.searchParams.get('dl') != null;
        const dlHeader = dl ? { 'Content-Disposition': contentDisposition(id, rec.formula_name) } : {};

        if (ext === '.json')
          return send(res, 200, 'application/json; charset=utf-8', fs.readFileSync(file),
            { 'Cache-Control': `private, max-age=600`, ...dlHeader });
        if (ext === '.html')
          return send(res, 200, 'text/html; charset=utf-8', renderFormulaHTML(rec),
            { 'Cache-Control': cache, ...dlHeader });

        /* 相对跳转：挂载在路径下会正确补成 <挂载点>/f/<id>.html，独立跑也不出错 */
        res.writeHead(302, { Location: `${id}.html${dl ? '?dl=1' : ''}`, 'Cache-Control': 'no-store' });
        return res.end();
      }

      return send(res, 404, 'text/plain; charset=utf-8', '404');
    } catch (err) {
      console.error('[http] 处理失败', req.method, req.url, err);
      if (!res.headersSent) rpcError(res, -32603, 500, '服务器内部错误');
    }
  });

  server.headersTimeout = 120_000;
  server.requestTimeout = 0; // /mcp 的 SSE 是长连接，不能按普通请求超时掐断
  await new Promise((ok, no) => { server.once('error', no); server.listen(port, host, ok); });
  console.log(`[scentfolio] HTTP MCP ready  http://${host}:${port}/mcp`);
  console.log(`[scentfolio] 对外基址  ${baseUrl}   （手帐页 ${baseUrl}/f/<id>）`);
  return server;
}

function readRecord(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function countFormulas(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).length; } catch { return 0; }
}
