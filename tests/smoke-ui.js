/*!
 * OpenCalcBook — 界面冒烟测试（jsdom）
 * ---------------------------------------------------------------------------
 * 真跑一遍 index.html：加载脚本 → 初始化 → 点按钮 → 校验 DOM 结果。
 * 需要 jsdom（不在本项目依赖内，测试时通过 NODE_PATH 提供）。
 *
 * 运行：
 *   NODE_PATH=<jsdom 所在 node_modules> node tests/smoke-ui.js
 *
 * License: MIT
 */
'use strict';

var path = require('path');
var http = require('http');
var ROOT = path.join(__dirname, '..');

var jsdom = loadJsdom();
var JSDOM = jsdom.JSDOM;

/** 依次在若干常见位置找 jsdom，找不到就给出明确提示 */
function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }

  var path2 = require('path');
  var fs = require('fs');
  var candidates = [];

  if (process.env.OCB_JSDOM_PATH) {
    candidates.push(path2.join(process.env.OCB_JSDOM_PATH, 'jsdom'));
    candidates.push(process.env.OCB_JSDOM_PATH);
  }
  try {
    var g = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
    if (g) candidates.push(path2.join(g, 'jsdom'));
  } catch (e2) { /* 忽略 */ }
  candidates.push(path2.join(__dirname, '..', 'node_modules', 'jsdom'));
  candidates.push(path2.join(__dirname, '..', '..', 'node_modules', 'jsdom'));

  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) return require(candidates[i]);
    } catch (e3) { /* 继续找 */ }
  }

  console.error('未找到 jsdom。请任选一种方式安装后重试：');
  console.error('  1) npm i -D jsdom                  （装在项目里）');
  console.error('  2) npm i -g jsdom                  （装在全局）');
  console.error('  3) OCB_JSDOM_PATH=<含 jsdom 的 node_modules 目录> node tests/smoke-ui.js');
  process.exit(3);
}

var PORT = 5199;

/* ============================ 迷你断言 ============================ */
var passed = 0, failed = 0, failures = [];
function ok(cond, label, extra) {
  if (cond) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + label); }
  else {
    failed++;
    failures.push(label + (extra ? ('  → ' + extra) : ''));
    console.log('  \x1b[31m✗\x1b[0m ' + label + (extra ? ('  → ' + extra) : ''));
  }
}
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label, '期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); }
function includes(hay, needle, label) { ok(String(hay).indexOf(needle) >= 0, label, '未在内容中找到「' + needle + '」'); }

