/*!
 * OpenCalcBook — 测试套件（Node 环境）
 * 运行： node tests/run-tests.js
 * License: MIT
 */
'use strict';

var path = require('path');
var CBExpr = require(path.join(__dirname, '..', 'src', 'expr.js'));
var CBUnits = require(path.join(__dirname, '..', 'src', 'units.js'));
var CBModel = require(path.join(__dirname, '..', 'src', 'model.js'));
var CBReport = require(path.join(__dirname, '..', 'src', 'report.js'));
var CBExport = require(path.join(__dirname, '..', 'src', 'exporter.js'));

// units.js 在 Node 下自动接线，但 require 顺序不保证，这里显式接一次
CBExpr.setUnitConverter(CBUnits.convert);

/* ============================ 迷你测试框架 ============================ */
var passed = 0, failed = 0, current = '';
var failures = [];

function group(name) { current = name; console.log('\n\x1b[36m── ' + name + '\x1b[0m'); }

function ok(cond, label, extra) {
  if (cond) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + label);
  } else {
    failed++;
    failures.push(current + ' → ' + label + (extra ? ('\n      ' + extra) : ''));
    console.log('  \x1b[31m✗\x1b[0m ' + label + (extra ? ('\n      ' + extra) : ''));
  }
}

function eq(actual, expected, label) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(a === b, label, a === b ? '' : '期望 ' + b + '，实际 ' + a);
}

function almost(actual, expected, eps, label) {
  var d = Math.abs(Number(actual) - Number(expected));
  ok(d <= (eps === undefined ? 1e-9 : eps), label, '期望 ≈' + expected + '，实际 ' + actual);
}

function throws(fn, label, contains) {
  try {
    fn();
    ok(false, label, '没有抛出异常');
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    if (contains && msg.indexOf(contains) < 0) {
      ok(false, label, '异常信息不含「' + contains + '」：' + msg);
    } else {
      ok(true, label);
    }
  }
}

function evalExpr(src, ctx) {
  return CBExpr.run(src, ctx || CBExprStub);
}

/* 最小可用上下文：只支持常量 */
var CBExprStub = {
  builtin: CBExpr.builtins,
  const: function (n) {
    var m = { PI2: 6.283185307179586, A: 10, NAME: '测试工程' };
    if (Object.prototype.hasOwnProperty.call(m, n)) return m[n];
    throw CBExpr.ExprError('未定义的常量 @' + n);
  },
  variable: function (n) {
    var m = { X: 3, Y: 4, T: '变量' };
    if (Object.prototype.hasOwnProperty.call(m, n)) return m[n];
    throw CBExpr.ExprError('未定义的变量 $' + n);
  },
  row: function (n) { throw CBExpr.ExprError('无行上下文'); },
  deref: function (r) { return r; },
  rowRange: function () { throw CBExpr.ExprError('无行上下文'); },
  customFunction: function () { return null; }
};

/* ============================ 1. 词法 / 语法 ============================ */
group('1. 词法分析');

(function () {
  var t = CBExpr.tokenize("1 + 2.5e2 * [A-1] @PI2 $X '文本'");
  var kinds = t.map(function (x) { return x.type; }).join(',');
  eq(kinds, 'num,op,num,op,rowref,constref,varref,str,eof', '识别全部记号类型');
})();
ok(CBExpr.tokenize("'it''s'")[0].value === "it's", '单引号字符串的 \'\' 转义');
ok(CBExpr.tokenize('"双引号"')[0].value === '双引号', '双引号字符串');
ok(CBExpr.tokenize('面积')[0].type === 'ident', '中文标识符');
throws(function () { CBExpr.tokenize("'未闭合"); }, '未闭合字符串报错', '未闭合');
throws(function () { CBExpr.tokenize('[abc'); }, '未闭合行引用报错', ']');
throws(function () { CBExpr.tokenize('1 # 2'); }, '非法字符报错', '无法识别');

