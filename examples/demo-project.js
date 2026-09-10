/*!
 * OpenCalcBook — 示例工程
 * ---------------------------------------------------------------------------
 * 一个"某住宅楼工程量计算书"的最小可用样例，用于演示：
 *   分组树 / 行引用 / 常量库 / 汇总变量 / 自定义函数 / 单位精度
 *
 * 该文件只描述数据，通过 CBModel 构建工程对象；
 * 浏览器（window.CBDemo）与 Node（module.exports）都可使用。
 *
 * License: MIT
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../src/model.js'));
  else root.CBDemo = factory(root.CBModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CBModel) {
  'use strict';

  function build() {
    var p = CBModel.newProject({
      name: '某住宅楼工程量计算书',
      author: '示例',
      remark: '由 OpenCalcBook 示例工程生成，可自由修改'
    });

    /* ---------------- 常量库 ---------------- */
    p.constants = [
      { code: 'K1', value: '1.25', description: '土方放坡系数' },
      { code: 'H1', value: '1.8', description: '基础埋深 (m)' },
      { code: 'N1', value: '24', description: '基坑 / 柱数量 (个)' },
      { code: 'STEEL', value: '0.12', description: '综合含钢量 (t/m³)' }
    ];

    /* ---------------- 计量单位表 ---------------- */
    p.unitTable = [
      { name: 'm', order: 1, precision: 3 },
      { name: 'm2', order: 2, precision: 2 },
      { name: 'm3', order: 3, precision: 3 },
      { name: '个', order: 4, precision: 0 },
      { name: 't', order: 5, precision: 3 },
      { name: '', order: 6, precision: 2 }
    ];

    /* ---------------- 计算式 ---------------- */
    p.rows = [];

    function group(no, name, part) {
      return CBModel.addRow(p, null, { no: no, name: name, part: part || '', summary: true });
    }
    function item(pid, data) {
      var base = { unit: '', factor: 1 };
      for (var k in data) base[k] = data[k];
      return CBModel.addRow(p, pid, base);
    }

    /* ===== 一、土石方工程 ===== */
    var g1 = group('一', '土石方工程', '基础');
g1.unit = 'm3';          // 分组单位：只汇总同为 m³ 的子行
    item(g1.id, { no: '1.1', name: '建筑总长', expr: '42.6', unit: 'm', remark: '轴线尺寸' });
    item(g1.id, { no: '1.2', name: '建筑总宽', expr: '13.8', unit: 'm', remark: '轴线尺寸' });
    item(g1.id, { no: '1.3', name: '首层建筑面积', expr: '[1.1] * [1.2]', unit: 'm2' });
    item(g1.id, { no: '1.4', name: '基础埋深', expr: '@H1', unit: 'm' });
    item(g1.id, { no: '1.5', name: '放坡系数', expr: '@K1' });
    item(g1.id, { no: '1.6', name: '基坑长', expr: '3.2', unit: 'm' });
    item(g1.id, { no: '1.7', name: '基坑宽', expr: '2.6', unit: 'm' });
    item(g1.id, { no: '1.8', name: '基坑数量', expr: '@N1', unit: '个' });
    item(g1.id, { no: '1.9', name: '平整场地', expr: '[1.3]', unit: 'm2', remark: '按首层建筑面积计' });
    item(g1.id, {
      no: '1.10', name: '挖基础土方（单坑）', unit: 'm3',
      expr: '长方体体积([1.6], [1.7], [1.4])'
    });
    item(g1.id, { no: '1.11', name: '挖基础土方（合计）', expr: '[1.10] * [1.8]', unit: 'm3' });
    item(g1.id, {
      no: '1.12', name: '放坡增加土方', unit: 'm3',
      expr: '[1.10] * ([1.5] - 1) * [1.8]',
      remark: '简化按系数增量计算；工程实务应按棱台公式'
    });

    /* ===== 二、混凝土工程 ===== */
    var g2 = group('二', '混凝土工程', '基础、主体');
g2.unit = 'm3';
    item(g2.id, { no: '2.1', name: '垫层厚度', expr: '0.1', unit: 'm' });
    item(g2.id, { no: '2.2', name: '垫层平面长', expr: '[1.6] + 0.2', unit: 'm', remark: '每边外扩 100mm' });
    item(g2.id, { no: '2.3', name: '垫层平面宽', expr: '[1.7] + 0.2', unit: 'm' });
    item(g2.id, { no: '2.4', name: '垫层体积（单个）', expr: '[2.2] * [2.3] * [2.1]', unit: 'm3' });
    item(g2.id, { no: '2.5', name: '垫层体积（合计）', expr: '[2.4] * [1.8]', unit: 'm3' });
    item(g2.id, { no: '2.6', name: '基础底面长', expr: '2.8', unit: 'm' });
    item(g2.id, { no: '2.7', name: '基础底面宽', expr: '2.2', unit: 'm' });
    item(g2.id, { no: '2.8', name: '基础高度', expr: '0.5', unit: 'm' });
    item(g2.id, { no: '2.9', name: '独立基础体积（单个）', expr: '[2.6] * [2.7] * [2.8]', unit: 'm3' });
    item(g2.id, { no: '2.10', name: '独立基础体积（合计）', expr: '[2.9] * [1.8]', unit: 'm3' });
    item(g2.id, { no: '2.11', name: '柱截面长', expr: '0.5', unit: 'm' });
    item(g2.id, { no: '2.12', name: '柱截面宽', expr: '0.5', unit: 'm' });
    item(g2.id, { no: '2.13', name: '柱高', expr: '3.6', unit: 'm' });
    item(g2.id, { no: '2.14', name: '柱体积（单根）', expr: '[2.11] * [2.12] * [2.13]', unit: 'm3' });
    item(g2.id, { no: '2.15', name: '柱体积（合计）', expr: '[2.14] * [1.8]', unit: 'm3' });

    /* ===== 三、土方回填 ===== */
    var g3 = group('三', '土方回填', '基础');
