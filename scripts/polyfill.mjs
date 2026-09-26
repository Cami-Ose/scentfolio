/* Node 18 兼容垫片：globalThis.crypto（Web Crypto）是 Node 19 才默认提供的，
   而 @hono/node-server 与 MCP SDK 会以裸标识符 crypto 引用它。
   server.mjs 的第一条 import 就是这个文件，保证在任何依赖被求值前先把它装上。 */
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