group('2. 运算与优先级');
almost(evalExpr('1+2*3'), 7, 1e-9, '乘法优先于加法');
almost(evalExpr('(1+2)*3'), 9, 1e-9, '括号');
almost(evalExpr('2^3^2'), 512, 1e-9, '幂运算右结合');
almost(evalExpr('-2^2'), -4, 1e-9, '一元负号优先级低于幂');
almost(evalExpr('10%3'), 1, 1e-9, '取模');
almost(evalExpr('7 div 2 + 7 mod 2'), 4, 1e-9, 'div / mod 关键字');
almost(evalExpr('3 + 4 * 2 / (1 - 5)^2'), 3.5, 1e-9, '复合表达式');
ok(evalExpr('1 > 2') === false, '大于比较');
ok(evalExpr("'a' <> 'b'") === true, '不等号 <>');
ok(evalExpr("'a' = 'a'") === true, '等号 =');
ok(evalExpr('1 <= 1 && 2 >= 2') === true, '逻辑与');
ok(evalExpr('1 > 2 || 2 > 1') === true, '逻辑或短路');
ok(evalExpr('!false') === true, '一元非');
almost(evalExpr('true ? 1 : 2'), 1, 1e-9, '三元真分支');
almost(evalExpr('false ? 1 : 2'), 2, 1e-9, '三元假分支');
ok(evalExpr("'总数：' + 42") === '总数：42', '字符串拼接');
ok(evalExpr("'a' + 'b' + 'c'") === 'abc', '多段拼接');
throws(function () { evalExpr('1/0'); }, '除零报错', '除数为零');

group('3. 常量 / 变量 / 内建函数');
almost(evalExpr('@A * 2'), 20, 1e-9, '常量引用');
ok(evalExpr("'工程：' + @NAME") === '工程：测试工程', '字符串常量拼接');
almost(evalExpr('$X * $Y'), 12, 1e-9, '变量引用');
throws(function () { evalExpr('@NOPE'); }, '未定义常量报错', '未定义的常量');
almost(evalExpr('abs(-3.5)'), 3.5, 1e-9, 'abs');
almost(evalExpr('round(3.14159, 2)'), 3.14, 1e-9, 'round(x, 2)');
almost(evalExpr('round(2.5, 0)'), 3, 1e-9, '四舍五入进位');
almost(evalExpr('int(-3.7)'), -3, 1e-9, 'int 朝零取整');
almost(evalExpr('ceil(2.1)'), 3, 1e-9, 'ceil');
almost(evalExpr('floor(2.9)'), 2, 1e-9, 'floor');
almost(evalExpr('sqrt(16)'), 4, 1e-9, 'sqrt');
almost(evalExpr('pow(2,10)'), 1024, 1e-9, 'pow');
almost(evalExpr('pi()', { builtin: CBExpr.builtins, const: function () { }, variable: function () { }, row: function () { }, deref: function (r) { return r; }, rowRange: function () { }, customFunction: function () { } }), Math.PI, 1e-12, 'pi()');
ok(evalExpr("iif(1>0, '是', '否')") === '是', 'IIF 真分支');
ok(evalExpr("iif(1<0, '是', '否')") === '否', 'IIF 假分支');
ok(evalExpr('upper("abc")') === 'ABC', 'upper');
almost(evalExpr('len("工程")'), 2, 1e-9, 'len 中文长度');
ok(evalExpr("mid('abcdef', 2, 3)") === 'bcd', 'mid');
ok(evalExpr("formatnum(1234.567, 2, true)") === '1,234.57', 'formatnum 千分位');
throws(function () { evalExpr('nosuchfn(1)'); }, '未定义函数报错', '未定义的函数');
throws(function () { evalExpr('round(1,2,3)'); }, '参数个数校验', '参数');

group('4. 单位换算');
almost(CBUnits.convert(1, 'm', 'cm'), 100, 1e-9, '1 m = 100 cm');
almost(CBUnits.convert(100, 'cm', 'm'), 1, 1e-9, '100 cm = 1 m');
almost(CBUnits.convert(1, 'm2', 'cm2'), 10000, 1e-9, '1 m² = 10000 cm²');
almost(CBUnits.convert(1, 'm3', 'L'), 1000, 1e-9, '1 m³ = 1000 L');
almost(CBUnits.convert(1, 't', 'kg'), 1000, 1e-9, '1 t = 1000 kg');
almost(CBUnits.convert(1, '㎡', 'm2'), 1, 1e-9, '单位别称归一 ㎡');
almost(evalExpr("换算(1, 'm', 'mm')"), 1000, 1e-9, '换算() 函数');
throws(function () { CBUnits.convert(1, 'm', 'kg'); }, '跨量纲换算报错', '同一量纲');
eq(CBUnits.normalize('M2'), 'm2', '大小写归一');
eq(CBUnits.precisionOf(CBUnits.DEFAULT_TABLE, 'm2'), 2, '取单位精度 m2');
eq(CBUnits.precisionOf(CBUnits.DEFAULT_TABLE, 'm'), 3, '取单位精度 m');
eq(CBUnits.format(12.3456, CBUnits.DEFAULT_TABLE, 'm2', false), '12.35', '按精度格式化');

