#!/usr/bin/env node
/*!
 * OpenCalcBook CLI
 * ---------------------------------------------------------------------------
 * 用法：
 *   ocb calc   <工程文件>              在终端打印计算书明细
 *   ocb csv    <工程文件> [-o 输出.csv] 导出 CSV
 *   ocb md     <工程文件> [-o 输出.md]  导出 Markdown 表格
 *   ocb txt    <工程文件> [-o 输出.txt] 导出纯文本
 *   ocb report <工程文件> [-o 输出.html] 导出可打印 HTML
 *   ocb check  <工程文件>              只做校验（语法 / 循环引用 / 重复编号）
 *   ocb demo                           生成示例工程到 stdout
 *
 * License: MIT
 */
'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var CBExpr = require(path.join(ROOT, 'src', 'expr.js'));
var CBUnits = require(path.join(ROOT, 'src', 'units.js'));
var CBModel = require(path.join(ROOT, 'src', 'model.js'));
var CBReport = require(path.join(ROOT, 'src', 'report.js'));
var CBExport = require(path.join(ROOT, 'src', 'exporter.js'));

CBExpr.setUnitConverter(CBUnits.convert);

function usage(code) {
  console.log([
    'OpenCalcBook CLI',
    '',
    '  ocb calc   <工程文件>               打印计算书明细',
    '  ocb csv    <工程文件> [-o 文件]      导出 CSV',
    '  ocb md     <工程文件> [-o 文件]      导出 Markdown',
    '  ocb txt    <工程文件> [-o 文件]      导出纯文本',
    '  ocb report <工程文件> [-o 文件]      导出可打印 HTML',
    '  ocb check  <工程文件>               校验工程',
    '  ocb demo                           输出示例工程 JSON',
    ''
  ].join('\n'));
  process.exit(code === undefined ? 0 : code);
}

function parseArgs(argv) {
  var out = { cmd: argv[0], file: null, out: null, error: null };
  var rest = argv.slice(1);
  for (var i = 0; i < rest.length; i++) {
    if (rest[i] === '-o' || rest[i] === '--output') { out.out = rest[i + 1]; i++; }
    else if (rest[i] === '-h' || rest[i] === '--help') { usage(0); }
    else if (!out.file) out.file = rest[i];
    else out.error = '多余的参数：' + rest[i];
  }
  return out;
}

function load(file) {
  if (!file) { console.error('错误：缺少工程文件路径'); usage(1); }
  var abs = path.resolve(file);
  if (!fs.existsSync(abs)) { console.error('错误：文件不存在 ' + abs); process.exit(1); }
  var text = fs.readFileSync(abs, 'utf8');
  var project = CBModel.deserialize(text);
  return project;
}

function out(text, file) {
  if (file) {
    fs.writeFileSync(path.resolve(file), text, 'utf8');
    console.error('已写入 ' + path.resolve(file) + '（' + Buffer.byteLength(text, 'utf8') + ' 字节）');
  } else {
    process.stdout.write(text);
  }
}

var C = {
  dim: '\x1b[2m', red: '\x1b[31m', yel: '\x1b[33m', grn: '\x1b[32m', b: '\x1b[1m', r: '\x1b[0m'
};
var color = process.stdout.isTTY;

function c(s, code) { return color ? (code + s + C.r) : s; }

function padEnd(s, n) {
  s = String(s === undefined || s === null ? '' : s);
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charCodeAt(i);
    w += (ch > 0x2e80 && ch < 0xffef) ? 2 : 1;
  }
  return s + ' '.repeat(Math.max(0, n - w));
}

function padStart(s, n) {
  s = String(s === undefined || s === null ? '' : s);
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charCodeAt(i);
    w += (ch > 0x2e80 && ch < 0xffef) ? 2 : 1;
  }
  return ' '.repeat(Math.max(0, n - w)) + s;
}

