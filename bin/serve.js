#!/usr/bin/env node
/*!
 * OpenCalcBook — 开发用静态服务器（零依赖）
 * 用法： node bin/serve.js [端口] [--host <地址>|--lan]
 * 说明： index.html 直接双击也能用；这个服务器只是方便局域网/手机预览。
 *
 * 绑定地址默认 127.0.0.1（仅本机）。需要从别的设备访问时显式指定：
 *   --lan            绑定 0.0.0.0，监听全部网卡（含 Tailscale、WLAN）
 *   --host <地址>     绑定指定地址，例如 --host 100.112.64.125（只走 Tailscale）
 * License: MIT
 */
'use strict';

var http = require('http');
var fs = require('fs');
var os = require('os');
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

// 绑定地址解析：默认仅本机；--lan 监听全部网卡；--host <地址> 指定网卡
function parseHost(argv) {
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--lan' || a === '-a') return '0.0.0.0';
    var m = /^--host(?:=(.*))?$/.exec(a);
    if (m) {
      var v = (m[1] !== undefined) ? m[1] : argv[i + 1];
      if (v && !/^--/.test(v)) return v;
      console.error('--host 缺少地址');
      process.exit(1);
    }
  }
  return '127.0.0.1';
}

var PORT = parsePort(process.argv.slice(2));
var HOST = parseHost(process.argv.slice(2));

// 列出本机所有可访问的 IPv4 地址，启动时打印出来，省得再去查 ipconfig
function localIPv4() {
  var out = [];
  var ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (name) {
    (ifs[name] || []).forEach(function (a) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name: name, addr: a.address });
    });
  });
  return out;
}

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

server.listen(PORT, HOST, function () {
  var exposed = HOST !== '127.0.0.1' && HOST !== 'localhost';
  console.log('OpenCalcBook 开发服务器已启动（只读静态服务）');
  console.log('');
  console.log('  本机      http://127.0.0.1:' + PORT + '/');
  if (exposed) {
    var addrs = localIPv4();
    if (HOST === '0.0.0.0') {
      addrs.forEach(function (a) {
        console.log('  ' + a.name.padEnd(9) + ' http://' + a.addr + ':' + PORT + '/');
      });
      if (!addrs.length) console.log('  （未发现其他网卡）');
    } else {
      console.log('  指定地址   http://' + HOST + ':' + PORT + '/');
    }
  }
  console.log('');
  if (exposed) {
    console.log('注意：已暴露到本机以外的网络，同网段设备可访问。');
    console.log('      这是只读服务、不校验身份；不需要时请用默认（仅本机）模式重启。');
  } else {
    console.log('当前仅本机可访问。要从别的设备访问（如 Tailscale / 手机）：');
    console.log('  node bin/serve.js ' + PORT + ' --lan');
  }
  console.log('');
  console.log('按 Ctrl+C 停止');
});