/* ============================ 5. 数据模型 ============================ */
group('5. 工程模型与计算');

function makeProject() {
  var p = CBModel.newProject({ name: '测试工程' });
  p.rows = [];
  p.constants = [{ code: 'K', value: '1.05', description: '调整系数' }];
  return p;
}

(function () {
  var p = makeProject();
  var g = CBModel.addRow(p, null, { no: '一', name: '基础', unit: 'm2' });
  CBModel.addRow(p, g.id, { no: '1', name: '长', expr: '12', unit: 'm' });
  CBModel.addRow(p, g.id, { no: '2', name: '宽', expr: '8', unit: 'm' });
  CBModel.addRow(p, g.id, { no: '3', name: '面积', expr: '[1]*[2]', unit: 'm2' });
  CBModel.addRow(p, g.id, { no: '4', name: '调整后', expr: '[3]*@K', unit: 'm2' });

  var c = CBModel.recalc(p);
  var byNo = {};
  p.rows.forEach(function (r) { if (r.no) byNo[r.no] = c.results[r.id]; });

  eq(c.errors.length, 0, '无错误');
  almost(byNo['1'].value, 12, 1e-9, '行 1 值');
  almost(byNo['3'].value, 96, 1e-9, '行 3 引用两行相乘');
  almost(byNo['4'].value, 100.8, 1e-9, '行 4 引用常量 @K');
  almost(byNo['一'].gcl, 196.8, 1e-9, '分组汇总只累加同单位(m2)子行');
  almost(byNo['一'].unitTotals['m2'].total, 196.8, 1e-9, '分组按单位明细：m2');
  almost(byNo['一'].unitTotals['m'].total, 20, 1e-9, '分组按单位明细：m');
  ok(byNo['一'].hasChildren === true, '分组行标记');
  ok(byNo['3'].hasChildren === false, '叶子行标记');
  eq(c.stats.errors, 0, '统计：无错误');
})();

(function () {
  // 分组未指定单位：子行同单位 → 求和；子行多单位 → 不求和并告警
  var p = makeProject();
  var ok1 = CBModel.addRow(p, null, { no: 'A', name: '同单位组' });
  CBModel.addRow(p, ok1.id, { no: '1', name: 'a', expr: '5', unit: 'm3' });
  CBModel.addRow(p, ok1.id, { no: '2', name: 'b', expr: '7', unit: 'm3' });
  var mix = CBModel.addRow(p, null, { no: 'B', name: '多单位组' });
  CBModel.addRow(p, mix.id, { no: '3', name: 'c', expr: '5', unit: 'm3' });
  CBModel.addRow(p, mix.id, { no: '4', name: 'd', expr: '7', unit: 'm2' });
  var c = CBModel.recalc(p);
  almost(c.results[ok1.id].gcl, 12, 1e-9, '未指定单位但子行同单位 → 求和');
  eq(c.results[mix.id].gcl, null, '未指定单位且子行多单位 → 不给汇总值');
  ok(c.warnings.some(function (w) { return w.type === 'mixed-units'; }), '多单位产生告警');
})();

(function () {
  // 汇总行标志的行是人为小计，不参与累加
  var p = makeProject();
  var g = CBModel.addRow(p, null, { no: '一', name: '组', unit: 'm2' });
  CBModel.addRow(p, g.id, { no: '1', name: 'a', expr: '10', unit: 'm2' });
  CBModel.addRow(p, g.id, { no: '2', name: 'b', expr: '20', unit: 'm2' });
  CBModel.addRow(p, g.id, { no: '3', name: '小计 a+b', expr: '[1]+[2]', unit: 'm2', summary: true });
  var c = CBModel.recalc(p);
  almost(c.results[g.id].gcl, 30, 1e-9, '汇总行不参与累加（避免重复计算）');
})();

