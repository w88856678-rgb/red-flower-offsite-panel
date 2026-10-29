#!/usr/bin/env node
'use strict';

// Production server: only local devices on this computer can connect.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const APP_ID = 'red-flower-offsite-panel';
const INSTANCE_ID = crypto.createHash('sha256').update(__dirname).digest('hex').slice(0, 16);
const DIST = path.join(__dirname, 'dist');
const INDEX = path.join(DIST, 'index.html');
const HOST = '127.0.0.1';
const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const numericArg = args.find((arg) => /^\d+$/.test(arg));
const requestedPort = Number(portFlag >= 0 ? args[portFlag + 1] : (numericArg || process.env.PORT || '4173'));
const shouldOpen = args.includes('--open');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4',
};

function openBrowser(url) {
  if (!shouldOpen) return;
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const browserArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, browserArgs, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log('请手动在浏览器打开上面的地址。'));
  child.unref();
}

function probeExisting(port) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => { if (!finished) { finished = true; resolve(value); } };
    const request = http.get({ host: HOST, port, path: '/health', timeout: 400 }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) { response.destroy(); finish(false); }
      });
      response.on('end', () => {
        try {
          const health = JSON.parse(body);
          finish(response.statusCode === 200 && health.app === APP_ID && health.instance === INSTANCE_ID && health.ready === true);
        } catch { finish(false); }
      });
      response.on('error', () => finish(false));
    });
    request.on('timeout', () => { request.destroy(); finish(false); });
    request.on('error', () => finish(false));
  });
}

function sendText(response, status, message, headOnly = false) {
  const body = Buffer.from(message, 'utf8');
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  response.end(headOnly ? undefined : body);
}

function handler(request, response) {
  const headOnly = request.method === 'HEAD';
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' && !headOnly) {
    response.setHeader('Allow', 'GET, HEAD');
    sendText(response, 405, '仅支持 GET 和 HEAD 请求。');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
  } catch {
    sendText(response, 400, '无效的请求路径。', headOnly);
    return;
  }
  if (pathname === '/health') {
    const body = Buffer.from(JSON.stringify({ app: APP_ID, instance: INSTANCE_ID, ready: true, version: 1 }));
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    response.end(headOnly ? undefined : body);
    return;
  }
  let file = path.resolve(DIST, `.${pathname}`);
  if (file !== DIST && !file.startsWith(`${DIST}${path.sep}`)) {
    sendText(response, 403, '不能访问该路径。', headOnly);
    return;
  }
  let stat;
  try { stat = fs.statSync(file); } catch { /* SPA routing is handled below. */ }
  if (!stat || !stat.isFile()) {
    if (path.extname(pathname) || /^\/(assets|stickers)(\/|$)/.test(pathname)) {
      sendText(response, 404, '文件不存在。', headOnly);
      return;
    }
    file = INDEX;
    try { stat = fs.statSync(file); } catch {
      sendText(response, 503, '缺少构建文件，请先生成 dist 目录。', headOnly);
      return;
    }
  }
  try {
    const realFile = fs.realpathSync(file);
    const realDist = fs.realpathSync(DIST);
    if (!realFile.startsWith(`${realDist}${path.sep}`)) {
      sendText(response, 403, '不能访问该路径。', headOnly);
      return;
    }
  } catch {
    sendText(response, 404, '文件不存在。', headOnly);
    return;
  }
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (headOnly) { response.end(); return; }
  const stream = fs.createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

async function main() {
  if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65525) {
    console.error('端口须为 1024 到 65525 之间的整数，例如：node server.cjs --port 4173');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(INDEX)) {
    console.error('找不到 dist/index.html。请使用完整的面板文件夹，或先由开发者运行 npm install 和 npm run build。');
    process.exitCode = 1;
    return;
  }
  for (let port = requestedPort; port <= requestedPort + 10; port += 1) {
    const url = `http://${HOST}:${port}`;
    if (await probeExisting(port)) {
      console.log(`小红花团建面板已在运行：${url}`);
      openBrowser(url);
      return;
    }
    const server = http.createServer(handler);
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    const result = await new Promise((resolve) => {
      server.once('error', (error) => resolve(error));
      server.listen(port, HOST, () => resolve(null));
    });
    if (result) {
      if (result.code === 'EADDRINUSE') continue;
      console.error(`启动失败：${result.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\n小红花团建面板已启动\n控制台：${url}\n观众大屏：${url}/screen\n演示彩排：${url}/?demo=1\n\n活动期间请保留此终端窗口。结束后按 Control+C 停止。\n`);
    if (port !== requestedPort) console.log(`原端口被占用，已自动使用 ${port}。浏览器按网址隔离保存数据，请记录本次地址。`);
    openBrowser(url);
    const stop = () => {
      console.log('\n面板服务正在停止。');
      server.close(() => process.exit(0));
      server.closeAllConnections?.();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  console.error(`端口 ${requestedPort}–${requestedPort + 10} 均被占用。请关闭不再使用的本地服务，或运行 node server.cjs --port 4184。`);
  process.exitCode = 1;
}

main().catch((error) => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
