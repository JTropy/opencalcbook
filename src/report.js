/*!
 * OpenCalcBook / 开源计算书 — 区带报表
 * ---------------------------------------------------------------------------
 * 报表模型参考了"区带报表"（PageHeader / ColumnHeader / PageBody / PageFooter）
 * 的思路：页面分成若干区带，每个区带里是文本或表格格。
 *
 * 单元格取值两种写法：
 *   %参数名       —— 报表参数，替换为参数值（字符串）
 *   #字段名       —— 数据行字段（仅正文区可用）
 * 文本类单元格还可以直接写表达式，例如：
 *   '工程名称：' + %GCMC
 *
 * 输出：一段可直接打印（Ctrl+P）的独立 HTML。
 *
 * License: MIT
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./expr.js'), require('./units.js'), require('./model.js'));
  } else {
    root.CBReport = factory(root.CBExpr, root.CBUnits, root.CBModel);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CBExpr, CBUnits, CBModel) {
  'use strict';

  var FORMAT = 'opencalcbook-report';
  var VERSION = 1;

  /* =======================================================================
   * 工具
   * ===================================================================== */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad2(x) { return (x < 10 ? '0' : '') + x; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 数值按单位精度格式化；文本原样输出 */
  function fmtVal(v, table, unit) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return CBUnits.format(v, table, unit, false);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v);
  }

  /* =======================================================================
   * 默认模板：由列配置推导
   * ===================================================================== */
  function defaultTemplate(project, name) {
    var cols = (project.columns || []).filter(function (c) { return c.reportVisible; });
    if (!cols.length) cols = (project.columns || []).slice(0, 5);

    return {
      format: FORMAT,
      version: VERSION,
      name: name || '计算书',
      page: {
        size: 'A4',
        orientation: 'portrait',
        margin: { top: 15, right: 12, bottom: 15, left: 12 },
        baseFontSize: 10,
        baseFont: '"宋体", SimSun, "Microsoft YaHei", sans-serif'
      },
      params: [
        { name: 'GCMC', label: '工程名称', type: 'text', default: project.meta && project.meta.name || '' },
        { name: 'JSSMC', label: '计算书名称', type: 'text', default: name || '计算书' },
        { name: 'BZR', label: '编制人', type: 'text', default: project.meta && project.meta.author || '' },
        { name: 'BZDW', label: '编制单位', type: 'text', default: '' },
        { name: 'BZSJ', label: '编制时间', type: 'date', default: todayStr() },
        { name: 'BT', label: '标题', type: 'text', default: name || '计算书' }
      ],
      header: {
        show: true,
        title: '%BT',
        titleSize: 18,
        lines: [
          "'工程名称：' + %GCMC + '    计算书名称：' + %JSSMC",
          "'编制单位：' + %BZDW + '    编制人：' + %BZR + '    编制时间：' + %BZSJ"
        ]
      },
      columns: cols.map(function (c) {
        return {
          field: c.key,
          title: c.title,
          width: widthFor(c),
          align: c.align || (c.type === 'result' || c.type === 'number' ? 'right' : 'left'),
          isNo: c.key === 'no',
          isNumber: c.type === 'result' || c.type === 'number'
        };
      }),
      body: {
        indentName: true,
        boldGroup: true,
        repeatHeader: true,
        showTotalRow: true,
        totalLabel: '合计',
        totalField: 'gcl'
      },
      footer: {
        show: true,
        note: '本计算书由 OpenCalcBook 生成',
        showSignature: false,
        signLabels: ['计算', '复核', '审核']
      }
    };
  }

  function widthFor(col) {
    var w = parseInt(col.width, 10);
    if (!isFinite(w)) w = 100;
    return w;
  }

  /* =======================================================================
   * 参数替换
   * ===================================================================== */
  function resolveParams(template, overrides) {
    var out = Object.create(null);
    (template.params || []).forEach(function (p) {
      var v = (overrides && Object.prototype.hasOwnProperty.call(overrides, p.name))
        ? overrides[p.name] : p.default;
      out[p.name] = v === undefined || v === null ? '' : v;
    });
    return out;
  }

  /** 把 %NAME 替换成已加引号的字符串字面量 */
  function substituteParams(text, params) {
    return String(text).replace(/%([A-Za-z_\u00a1-\uffff][A-Za-z0-9_\u00a1-\uffff]*)/g, function (m, name) {
      var v = params[name];
      if (v === undefined) return m;
      return "'" + String(v).replace(/'/g, "''") + "'";
    });
  }

  /** 计算一个"文本单元格"——可以是字面量也可以是表达式 */
  function evalCellText(text, params, rowCtx) {
    var s = String(text == null ? '' : text);
    if (s.indexOf('%') < 0 && s.indexOf("'") !== 0) {
      // 纯字面量，但仍然允许 #字段
      return s.replace(/#([A-Za-z_\u00a1-\uffff][A-Za-z0-9_\u00a1-\uffff]*)/g, function (m, f) {
        return rowCtx && rowCtx[f] !== undefined ? String(rowCtx[f]) : m;
      });
    }
    var src = substituteParams(s, params);
    try {
      var v = CBExpr.run(src, {
        builtin: CBExpr.builtins,
        const: function (n) { throw CBExpr.ExprError('报表中不支持常量 @' + n); },
        variable: function (n) { return params[n] !== undefined ? params[n] : ''; },
        row: function (n) { throw CBExpr.ExprError('报表文本中不支持行引用'); },
        deref: function (r) { return r; },
        rowRange: function () { throw CBExpr.ExprError('报表文本中不支持行区间'); },
        customFunction: function () { return null; }
      });
      return CBExpr.helpers.toStr(v);
    } catch (e) {
      return s;
    }
  }

  /* =======================================================================
   * 正文行数据准备
   * ===================================================================== */
  function buildRows(project, results, template) {
    var ordered = CBModel.flatten(project);
    var rows = [];
    ordered.forEach(function (r) {
      var e = results.results[r.id];
      if (!e) return;
      var unit = r.unit || '';
      var prec = e.precision;
      rows.push({
        id: r.id,
        depth: r.__depth || 0,
        no: r.no == null ? '' : String(r.no),
        name: r.name || '',
        part: r.part || '',
        expr: r.expr || '',
        unit: unit,
        factor: r.factor,
        value: e.value,
        valueText: fmtVal(e.value, project.unitTable, unit),
        gcl: e.gcl,
        gclText: fmtVal(e.gcl, project.unitTable, unit),
        remark: r.remark || '',
        code: r.code || '',
        ignore: !!r.ignore,
        summary: !!r.summary,
        isGroup: !!e.hasChildren,
        error: e.error ? e.error.message : null,
        raw: r
      });
    });

    // 合计：按单位分开统计（不同单位相加没有意义）
    var buckets = Object.create(null);
    rows.forEach(function (x) {
      if (x.isGroup || x.ignore) return;
      var u = CBUnits.normalize(x.unit) || '';
      if (!buckets[u]) buckets[u] = { unit: u, total: 0, count: 0 };
      buckets[u].total += Number(x.gcl) || 0;
      buckets[u].count += 1;
    });
    var units = Object.keys(buckets);
    var totals = {
      mixed: units.length > 1,
      byUnit: units.map(function (u) {
        var p = CBUnits.precisionOf(project.unitTable, u);
        return {
          unit: u,
          total: CBExpr.helpers.roundTo(buckets[u].total, p),
          totalText: CBUnits.format(CBExpr.helpers.roundTo(buckets[u].total, p), project.unitTable, u, false),
          count: buckets[u].count
        };
      }),
      unit: units.length === 1 ? units[0] : '',
      gcl: 0,
      gclText: ''
    };
    if (!totals.mixed) {
      totals.gcl = units.length ? totals.byUnit[0].total : 0;
      totals.gclText = units.length ? totals.byUnit[0].totalText : '';
    }

    return { rows: rows, totals: totals };
  }

  function cellValue(row, col, totals) {
    switch (col.field) {
      case 'no': return row.no;
      case 'name': return row.name;
      case 'part': return row.part;
      case 'expr': return row.expr;
      case 'unit': return row.unit;
      case 'factor': return row.factor;
      case 'value': return row.valueText;
      case 'gcl': return row.gclText;
      case 'gclExpr': return row.raw.gclExpr || '';
      case 'code': return row.code;
      case 'remark': return row.remark;
      case 'ignore': return row.ignore ? '√' : '';
      case 'summary': return row.summary ? '√' : '';
      default:
        if (row.raw.fields && Object.prototype.hasOwnProperty.call(row.raw.fields, col.field)) {
          return row.raw.fields[col.field];
        }
        return '';
    }
  }

  /* =======================================================================
   * 渲染
   * ===================================================================== */
  /**
   * @param {object} project
   * @param {object} calc       CBModel.recalc() 的结果
   * @param {object} template
   * @param {object} [overrides] 参数覆盖
   * @param {object} [opts]     { standalone:true 时输出完整 HTML 文档 }
   */
  function renderHTML(project, calc, template, overrides, opts) {
    opts = opts || {};
    var tpl = template || defaultTemplate(project);
    var params = resolveParams(tpl, overrides);
    var built = buildRows(project, calc || CBModel.recalc(project), tpl);
    var page = tpl.page || {};
    var margin = page.margin || { top: 15, right: 12, bottom: 15, left: 12 };
    var orient = page.orientation === 'landscape' ? 'landscape' : 'portrait';

    var css = [
      ':root{--cb-font:' + (page.baseFont || 'sans-serif') + ';}',
      '*{box-sizing:border-box;}',
      'body{margin:0;padding:0;font-family:var(--cb-font);font-size:' + (page.baseFontSize || 10) + 'pt;color:#000;background:#fff;}',
      '.cb-page{width:' + (orient === 'landscape' ? '297mm' : '210mm') + ';min-height:' + (orient === 'landscape' ? '210mm' : '297mm') +
      ';padding:' + margin.top + 'mm ' + margin.right + 'mm ' + margin.bottom + 'mm ' + margin.left + 'mm;margin:0 auto;background:#fff;}',
      '.cb-head{margin-bottom:4mm;}',
      '.cb-title{text-align:center;font-weight:bold;font-size:' + (tpl.header && tpl.header.titleSize || 18) + 'pt;margin:0 0 3mm;}',
      '.cb-headline{font-size:10pt;margin:1mm 0;white-space:pre-wrap;}',
      'table.cb-grid{border-collapse:collapse;width:100%;table-layout:fixed;}',
      'table.cb-grid th,table.cb-grid td{border:1px solid #000;padding:1.2mm 1.5mm;vertical-align:middle;word-break:break-all;}',
      'table.cb-grid th{background:#f0f0f0;font-weight:bold;text-align:center;}',
      'table.cb-grid td.grp{font-weight:bold;background:#fafafa;}',
      'table.cb-grid tr.err td{background:#ffecec;}',
      'table.cb-grid td.num{text-align:right;font-variant-numeric:tabular-nums;}',
      'table.cb-grid td.ctr{text-align:center;}',
      'table.cb-summary{margin-top:5mm;border-collapse:collapse;width:auto;min-width:60%;}',
      'table.cb-summary th,table.cb-summary td{border:1px solid #000;padding:1.2mm 4mm;font-size:9pt;}',
      'table.cb-summary th{background:#f0f0f0;}',
      'table.cb-summary td.num{text-align:right;font-variant-numeric:tabular-nums;}',
      'table.cb-summary caption{caption-side:top;text-align:left;font-size:9pt;font-weight:bold;padding-bottom:1mm;}',
      '.cb-err{color:#c00;font-size:8pt;}',
      '.cb-foot{margin-top:4mm;font-size:9pt;}',
      '.cb-sign{display:flex;gap:8mm;margin-top:6mm;}',
      '.cb-sign span{flex:1;border-bottom:1px solid #000;height:8mm;}',
      '.cb-note{margin-top:6mm;color:#666;font-size:8pt;text-align:right;}',
      '@page{size:A4 ' + orient + ';margin:' + margin.top + 'mm ' + margin.right + 'mm ' + margin.bottom + 'mm ' + margin.left + 'mm;}',
      '@media print{body{background:#fff;}.cb-page{width:auto;min-height:0;padding:0;margin:0;}}'
    ].join('\n');

    var html = [];
    if (opts.standalone !== false) {
      html.push('<!DOCTYPE html>');
      html.push('<html lang="zh-CN"><head><meta charset="utf-8">');
      html.push('<title>' + esc(params['BT'] || tpl.name || '计算书') + '</title>');
      html.push('<style>' + css + '</style></head><body>');
    } else {
      html.push('<style>' + css + '</style>');
    }

    html.push('<div class="cb-page">');

    // ---- PageHeader ----
    if (tpl.header && tpl.header.show !== false) {
      html.push('<div class="cb-head">');
      if (tpl.header.title) {
        html.push('<div class="cb-title">' + esc(evalCellText(tpl.header.title, params)) + '</div>');
      }
      (tpl.header.lines || []).forEach(function (line) {
        html.push('<div class="cb-headline">' + esc(evalCellText(line, params)) + '</div>');
      });
      html.push('</div>');
    }

    // ---- ColumnHeader + Body ----
    var cols = tpl.columns || [];
    html.push('<table class="cb-grid">');
    html.push('<colgroup>');
    cols.forEach(function (c) { html.push('<col style="width:' + c.width + 'px">'); });
    html.push('</colgroup>');

    html.push('<thead><tr>');
    cols.forEach(function (c) {
      html.push('<th>' + esc(c.title) + '</th>');
    });
    html.push('</tr></thead>');

    html.push('<tbody>');
    built.rows.forEach(function (row) {
      var cls = 'depth-' + row.depth;
      if (row.error) cls += ' err';
      html.push('<tr class="' + cls + '">');
      cols.forEach(function (c) {
        var v = cellValue(row, c, built.totals);
        var clsC = [];
        if (c.align === 'right') clsC.push('num');
        else if (c.align === 'center') clsC.push('ctr');
        if (row.isGroup && tpl.body && tpl.body.boldGroup && (c.field === 'name' || c.field === 'no')) clsC.push('grp');
        var text = String(v === null || v === undefined ? '' : v);
        if (text === '') text = '';
        if (c.field === 'name' && tpl.body && tpl.body.indentName && row.depth > 0) {
          text = '　'.repeat(row.depth) + text;
        }
        if (c.field === 'no' && row.depth > 0 && tpl.body && !tpl.body.indentName) {
          text = '　'.repeat(row.depth) + text;
        }
        html.push('<td class="' + clsC.join(' ') + '">' + esc(text) +
          (row.error && c.field === 'gcl' ? '<div class="cb-err">' + esc(row.error) + '</div>' : '') + '</td>');
      });
      html.push('</tr>');
    });
    html.push('</tbody>');

    // ---- 合计行 ----
    if (tpl.body && tpl.body.showTotalRow) {
      var span = totalColspan(cols);
      var label = tpl.body.totalLabel || '合计';
      if (built.totals.mixed) label += '（多单位，详见下方小计）';
      html.push('<tfoot><tr>');
      html.push('<td class="ctr grp" colspan="' + span + '">' + esc(label) + '</td>');
      for (var ci = span; ci < cols.length; ci++) {
        var tc = cols[ci];
        var tv = '';
        if (tc.field === tpl.body.totalField) tv = built.totals.mixed ? '' : built.totals.gclText;
        else if (tc.field === 'unit') tv = built.totals.mixed ? '' : (built.totals.unit || '');
        html.push('<td class="' + alignClass(tc) + '">' + esc(tv) + '</td>');
      }
      html.push('</tr></tfoot>');
    }

    html.push('</table>');

    // ---- 分单位小计（对应"汇总表"：名称 / 单位 / 汇总工程量） ----
    if (tpl.body && tpl.body.showTotalRow && built.totals.mixed && built.totals.byUnit.length) {
      html.push('<table class="cb-summary">');
      html.push('<thead><tr><th>序号</th><th>计量单位</th><th>行数</th><th>汇总工程量</th></tr></thead><tbody>');
      built.totals.byUnit.forEach(function (t, i) {
        html.push('<tr><td class="ctr">' + (i + 1) + '</td><td>' + esc(t.unit || '（无单位）') +
          '</td><td class="ctr">' + t.count + '</td><td class="num">' + esc(t.totalText) + '</td></tr>');
      });
      html.push('</tbody></table>');
    }

    // ---- PageFooter ----
    if (tpl.footer && tpl.footer.show !== false) {
      html.push('<div class="cb-foot">');
      if (tpl.footer.showSignature) {
        html.push('<div class="cb-sign">');
        (tpl.footer.signLabels || ['计算', '复核', '审核']).forEach(function (l) {
          html.push('<span>' + esc(l) + '：</span>');
        });
        html.push('</div>');
      }
      if (tpl.footer.note) {
        html.push('<div class="cb-note">' + esc(evalCellText(tpl.footer.note, params)) + '</div>');
      }
      html.push('</div>');
    }

    html.push('</div>');

    if (opts.standalone !== false) html.push('</body></html>');
    return html.join('\n');
  }

  function alignClass(c) {
    if (!c) return '';
    if (c.align === 'right') return 'num';
    if (c.align === 'center') return 'ctr';
    if (c.isNumber) return 'num';
    return '';
  }

  /** 合计行里"合计"二字占用的列数（合并到最后一个数值列之前） */
  function totalColspan(cols) {
    if (!cols.length) return 1;
    var numberIdx = -1;
    for (var i = cols.length - 1; i >= 0; i--) {
      if (cols[i].isNumber) { numberIdx = i; break; }
    }
    if (numberIdx < 1) return Math.max(1, cols.length - 1);
    return numberIdx;
  }

  /** 仅渲染正文表格（用于嵌入应用内预览） */
  function renderPreview(project, calc, template, overrides) {
    var full = renderHTML(project, calc, template, overrides, { standalone: false });
    return full;
  }

  return {
    FORMAT: FORMAT,
    VERSION: VERSION,
    defaultTemplate: defaultTemplate,
    resolveParams: resolveParams,
    buildRows: buildRows,
    renderHTML: renderHTML,
    renderPreview: renderPreview,
    substituteParams: substituteParams,
    evalCellText: evalCellText,
    todayStr: todayStr
  };
});