(function () {
  // 系数与工程量表达式
  var p = makeProject();
  CBModel.addRow(p, null, { no: '1', name: '长', expr: '10', unit: 'm' });
  CBModel.addRow(p, null, { no: '2', name: '宽', expr: '5', unit: 'm' });
  CBModel.addRow(p, null, { no: '3', name: '面积×系数', expr: '[1]*[2]', unit: 'm2', factor: 2 });
  CBModel.addRow(p, null, { no: '4', name: '自定义工程量', expr: '[1]*[2]', unit: 'm2', gclExpr: '[1]*2' });
  var c = CBModel.recalc(p);
  var byNo = {};
  p.rows.forEach(function (r) { byNo[r.no] = c.results[r.id]; });
  almost(byNo['3'].value, 50, 1e-9, '计算结果不含系数');
  almost(byNo['3'].gcl, 100, 1e-9, '工程量 = 结果 × 系数');
  almost(byNo['4'].gcl, 20, 1e-9, '工程量表达式优先');
  eq(byNo['4'].gclSource, 'expr', '工程量来源标记');
})();

(function () {
  // 不计标志
  var p = makeProject();
  var g = CBModel.addRow(p, null, { no: '一', name: '组' });
  CBModel.addRow(p, g.id, { no: '1', name: '计', expr: '10', unit: 'm2' });
  CBModel.addRow(p, g.id, { no: '2', name: '不计', expr: '999', unit: 'm2', ignore: true });
  var c = CBModel.recalc(p);
  almost(c.results[g.id].gcl, 10, 1e-9, '不计标志的行不参与汇总');
})();

(function () {
  // 循环引用
  var p = makeProject();
  CBModel.addRow(p, null, { no: '1', name: 'a', expr: '[2]+1' });
  CBModel.addRow(p, null, { no: '2', name: 'b', expr: '[1]+1' });
  var c = CBModel.recalc(p);
  ok(c.errors.length >= 1, '检测到循环引用');
  ok(/循环引用/.test(c.errors[0].message), '错误信息含"循环引用"', c.errors[0] && c.errors[0].message);
})();

(function () {
  // 自引用
  var p = makeProject();
  CBModel.addRow(p, null, { no: '1', name: '自引用', expr: '[1]+1' });
  var c = CBModel.recalc(p);
  ok(c.errors.length === 1 && /循环引用/.test(c.errors[0].message), '自引用被拦截');
})();

(function () {
  // 区间求和
  var p = makeProject();
  CBModel.addRow(p, null, { no: '1', name: 'A', expr: '1', unit: 'm' });
  CBModel.addRow(p, null, { no: '2', name: 'B', expr: '2', unit: 'm' });
  CBModel.addRow(p, null, { no: '3', name: 'C', expr: '3', unit: 'm' });
  CBModel.addRow(p, null, { no: '4', name: '合计', expr: 'sum([1]..[3])', unit: 'm' });
  CBModel.addRow(p, null, { no: '5', name: '平均', expr: 'avg([1]..[3])', unit: 'm' });
  CBModel.addRow(p, null, { no: '6', name: '个数', expr: 'count([1]..[3])' });
  var c = CBModel.recalc(p);
  var byNo = {};
  p.rows.forEach(function (r) { byNo[r.no] = c.results[r.id]; });
  almost(byNo['4'].value, 6, 1e-9, '区间求和');
  almost(byNo['5'].value, 2, 1e-9, '区间平均');
  almost(byNo['6'].value, 3, 1e-9, '区间计数');
})();

(function () {
  // 行成员访问
  var p = makeProject();
  CBModel.addRow(p, null, { no: '1', name: '长度', expr: '7', unit: 'm', factor: 3 });
  CBModel.addRow(p, null, { no: '2', name: '取工程量', expr: '[1].gcl', unit: 'm' });
  CBModel.addRow(p, null, { no: '3', name: '取名称', expr: "[1].name + '!'" });
  var c = CBModel.recalc(p);
  var byNo = {};
  p.rows.forEach(function (r) { byNo[r.no] = c.results[r.id]; });
  almost(byNo['2'].value, 21, 1e-9, '[1].gcl 成员访问');
  ok(byNo['3'].value === '长度!', '[1].name 成员访问');
})();