function cmdCalc(project) {
  var calc = CBModel.recalc(project);
  var rows = CBModel.flatten(project);

  console.log('');
  console.log(c((project.meta.name || '计算书'), C.b) + c('   行数 ' + calc.stats.rows + ' · 错误 ' + calc.stats.errors + ' · 告警 ' + calc.stats.warnings, C.dim));
  console.log('');
  console.log(c(padEnd('编号', 8) + padEnd('项目名称', 32) + padStart('计算结果', 14) + '  ' + padEnd('单位', 6) + padStart('工程量', 14), C.dim));
  console.log(c('─'.repeat(80), C.dim));

  rows.forEach(function (r) {
    var e = calc.results[r.id];
    var indent = '  '.repeat(r.__depth || 0);
    var isGrp = e && e.hasChildren;
    var val = '';
    if (!e) val = '';
    else if (e.error) val = c('ERR', C.red);
    else if (e.value === null || e.value === undefined) val = '';
    else if (typeof e.value === 'number') val = CBUnits.format(e.value, project.unitTable, r.unit, false);
    else val = String(e.value);
    var gcl = CBUnits.format(e ? (e.gcl || 0) : 0, project.unitTable, r.unit, false);

    var line = padEnd((r.no || ''), 8) +
      padEnd(indent + (r.name || ''), 32) +
      padStart(val, 14) + '  ' +
      padEnd(r.unit || '', 6) +
      padStart(gcl, 14);
    console.log(isGrp ? c(line, C.b) : line);
    if (e && e.error) console.log('        ' + c('⚠ ' + e.error.message, C.red));
  });

  console.log(c('─'.repeat(80), C.dim));
  var totals = Object.keys(calc.unitTotals).map(function (k) { return calc.unitTotals[k]; });
  if (totals.length) {
    console.log(c('合计：' + totals.map(function (t) {
      return CBUnits.format(t.total, project.unitTable, t.unit === '(无单位)' ? '' : t.unit, false) + ' ' + (t.unit === '(无单位)' ? '' : t.unit) + '（' + t.count + ' 行）';
    }).join('   '), C.b));
  }
  console.log('');

  if (calc.errors.length) {
    console.log(c('错误 ' + calc.errors.length + ' 项：', C.red));
    calc.errors.forEach(function (e) {
      console.log('  ' + c('[' + (e.no || '?') + '] ' + e.message, C.red));
    });
  }
  if (calc.warnings.length) {
    console.log(c('告警 ' + calc.warnings.length + ' 项：', C.yel));
    calc.warnings.forEach(function (w) { console.log('  ' + c(w.message, C.yel)); });
  }
  return calc;
}

function cmdCheck(project) {
  var v = CBModel.validate(project);
  var calc = CBModel.recalc(project);
  console.log('');
  console.log('格式      ' + (project.format || '(缺失)') + ' v' + (project.version || '?'));
  console.log('行数      ' + calc.stats.rows + '（叶子 ' + calc.stats.leaves + '）');
  console.log('错误      ' + calc.errors.length);
  console.log('告警      ' + calc.warnings.length);
  var problems = 0;
  calc.errors.forEach(function (e) {
    problems++;
    console.log(c('  ✗ [' + (e.no || '?') + '] ' + e.message, C.red));
  });
  calc.warnings.forEach(function (w) {
    problems++;
    console.log(c('  ! ' + w.message, C.yel));
  });
  v.errors.forEach(function (e) { problems++; console.log(c('  ✗ ' + e, C.red)); });
  if (!problems) console.log(c('  ✓ 没有问题', C.grn));
  console.log('');
  return problems;
}

/* ===================================================================== */
var args = parseArgs(process.argv.slice(2));
if (!args.cmd || args.cmd === '-h' || args.cmd === '--help') usage(0);
if (args.error) { console.error('错误：' + args.error); usage(1); }

switch (args.cmd) {
  case 'demo': {
    var demo = require(path.join(ROOT, 'examples', 'demo-project.js'));
    out(CBModel.serialize(demo.build()), args.out);
    break;
  }
  case 'calc': {
    var p1 = load(args.file);
    var calc = cmdCalc(p1);
    process.exit(calc.errors.length ? 2 : 0);
    break;
  }
  case 'check': {
    var p2 = load(args.file);
    var n = cmdCheck(p2);
    process.exit(n ? 2 : 0);
    break;
  }
  case 'csv': {
    var p3 = load(args.file);
    out(CBExport.toCSV(p3, CBModel.recalc(p3)), args.out);
    break;
  }
  case 'md': {
    var p4 = load(args.file);
    out(CBExport.toMarkdown(p4, CBModel.recalc(p4)), args.out);
    break;
  }
  case 'txt': {
    var p5 = load(args.file);
    out(CBExport.toPlainText(p5, CBModel.recalc(p5)), args.out);
    break;
  }
  case 'report': {
    var p6 = load(args.file);
    var tpl = CBReport.defaultTemplate(p6, '工程量计算书');
    tpl.params.forEach(function (x) {
      if (x.name === 'GCMC') x.default = p6.meta.name;
      if (x.name === 'JSSMC') x.default = '工程量计算书';
      if (x.name === 'BZR') x.default = p6.meta.author || '';
    });
    out(CBReport.renderHTML(p6, CBModel.recalc(p6), tpl, null, { standalone: true }), args.out);
    break;
  }
  default:
    console.error('未知命令：' + args.cmd);
    usage(1);
}
