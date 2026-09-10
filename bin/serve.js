#!/usr/bin/env node
/*!
 * OpenCalcBook — 开发用静态服务器（零依赖）
 * 用法： node bin/serve.js [端口] | node bin/serve.js --port 5180
 * 说明： index.html 直接双击也能用；这个服务器只是方便局域网/手机预览。
 * License: MIT
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var ROOT = path.join(__dirname, '..');

// 端口解析：同时支持 `serve.js 5180` 与 `serve.js --port 5180` / `--port=5180`
function parsePort(argv) {
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    var m = /^--port(?:=(.*))?$/.exec(a);
    if (m) {
      var v = (m[1] !== undefined) ? m[1] : argv[i + 1];
      var n = parseInt(v, 10);
      if (n > 0 && n < 65536) return n;
      console.error('端口无效：' + a);
      process.exit(1);
    }
    if (/^\d+$/.test(a)) {
      var p = parseInt(a, 10);
      if (p > 0 && p < 65536) return p;
    }
  }
  return 5180;
}

var PORT = parsePort(process.argv.slice(2));

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

var server = http.createServer(function (req, res) {
  var pathname = decodeURIComponent(url.parse(req.url).pathname);
  if (pathname === '/') pathname = '/index.html';

  var abs = path.join(ROOT, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (abs.indexOf(ROOT) !== 0) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(abs, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(abs).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('OpenCalcBook 开发服务器已启动： http://127.0.0.1:' + PORT + '/');
  console.log('按 Ctrl+C 停止');
});