(function () {
  // 自定义函数：参数 + 内部中间变量（对应 .cfd 里的 code）
  var p = makeProject();
  p.functions = [{
    name: '圆木侧面积', description: '圆木侧面积', unit: 'm2', precision: 4, catalog: '计算书',
    params: [
      { name: 'd', description: '小头直径', unit: 'cm', dataType: 'float', precision: 0 },
      { name: 'h', description: '长度', unit: 'm', dataType: 'float', precision: -1 }
    ],
    codes: [{ name: 'DD', expr: 'd*1.2', precision: 0, unit: 'cm', description: '大头直径（示例）' }],
    expr: 'PI()*h*(DD/100+d/100)/2'
  }];
  CBModel.addRow(p, null, { no: '1', name: '侧面积', expr: '圆木侧面积(20, 5)', unit: 'm2' });
  var c = CBModel.recalc(p);
  // 函数自身精度 4 位：PI*5*(24/100+20/100)/2 = 3.45575…；行单位 m2 精度 2 → 3.46
  almost(c.results[p.rows[0].id].value, 3.46, 1e-9, '自定义函数（含内部中间变量），按行单位精度取整');
  eq(c.errors.length, 0, '自定义函数无错误');
})();

(function () {
  // 函数递归防护
  var p = makeProject();
  p.functions = [{ name: '无穷递归', expr: '无穷递归(x)', unit: '', precision: -1, catalog: '', params: [{ name: 'x', description: '', unit: '', dataType: 'float', precision: -1 }], codes: [] }];
  CBModel.addRow(p, null, { no: '1', name: 'x', expr: '无穷递归(1)' });
  var c = CBModel.recalc(p);
  ok(c.errors.length === 1, '递归被拦截');
})();

(function () {
  // 语法错误定位
  var p = makeProject();
  CBModel.addRow(p, null, { no: '1', name: '坏公式', expr: '1 + * 2' });
  var c = CBModel.recalc(p);
  eq(c.errors.length, 1, '语法错误被记录');
  ok(c.errors[0].no === '1', '错误行号正确');
})();

(function () {
  // 单位精度取整
  var p = makeProject();
  CBModel.addRow(p, null, { no: '1', name: 'a', expr: '10/3', unit: 'm2' });
  CBModel.addRow(p, null, { no: '2', name: 'b', expr: '10/3', unit: 'm' });
  var c = CBModel.recalc(p);
  almost(c.results[p.rows[0].id].value, 3.33, 1e-9, 'm2 保留 2 位');
  almost(c.results[p.rows[1].id].value, 3.333, 1e-9, 'm 保留 3 位');
})();

(function () {
  // 汇总变量
  var p = makeProject();
  var g = CBModel.addRow(p, null, { no: '一', name: '组', summary: true });
  CBModel.addRow(p, g.id, { no: '1', name: 'a', expr: '5', unit: 'm2' });
  CBModel.addRow(p, g.id, { no: '2', name: 'b', expr: '7', unit: 'm2' });
  p.variables = [{ code: 'SUMA', expr: '[1]+[2]', description: '两行之和' }];
  CBModel.addRow(p, null, { no: '3', name: '引用变量', expr: '$SUMA', unit: 'm2' });
  var c = CBModel.recalc(p);
  var byNo = {};
  p.rows.forEach(function (r) { byNo[r.no] = c.results[r.id]; });
  almost(byNo['3'].value, 12, 1e-9, '汇总变量 $SUMA');
})();

group('6. 序列化与校验');
(function () {
  var p = makeProject();
  var g = CBModel.addRow(p, null, { no: '一', name: '组' });
  CBModel.addRow(p, g.id, { no: '1', name: 'a', expr: '1+1', unit: 'm' });
  var text = CBModel.serialize(p);
  var p2 = CBModel.deserialize(text);
  eq(p2.rows.length, 2, '反序列化行数一致');
  eq(p2.format, 'opencalcbook', '格式标识');
  var c2 = CBModel.recalc(p2);
  eq(c2.errors.length, 0, '反序列化后可正常计算');
  eq(CBModel.validate(p2).ok, true, '校验通过');
})();

