// 本地开发服务器：静态文件 + /src/*.ts 即时转译（内存中，无构建产物、无压缩）。
// 浏览器 demo 直接以 ES Module 复用 src/ 的 TS 源。npm run web

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8080);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.hack': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/web/index.html';
    const abs = normalize(join(root, p));
    if (!abs.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (p.startsWith('/src/') && p.endsWith('.ts')) {
      const src = await readFile(abs, 'utf8');
      const out = ts.transpileModule(src, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText;
      res.writeHead(200, { 'content-type': MIME['.ts'], 'cache-control': 'no-cache' });
      res.end(out);
      return;
    }
    const data = await readFile(abs);
    res.writeHead(200, {
      'content-type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(port, () => {
  console.log(`nand-computer web demo: http://localhost:${port}`);
});
