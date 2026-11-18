// CI 전용 정적 서버. posendy.com(Vercel) 과 같은 헤더로 site/ 를 내보낸다.
// 사용: node scripts/ci/static-server.mjs <폴더> <포트>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'site');
const port = Number(process.argv[3] || 8765);
http
  .createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const type = f.endsWith('.ps1') ? 'text/plain; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(f).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`serving ${root} on ${port}`));