(function () {
  var p = makeProject();
  CBModel.addRow(p, null, { no: '1', name: 'a', expr: '1+', unit: 'm' });
  var v = CBModel.validate(p);
  eq(v.ok, false, '语法错误导致校验失败');
  ok(v.errors.length === 1, '校验错误条数');
})();

(function () {
  // 容错加载：缺字段自动补齐
  var p = CBModel.normalize({ rows: [{ no: '1', expr: '1' }], meta: {} });
  eq(p.rows[0].factor, 1, '补齐 系数');
  ok(!!p.rows[0].id, '补齐 id');
  ok(Array.isArray(p.columns) && p.columns.length > 0, '补齐列配置');
  ok(Array.isArray(p.unitTable) && p.unitTable.length > 0, '补齐单位表');
})();

(function () {
  // 重复编号告警
  var p = makeProject();
  CBModel.addRow(p, null, { no: '1', name: 'a', expr: '1' });
  CBModel.addRow(p, null, { no: '1', name: 'b', expr: '2' });
  var c = CBModel.recalc(p);
  ok(c.warnings.some(function (w) { return w.type === 'duplicate-no'; }), '重复编号产生告警');
})();

group('7. 依赖分析');
(function () {
  var d = CBExpr.deps('[1] + [2].gcl + @K + $V + 矩形面积(1,2)');
  eq(d.rows, ['1', '2'], '提取行依赖');
  eq(d.constants, ['K'], '提取常量依赖');
  eq(d.variables, ['V'], '提取变量依赖');
  eq(d.functions, ['矩形面积'], '提取函数依赖');
})();

group('8. 报表与导出');
(function () {
  var p = makeProject();
  var g = CBModel.addRow(p, null, { no: '一', name: '分组' });
  CBModel.addRow(p, g.id, { no: '1', name: '长', expr: '12', unit: 'm' });
  CBModel.addRow(p, g.id, { no: '2', name: '宽', expr: '8', unit: 'm' });
  CBModel.addRow(p, g.id, { no: '3', name: '面积', expr: '[1]*[2]', unit: 'm2' });
  var c = CBModel.recalc(p);
  var tpl = CBReport.defaultTemplate(p, '工程量计算书');
  var html = CBReport.renderHTML(p, c, tpl, { GCMC: '某某住宅楼', BZR: '张三' });

  ok(html.indexOf('<!DOCTYPE html>') === 0, '输出完整 HTML 文档');
  ok(html.indexOf('某某住宅楼') > 0, '参数替换进标题');
  ok(html.indexOf('张三') > 0, '参数替换进副标题');
  ok(html.indexOf('96') > 0, '面积结果出现在报表中');
  ok(html.indexOf('合计') > 0, '含合计行');
  ok(html.indexOf('多单位') > 0, '多单位时合计行有提示');
  ok(html.indexOf('cb-summary') > 0, '多单位时附分单位小计表');
  ok(html.indexOf('汇总工程量') > 0, '小计表含汇总工程量列');
  ok(html.indexOf('多单位') > 0, '多单位时合计行有提示');
  ok(html.indexOf('cb-summary') > 0, '多单位时附分单位小计表');
  ok(html.indexOf('汇总工程量') > 0, '小计表含汇总工程量列');
  ok(html.indexOf('@page') > 0, '含打印样式');
  ok(html.indexOf('工程量计算书') > 0, '标题为计算书名称');

  var csv = CBExport.toCSV(p, c);
  ok(csv.charAt(0) === '\ufeff', 'CSV 带 BOM');
  ok(csv.indexOf('编号') > 0 && csv.indexOf('项目名称') > 0, 'CSV 表头');
  ok(csv.indexOf('96') > 0, 'CSV 含计算结果');
  ok(csv.indexOf('合计（m）') > 0, '多单位时按单位分行合计：m');
  ok(csv.indexOf('合计（m2）') > 0, '多单位时按单位分行合计：m2');
  var lines = csv.replace(/^\ufeff/, '').split('\r\n');
  eq(lines.length, 7, 'CSV 行数（表头 + 4 行 + 2 行分单位合计）');

  var md = CBExport.toMarkdown(p, c);
  ok(md.indexOf('|') === 0, 'Markdown 表格');
  eq(md.split('\n').length, 8, 'Markdown 行数（表头 2 + 4 行 + 2 行合计）');

  var tsv = CBExport.toTSV(p, c);
  ok(tsv.indexOf('\t') > 0, 'TSV 用制表符分隔');

  var txt = CBExport.toPlainText(p, c);
  ok(txt.indexOf('工程量计算书') < 0 && txt.indexOf('测试工程') === 0, '纯文本以工程名开头');
  ok(txt.indexOf('= 96') > 0, '纯文本含结果');
})();

