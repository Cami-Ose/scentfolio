# 香遇手帐 · Scentfolio

让 AI 以「自身的气味」为题作答一份调香问卷，从 187 味真实香料里选料配方，最后交出一页**自包含的单文件 HTML 手帐**——双击即开，也能直接发给别人。

整个项目是一个 MCP server：AI 客户端挂上它就能调香，配方的结构校验、渲染、产出全部由工具完成。

---

## 它做什么

1. AI 调 `get_questionnaire`，以「自身的气味」为题作答（香调、取向）
2. 调 `get_materials` 从 187 味真实香料里选料
3. 调 `submit_formula` 交出三层配方（前调 / 中调 / 后调）与气味说明书
4. 通过校验后，得到一页手帐：样式与版画全部内嵌，没有任何外部依赖

---

## 快速开始

```bash
npm install
npm run demo      # 端到端跑一遍，生成一份配方和它的手帐页
```

`npm run demo` 会在 `formulas/` 下写出 `<编号>.json` 与 `<编号>.html`，用浏览器打开那个 HTML 即可。

### 挂进 AI 客户端（本地 stdio）

```json
{
  "mcpServers": {
    "scentfolio": {
      "command": "node",
      "args": ["/absolute/path/to/scentfolio/server.mjs"]
    }
  }
}
```

然后对 AI 说：

> 调用 scentfolio 的 `get_questionnaire`，以你自身的气味作答，查原料库，然后交一份配方。

### 跑成线上服务（Streamable HTTP）

```bash
PORT=5011 \
PUBLIC_BASE_URL=https://example.com/mcp/scentfolio \
SCENTFOLIO_FORMULAS=/var/lib/scentfolio/formulas \
node server.mjs --http
```

MCP 端点就是 `https://example.com/mcp/scentfolio`，客户端按 URL 形式接入。

线上模式下：

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `5011` | 监听端口（只绑回环，公网入口交给反向代理） |
| `PUBLIC_BASE_URL` | 无 | 公开基址。**设了它才进入线上模式**：手帐不落 HTML、返回在线链接 |
| `SCENTFOLIO_FORMULAS` | `./formulas` | 档案目录 |
| `SCENTFOLIO_TTL` | `3600` | 手帐有效期（秒），`0` 为永不过期 |
| `SCENTFOLIO_RATE` | `30` | 每 IP 每小时 `POST /mcp` 上限，`0` 为不限 |
| `SCENTFOLIO_KEEP` | `0` | 档案数量上限，超出后删最旧的；`0` 为不裁 |

线上路由：

| 路径 | 用途 |
|---|---|
| `POST /mcp/scentfolio` | MCP 端点 |
| `GET /mcp/scentfolio` | 浏览器打开时跳到介绍页 |
| `GET /f/<14位编号>` | 手帐页（现场渲染） |
| `GET /f/<编号>.html?dl=1` | 带 `Content-Disposition`，一键下载到本地 |
| `GET /f/<编号>.json` | 原始档案 |
| `GET /health` | 存活与档案数量（仅内网） |

反向代理记得关掉缓冲，否则 SSE 事件流会被截住：

```nginx
location /mcp/scentfolio {
    rewrite ^ /mcp break;
    proxy_pass http://127.0.0.1:5011;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    chunked_transfer_encoding off;
}
```

> **Node 18 用户注意**：MCP SDK 的 HTTP 适配层用到了 `globalThis.crypto`，而它是 Node 19 才默认提供的。项目里 `scripts/polyfill.mjs` 已经补上这个垫片（`server.mjs` 第一条 import 就是它），在 18 上可以直接跑。

---

## MCP 工具

| 工具 | 作用 |
|---|---|
| `get_questionnaire` | 领取问卷：香调（≤3 种）、香味取向 |
| `get_materials` | 查原料库，可按香族（`family`）或中文关键词（`keyword`）过滤；不传参返回香族目录 |
| `submit_formula` | 提交配方，通过后生成手帐页 |
| `list_formulas` | 列出已收录的档案（线上模式下服务端不长期留存，通常是空的） |

### 校验规则

结构级校验，不限制各层的香族归属：

- 香调 1~3 种，「无」不可与其他香调同选
- 取向必须是 男香 / 中性香 / 女香
- 每层至少一种原料，层内百分比合计 100%（±0.5）
- 三层 `weight` 合计 100%（±0.5）
- 原料名必须在库中，写错会给近似原料提示
- `story` 至少 20 字

---

## 手帐页的视觉

页面是双页书的形式：左页是植物版画与故事，右页是配方图表。

- **底图跟香调走**：问卷的香调查表选一张版画（5 桶），不做任何计算；书外那圈底纹也按同一张表叠一层同色系的淡色，内外一致
- **图表是现算的矢量图**：金字塔按三层 `weight` 定高度，圆环按香族的原料数量分配角度，配比表列出每味料的层内占比
- **样式全部内联**，`web/style.css` 是唯一的视觉源

手帐页的配色、排版、图表尺寸都由 `web/style.css` 里的 CSS 变量控制，可以直接改。

---

## 目录结构

```
server.mjs                 MCP server 入口（stdio / --http 双模式）
scripts/
  http.mjs                 线上模式的 HTTP 层（Streamable HTTP、时效、限流、下载）
  render-formula.mjs       单文件手帐渲染器（内联样式与图片）
  polyfill.mjs             Node 18 的 globalThis.crypto 垫片
  build-materials.mjs      由 data/pmt-source.txt 解析生成原料库
  fetch-met.mjs            重新下载 The Met 的公有领域素材
  preview.mjs              把某份档案渲染到本地，改样式时用
  smoke.mjs                端到端自测
data/
  materials.json           187 味原料库（生成物）
  pmt-source.txt           原料库原始文本
web/
  style.css                手帐页样式（唯一视觉源）
  assets/
    garden/                香调对应的植物版画（5 张）
    bg/                    书后的底纹
    orn/                   花饰（CC0）
    thumbs/                内嵌用的缩略图
    manifest.json          每条素材的出处与许可
formulas/                  生成的档案（已 gitignore）
```

---

## 素材来源

所有素材均为**公有领域或 CC0**，逐条的标题、作者、年代、来源页与许可见 `web/assets/manifest.json`。

- **香调版画**（`assets/garden/`）：*The American Flora*, Vol. 1（1855），Asa B. Strong，经 Biodiversity Heritage Library 扫描，来自 Wikimedia Commons。公有领域。
- **书后底纹**（`assets/bg/`）：William Morris and Company 壁纸样本册，Brooklyn Museum 藏品，经 Wikimedia Commons。公有领域。
- **花饰**（`assets/orn/`）：Wikimedia Commons。CC0。
- **缩略图**（`assets/thumbs/`）：The Metropolitan Museum of Art 开放获取（Open Access）藏品，由 `scripts/fetch-met.mjs` 下载，再用 System.Drawing 降采样为内嵌用尺寸。公有领域。

原图（约 24 MB）默认不纳入版本库，可由 `scripts/fetch-met.mjs` 重新下载；香调版画与底纹可直接从 `manifest.json` 里记录的来源页获取。

---

## 许可

代码以 [MIT](LICENSE) 发布。素材各自的许可见上一节与 `manifest.json`。
