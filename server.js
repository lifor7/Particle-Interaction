// 极简静态文件服务器 —— 用于本地运行 LIZI-3D(双击 file:// 无法加载本地 ESM 模块)
// 用法: node server.js  (默认端口 8123, 可 PORT=xxxx node server.js)
// 打开: http://localhost:8123/index.html
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = process.env.PORT || 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400); return res.end('Bad Request'); }
  if (urlPath === '/') urlPath = '/index.html';

  const fp = path.normalize(path.join(root, urlPath));
  if (!fp.startsWith(root)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log('Serving ' + root + '  ->  http://localhost:' + port + '/index.html');
});