group('9. 参数替换与单元格表达式');
(function () {
  var tpl = { params: [{ name: 'GCMC', default: '某工程' }, { name: 'BZSJ', default: '2026-09-10' }] };
  var params = CBReport.resolveParams(tpl, { GCMC: '测试楼' });
  ok(params.GCMC === '测试楼', '参数覆盖');
  ok(params.BZSJ === '2026-09-10', '参数默认值');
  ok(CBReport.evalCellText("'工程名称：' + %GCMC", params) === '工程名称：测试楼', '单元格表达式 %参数');
  ok(CBReport.evalCellText('标题', params) === '标题', '纯字面量单元格');
})();

group('10. 边界与异常');
(function () {
  almost(evalExpr('0.1+0.2'), 0.3, 1e-9, '浮点加法');
  eq(CBExpr.helpers.roundTo(0.1 + 0.2, 2), 0.3, 'roundTo 消除浮点噪声');
  eq(CBExpr.helpers.roundTo(-1.005, 2), -1.01, '负数取整');
  ok(evalExpr("'' = 0") === false, '空串不等于 0（按字符串比较）');
  almost(evalExpr("'3.5' * 2"), 7, 1e-9, '字符串隐式转数值');
  eq(CBExpr.helpers.toNum(''), 0, 'toNum 空串');
  almost(evalExpr('1e3'), 1000, 1e-9, '科学计数法');

  // 空表达式行
  var p = CBModel.newProject();
  p.rows = [];
  CBModel.addRow(p, null, { no: '1', name: '空行' });
  var c = CBModel.recalc(p);
  eq(c.errors.length, 0, '空表达式不算错误');
  eq(c.results[p.rows[0].id].gcl, 0, '空表达式工程量为 0');

  // validate 对非对象
  eq(CBModel.validate(null).ok, false, 'validate(null) 返回失败');
  throws(function () { CBModel.deserialize('{bad json'); }, '非法 JSON 报错');
})();

group('11. 内置函数库（示例几何函数）');
(function () {
  var p = CBModel.newProject();
  p.rows = [];
  var fns = {};
  p.functions.forEach(function (f) { fns[f.name] = f; });
  ok(!!fns['矩形面积'], '含矩形面积');
  ok(!!fns['梯形面积'], '含梯形面积');
  ok(!!fns['圆柱体积'], '含圆柱体积');

  CBModel.addRow(p, null, { no: '1', name: '矩形面积', expr: '矩形面积(3, 4)', unit: 'm2' });
  CBModel.addRow(p, null, { no: '2', name: '梯形面积', expr: '梯形面积(2, 4, 3)', unit: 'm2' });
  CBModel.addRow(p, null, { no: '3', name: '圆柱体积', expr: '圆柱体积(1, 10)', unit: 'm3' });
  var c = CBModel.recalc(p);
  var byNo = {};
  p.rows.forEach(function (r) { byNo[r.no] = c.results[r.id]; });
  eq(c.errors.length, 0, '内置函数调用无错误');
  almost(byNo['1'].value, 12, 1e-9, '矩形面积 3×4');
  almost(byNo['2'].value, 9, 1e-9, '梯形面积 (2+4)×3/2');
  almost(byNo['3'].value, 31.42, 1e-9, '圆柱体积 π×1²×10（行单位 m3 精度 2）');
})();

/* ============================ 汇总 ============================ */
console.log('\n' + '─'.repeat(60));
if (failed === 0) {
  console.log('\x1b[32m全部通过\x1b[0m  ' + passed + ' 项断言');
} else {
  console.log('\x1b[31m失败 ' + failed + ' 项\x1b[0m / 共 ' + (passed + failed) + ' 项');
  console.log('\n失败明细：');
  failures.forEach(function (f) { console.log('  • ' + f); });
}
process.exit(failed === 0 ? 0 : 1);