/* ============================ 启动静态服务器 ============================ */
function startServer() {
  return new Promise(function (resolve, reject) {
    var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    var server = http.createServer(function (req, res) {
      var p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      var abs = path.join(ROOT, p.replace(/^\/+/, ''));
      if (abs.indexOf(ROOT) !== 0) { res.writeHead(403); res.end(); return; }
      require('fs').readFile(abs, function (err, buf) {
        if (err) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', function () { resolve(server); });
  });
}

/* ============================ 主流程 ============================ */
(async function main() {
  var server = await startServer();
  console.log('\n\x1b[36m界面冒烟测试\x1b[0m  http://127.0.0.1:' + PORT + '/');

  var errors = [];
  var virtualConsole = new jsdom.VirtualConsole();
  virtualConsole.on('jsdomError', function (e) { errors.push('jsdomError: ' + (e.message || e)); });
  virtualConsole.on('error', function () { errors.push('console.error: ' + Array.prototype.join.call(arguments, ' ')); });
  // index.html 里的 warning 不当作错误
  virtualConsole.on('warn', function () { });
  virtualConsole.on('log', function () { });
  virtualConsole.on('info', function () { });

  var dom;
  try {
    dom = await JSDOM.fromURL('http://127.0.0.1:' + PORT + '/index.html', {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      virtualConsole: virtualConsole
    });
  } catch (e) {
    console.error('页面加载失败：' + e.message);
    server.close();
    process.exit(1);
  }

  var window = dom.window;
  var document = window.document;

  /* 补齐 jsdom 缺失的浏览器能力 */
  window.confirm = function () { return true; };
  window.alert = function () { };
  if (!window.URL.createObjectURL) window.URL.createObjectURL = function () { return 'blob:stub'; };
  if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = function () { };
  window.HTMLAnchorElement.prototype.click = function () { };
  var downloads = [];
  var origCreate = window.URL.createObjectURL;
  window.URL.createObjectURL = function (blob) { downloads.push(blob); return origCreate.call(window.URL, blob); };

  // 等 load
  await new Promise(function (resolve) {
    if (document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve);
    setTimeout(resolve, 4000);
  });
  await new Promise(function (r) { setTimeout(r, 120); });

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  console.log('\n── 1. 初始化');
  ok(!!window.CBModel && !!window.CBUnits && !!window.CBExpr && !!window.CBReport && !!window.CBExport,
    '五个模块都已挂载到 window');
  ok(!!window.CBDemo, '示例模块已加载');
  eq($$('#gridBody tr').length, 48, '主表格渲染出 48 行');
  includes($('#statusBar').textContent, '错误 0', '状态栏显示「错误 0」');
  includes($('#statusBar').textContent, '行 48', '状态栏显示行数');
  includes($('#verLabel').textContent, 'v1', '版本号已显示');

  console.log('\n── 2. 左侧面板');
  eq($$('#constBody tr').length, 4, '常量库 4 条');
  eq($$('#unitBody tr').length, 6, '单位表 6 条');
  eq($$('#fnBody tr').length, 10, '函数库 10 条');
  eq($$('#varBody tr').length, 4, '汇总变量 4 条');
  ok($$('#unitList option').length >= 5, '单位下拉建议已填充');
  ok($('#gridHead').querySelectorAll('th').length > 5, '表头已生成多列');

  console.log('\n── 3. 计算结果（数据流跑通）');
  var gridText = $('#gridBody').textContent;
  includes(gridText, '449.28', '土方开挖总量 449.28 出现在表格中');
  includes(gridText, '292.80', '模板总面积 292.80 出现在表格中');
  includes(gridText, '14.204', '钢筋估算 14.204 出现在表格中');
  includes($('#statusBar').textContent, '合计', '状态栏有合计');

  console.log('\n── 4. 选中与详情');
  var firstRow = $('#gridBody tr[data-id]');
  var nameInput = firstRow.querySelector('input[data-key="name"]');
  nameInput.focus();
  ok($('#detailBody').querySelectorAll('input').length > 3, '详情面板渲染出字段');
  includes($('#detailNo').textContent, '编号', '详情显示了编号');

  // 修改第一行名称 → 详情里的名称同步
  nameInput.value = '土石方工程（改）';
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  nameInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 150); });
  var detailName = $('#detailBody').querySelectorAll('input')[2];
  eq(detailName.value, '土石方工程（改）', '改名后详情面板同步');
  eq(nameInput.value, '土石方工程（改）', '改名后输入框保留用户输入');

  console.log('\n── 5. 行操作');
  var before = $$('#gridBody tr').length;
  $('#btnAddSibling').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  eq($$('#gridBody tr').length, before + 1, '「＋ 同级行」新增一行');

  $('#btnAddChild').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  eq($$('#gridBody tr').length, before + 2, '「＋ 子行」再新增一行');

  $('#btnIndent').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  ok(true, '「缩进」未抛异常');

  $('#btnOutdent').click();
  $('#btnUp').click();
  $('#btnDown').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  includes($('#statusBar').textContent, '错误 0', '行操作后仍然 0 错误');

  console.log('\n── 6. 折叠');
  $('#btnCollapseAll').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  var collapsedCount = $$('#gridBody tr').length;
  ok(collapsedCount < before + 2, '折叠分组后可见行减少', '折叠后 ' + collapsedCount + ' 行');
  $('#btnExpandAll').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  eq($$('#gridBody tr').length, before + 2, '展开全部恢复行数');

  console.log('\n── 7. 公式编辑器');
  // 选中一个已有行
  var rows = $$('#gridBody tr[data-id]');
  rows[3].querySelector('input').focus();
  $('#btnFormula').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  ok($('#modalFormula').classList.contains('open'), '公式编辑器已打开');
  ok($('#fmText').value.length > 0, '表达式已回填');
  includes($('#fmStatus').textContent, '语法正确', '语法校验通过');
  includes($('#fmResult').textContent, '结果', '实时试算有结果');
  ok($('#fmFnPalette').querySelectorAll('button').length > 5, '函数调色板已生成');
  ok($('#fmRowPalette').querySelectorAll('button').length > 5, '行引用调色板已生成');
  ok($('#fmConstPalette').querySelectorAll('button').length > 3, '常量调色板已生成');

  // 点一个函数按钮 → 文本被插入
  var beforeText = $('#fmText').value;
  $('#fmFnPalette').querySelectorAll('button')[0].click();
  ok($('#fmText').value !== beforeText, '点击函数按钮插入文本');

  // 写入新表达式并保存
  $('#fmText').value = '100 + 200';
  $('#fmText').dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 60); });
  includes($('#fmResult').textContent, '300', '试算出 300');
  $('#fmApply').click();
  await new Promise(function (r) { setTimeout(r, 150); });
  ok(!$('#modalFormula').classList.contains('open'), '保存后弹窗关闭');
  includes($('#gridBody').textContent, '300', '表格出现新结果 300');

  console.log('\n── 8. 语法错误提示');
  rows = $$('#gridBody tr[data-id]');
  rows[3].querySelector('input').focus();
  $('#btnFormula').click();
  await new Promise(function (r) { setTimeout(r, 40); });
  $('#fmText').value = '1 + * 2';
  $('#fmText').dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 60); });
  ok($('#fmStatus').classList.contains('bad'), '语法错误时状态变红');
  $('#fmText').value = '1 + 2';
  $('#fmText').dispatchEvent(new window.Event('input', { bubbles: true }));
  $('#fmApply').click();
  await new Promise(function (r) { setTimeout(r, 120); });
  includes($('#statusBar').textContent, '错误 0', '修正后回到 0 错误');

  console.log('\n── 9. 函数编辑器');
  $('#fnBody').querySelector('.link').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  ok($('#modalFn').classList.contains('open'), '函数编辑器已打开');
  ok($('#fnName').value.length > 0, '函数名已回填');
  includes($('#fnStatus').textContent, '语法正确', '函数表达式语法通过');
  var pn = $$('#fnParamBody tr').length;
  eq(pn, 2, '矩形面积原有 2 个参数');
  $('#fnAddParam').click();
  eq($$('#fnParamBody tr').length, 3, '添加参数后变 3 行');
  $('#fnAddCode').click();
  eq($$('#fnCodeBody tr').length, 1, '添加内部变量后 1 行');
  $('[data-close]').click();
  await new Promise(function (r) { setTimeout(r, 60); });

  console.log('\n── 10. 报表');
  $('#btnReport').click();
  await new Promise(function (r) { setTimeout(r, 100); });
  ok($('#modalReport').classList.contains('open'), '报表弹窗已打开');
  ok($$('#rpParams input').length >= 5, '报表参数已生成');
  var srcdoc = $('#rpFrame').getAttribute('srcdoc') || $('#rpFrame').srcdoc || '';
  includes(srcdoc, '<!DOCTYPE html>', '预览是完整 HTML');
  includes(srcdoc, '工程量计算书', '预览含报表标题');
  includes(srcdoc, '@page', '预览含打印样式');
  includes(srcdoc, '合计', '预览含合计行');
  $('#rpOrientation').value = 'landscape';
  $('#rpOrientation').dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 80); });
  includes($('#rpFrame').srcdoc, 'landscape', '切换横向后预览更新');
  window.__closed = true;
  $('#modalReport').querySelector('[data-close]').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  ok(!$('#modalReport').classList.contains('open'), '报表弹窗可关闭');

  console.log('\n── 11. 导出');
  downloads.length = 0;
  $('#btnCsv').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  ok(downloads.length >= 1, '导出 CSV 触发了下载');

  $('#btnSave').click();
  await new Promise(function (r) { setTimeout(r, 60); });
  ok(downloads.length >= 2, '保存工程触发了下载');

  console.log('\n── 12. 主题与本地存储');
  var themeBefore = document.documentElement.getAttribute('data-theme');
  $('#btnTheme').click();
  var themeAfter = document.documentElement.getAttribute('data-theme');
  ok(themeBefore !== themeAfter, '主题可切换', themeBefore + ' → ' + themeAfter);
  ok(!!window.localStorage.getItem('opencalcbook.project.v1'), '工程已写入 localStorage');
  ok(!!window.localStorage.getItem('opencalcbook.theme'), '主题偏好已写入 localStorage');

  console.log('\n── 13. 帮助弹窗');
  $('#btnHelp').click();
  await new Promise(function (r) { setTimeout(r, 40); });
  ok($('#modalHelp').classList.contains('open'), '帮助弹窗已打开');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 40); });
  ok(!$('#modalHelp').classList.contains('open'), 'Esc 可关闭弹窗');

  console.log('\n── 14. 新建与载入示例');
  $('#btnNew').click();
  await new Promise(function (r) { setTimeout(r, 100); });
  eq($$('#gridBody tr').length, 3, '新建工程有 3 行示例');
  includes($('#statusBar').textContent, '错误 0', '新建工程无错误');
  $('#btnLoadDemo').click();
  await new Promise(function (r) { setTimeout(r, 150); });
  eq($$('#gridBody tr').length, 48, '重新载入示例恢复 48 行');

  console.log('\n── 15. 运行期错误');
  eq(errors.length, 0, '没有捕获到运行期错误', errors.slice(0, 3).join(' | '));

  /* 收尾 */
  console.log('\n' + '─'.repeat(60));
  if (failed === 0) console.log('\x1b[32m界面测试全部通过\x1b[0m  ' + passed + ' 项');
  else {
    console.log('\x1b[31m失败 ' + failed + ' 项\x1b[0m / 共 ' + (passed + failed) + ' 项');
    failures.forEach(function (f) { console.log('  • ' + f); });
  }

  try { window.close(); } catch (e) { }
  server.close();
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('测试崩溃：', e);
  process.exit(1);
});