g3.unit = 'm3';
    item(g3.id, {
      no: '3.1', name: '回填土体积',
      expr: '[1.11] + [1.12] - [2.5] - [2.10]', unit: 'm3',
      remark: '开挖总量扣除垫层与基础体积'
    });
    item(g3.id, {
      no: '3.2', name: '余土外运',
      expr: 'iif([3.1] > 0, [1.11] + [1.12] - [3.1], 0)', unit: 'm3',
      remark: '回填后剩余需外运的土方'
    });

    /* ===== 四、模板工程 ===== */
    var g4 = group('四', '模板工程', '基础、主体');
g4.unit = 'm2';
    item(g4.id, { no: '4.1', name: '基础底面周长', expr: '2 * ([2.6] + [2.7])', unit: 'm' });
    item(g4.id, { no: '4.2', name: '独立基础模板面积', expr: '[4.1] * [2.8] * [1.8]', unit: 'm2' });
    item(g4.id, {
      no: '4.3', name: '矩形柱模板面积',
      expr: '2 * ([2.11] + [2.12]) * [2.13] * [1.8]', unit: 'm2'
    });
    item(g4.id, {
      no: '4.4', name: '模板总面积', expr: '[4.2] + [4.3]', unit: 'm2', summary: true
    });

    /* ===== 五、零星工程（演示自定义函数与单位换算） ===== */
    var g5 = group('五', '零星工程', '室外');
g5.unit = 'm2';
    item(g5.id, { no: '5.1', name: '检查井盖半径', expr: '35', unit: 'cm', remark: '直径 700mm' });
    item(g5.id, {
      no: '5.2', name: '检查井盖面积', unit: 'm2',
      expr: '圆形面积(换算([5.1], \'cm\', \'m\'))'
    });
    item(g5.id, { no: '5.3', name: '检查井盖合计面积', expr: '[5.2] * 12', unit: 'm2', remark: '共 12 座' });
    item(g5.id, {
      no: '5.4', name: '井盖周长合计', unit: 'm',
      expr: '2 * PI() * 换算([5.1], \'cm\', \'m\') * 12'
    });

    /* ===== 六、分部汇总（演示汇总变量） ===== */
    p.variables = [
      { code: 'TUFANG', expr: '[1.11] + [1.12]', description: '土方开挖总量 (m³)' },
      { code: 'HUITIAN', expr: '[3.1]', description: '回填土总量 (m³)' },
      { code: 'HNT', expr: '[2.5] + [2.10] + [2.15]', description: '混凝土总量 (m³)' },
      { code: 'MB', expr: '[4.4]', description: '模板总面积 (m²)' }
    ];

    var g6 = group('六', '分部汇总', '');
g6.unit = 'm3';
    item(g6.id, { no: '6.1', name: '土方开挖总量', expr: '$TUFANG', unit: 'm3' });
    item(g6.id, { no: '6.2', name: '回填土总量', expr: '$HUITIAN', unit: 'm3' });
    item(g6.id, { no: '6.3', name: '混凝土总量', expr: '$HNT', unit: 'm3', remark: '垫层 + 独立基础 + 柱' });
    item(g6.id, { no: '6.4', name: '模板总面积', expr: '$MB', unit: 'm2' });
    item(g6.id, {
      no: '6.5', name: '钢筋估算', expr: '[6.3] * @STEEL', unit: 't',
      remark: '按 0.12 t/m³ 综合含钢量估算'
    });

    return p;
  }

  /** 示例报表模板（在默认模板基础上调整参数默认值） */
  function reportTemplate(project, CBReport) {
    var tpl = CBReport.defaultTemplate(project, '工程量计算书');
    tpl.params.forEach(function (x) {
      if (x.name === 'GCMC') x.default = project.meta.name;
      if (x.name === 'BZR') x.default = project.meta.author;
      if (x.name === 'JSSMC') x.default = '工程量计算书';
    });
    return tpl;
  }

  return { build: build, reportTemplate: reportTemplate };
});
