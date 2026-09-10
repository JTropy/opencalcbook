/*!
 * OpenCalcBook / 开源计算书 — 导出
 * ---------------------------------------------------------------------------
 * 支持：CSV（Excel 可直接打开，带 BOM）、TSV、Markdown 表格、
 *       纯文本计算书、内联 HTML（走区带报表）、工程 JSON。
 *
 * 合计规则：单单位时一行「合计」；多单位时按单位分行（不同单位相加没有意义）。
 *
 * License: MIT
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'), require('./units.js'), require('./report.js'));
  } else {
    root.CBExport = factory(root.CBModel, root.CBUnits, root.CBReport);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CBModel, CBUnits, CBReport) {
  'use strict';

  /* =======================================================================
   * 小工具
   * ===================================================================== */
  function fmtCell(v) {
    if (v === null || v === undefined) return '';
    return String(v);
  }

  /** 数值按单位精度格式化；文本原样输出 */
  function fmtVal(v, table, unit) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return CBUnits.format(v, table, unit, false);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v);
  }

  function repeat(s, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += s;
    return out;
  }

  function displayWidth(s) {
    s = String(s === null || s === undefined ? '' : s);
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charCodeAt(i);
      w += (ch > 0x2e80 && ch < 0xffef) ? 2 : 1;
    }
    return w;
  }
  function padEndStr(s, n) { return String(s) + repeat(' ', Math.max(0, n - displayWidth(s))); }
  function padStartStr(s, n) { return repeat(' ', Math.max(0, n - displayWidth(s))) + String(s); }

  function quoteCSV(s, sep) {
    var t = String(s);
    var need = t.indexOf('"') >= 0 || t.indexOf(sep) >= 0 || /[\n\r]/.test(t);
    if (t.indexOf('"') >= 0) t = t.replace(/"/g, '""');
    return need ? ('"' + t + '"') : t;
  }

  /** 收集叶子行的按单位小计 */
  function collectTotals(project, calc) {
    var buckets = Object.create(null);
    CBModel.flatten(project).forEach(function (r) {
      var e = calc.results[r.id];
      if (!e || e.hasChildren || r.ignore) return;
      var u = CBUnits.normalize(r.unit || '') || '';
      if (!buckets[u]) buckets[u] = { unit: u, total: 0, count: 0 };
      buckets[u].total += Number(e.gcl) || 0;
      buckets[u].count += 1;
    });
    return buckets;
  }

  function totalRows(buckets) {
    var units = Object.keys(buckets);
    if (units.length <= 1) {
      var u0 = units.length ? units[0] : '';
      return [{ label: '合计', unit: u0, total: units.length ? buckets[u0].total : 0 }];
    }
    return units.map(function (u) {
      return { label: '合计（' + (u || '无单位') + '）', unit: u, total: buckets[u].total };
    });
  }

  /* =======================================================================
   * 通用字段取值
   * ===================================================================== */
  function cellOf(project, calc, row, key, indentChar) {
    var e = calc.results[row.id];
    var unit = row.unit || '';
    switch (key) {
      case 'no': return row.no == null ? '' : String(row.no);
      case 'name':
        return (indentChar && row.__depth ? repeat(indentChar, row.__depth) : '') + (row.name || '');
      case 'part': return row.part || '';
      case 'expr': return row.expr || '';
      case 'unit': return unit;
      case 'factor': return row.factor;
      case 'value': return (e.value === null || e.value === undefined) ? '' : fmtVal(e.value, project.unitTable, unit);
      case 'gcl': return fmtVal(e.gcl, project.unitTable, unit);
      case 'gclExpr': return row.gclExpr || '';
      case 'code': return row.code || '';
      case 'remark': return e.error ? ('⚠ ' + e.error.message) : (row.remark || '');
      case 'ignore': return row.ignore ? '√' : '';
      case 'summary': return row.summary ? '√' : '';
      default:
        if (row.fields && Object.prototype.hasOwnProperty.call(row.fields, key)) return row.fields[key];
        return '';
    }
  }

  /* =======================================================================
   * 分隔符文本（CSV / TSV）
   * ===================================================================== */
  function toDelimited(project, calc, opts) {
    opts = opts || {};
    var sep = opts.sep || ',';
    var c = calc || CBModel.recalc(project);
    var cols = (opts.columns || project.columns || []).filter(function (x) { return x.visible !== false; });
    var ordered = CBModel.flatten(project);
    var lines = [];

    if (opts.includeHeaderLine) {
      lines.push(['工程名称', (project.meta && project.meta.name) || ''].map(function (x) { return quoteCSV(x, sep); }).join(sep));
      lines.push(['编制时间', CBReport.todayStr()].map(function (x) { return quoteCSV(x, sep); }).join(sep));
      lines.push('');
    }

    lines.push(cols.map(function (x) { return quoteCSV(x.title, sep); }).join(sep));

    ordered.forEach(function (r) {
      var cells = cols.map(function (col) {
        return quoteCSV(fmtCell(cellOf(project, c, r, col.key, '  ')), sep);
      });
      lines.push(cells.join(sep));
    });

    if (opts.includeTotal !== false) {
      var idxGcl = -1;
      cols.forEach(function (x, i) { if (x.key === 'gcl') idxGcl = i; });
      totalRows(collectTotals(project, c)).forEach(function (t) {
        var row = cols.map(function (x, i) {
          if (i === 0) return t.label;
          if (x.key === 'gcl' && idxGcl >= 0) return fmtVal(t.total, project.unitTable, t.unit);
          if (x.key === 'unit') return t.unit;
          return '';
        });
        lines.push(row.map(function (x) { return quoteCSV(x, sep); }).join(sep));
      });
    }

    var text = lines.join('\r\n');
    if (opts.bom !== false && sep === ',') text = '\ufeff' + text;
    return text;
  }

  function toCSV(project, calc, opts) {
    opts = opts || {};
    opts.sep = opts.sep || ',';
    return toDelimited(project, calc, opts);
  }

  function toTSV(project, calc, opts) {
    opts = opts || {};
    opts.sep = '\t';
    opts.bom = false;
    return toDelimited(project, calc, opts);
  }

  /* =======================================================================
   * Markdown
   * ===================================================================== */
  function toMarkdown(project, calc) {
    var c = calc || CBModel.recalc(project);
    var cols = (project.columns || []).filter(function (x) { return x.visible !== false; });
    var ordered = CBModel.flatten(project);
    var out = [];

    out.push('| ' + cols.map(function (x) { return x.title; }).join(' | ') + ' |');
    out.push('|' + cols.map(function (x) {
      return (x.type === 'result' || x.type === 'number') ? '---:' : ':---';
    }).join('|') + '|');

    ordered.forEach(function (r) {
      out.push('| ' + cols.map(function (col) {
        return String(cellOf(project, c, r, col.key, '　')).replace(/\|/g, '\\|');
      }).join(' | ') + ' |');
    });

    totalRows(collectTotals(project, c)).forEach(function (t) {
      out.push('| ' + cols.map(function (x, i) {
        if (i === 0) return '**' + t.label + '**';
        if (x.key === 'gcl') return '**' + fmtVal(t.total, project.unitTable, t.unit) + '**';
        if (x.key === 'unit') return t.unit;
        return '';
      }).join(' | ') + ' |');
    });

    return out.join('\n');
  }

  /* =======================================================================
   * 纯文本计算书
   * ===================================================================== */
  function toPlainText(project, calc, opts) {
    opts = opts || {};
    var c = calc || CBModel.recalc(project);
    var ordered = CBModel.flatten(project);
    var indent = opts.indent === undefined ? '    ' : opts.indent;
    var out = [];
    var meta = project.meta || {};

    out.push(meta.name || '计算书');
    if (meta.author) out.push('编制人：' + meta.author);
    if (meta.remark) out.push('说明：' + meta.remark);
    out.push('');

    ordered.forEach(function (r) {
      var e = c.results[r.id];
      if (!e) return;
      var pad = repeat(indent, r.__depth || 0);

      if (e.hasChildren) {
        out.push('');
        out.push(pad + '【' + (r.no ? r.no + ' ' : '') + (r.name || '') + '】' +
          ((e.gcl === null || e.gcl === undefined) ? '' :
            '  合计 ' + fmtVal(e.gcl, project.unitTable, r.unit) + (r.unit ? ' ' + r.unit : '')));
      } else {
        var line = pad + (r.no ? r.no + '  ' : '') + (r.name || '');
        if (e.error) {
          line += '   [公式错误：' + e.error.message + ']';
        } else {
          line += '   = ' + fmtVal(e.gcl, project.unitTable, r.unit) + (r.unit ? ' ' + r.unit : '');
        }
        out.push(line);
        if (opts.withFormula !== false && r.expr) out.push(pad + '     公式：' + r.expr);
      }
    });

    var units = Object.keys(collectTotals(project, c));
    if (units.length) {
      var buckets = collectTotals(project, c);
      out.push('');
      out.push('—— 汇总（按计量单位）——');
      units.forEach(function (u) {
        var t = buckets[u];
        out.push('  ' + padEndStr(u || '（无单位）', 12) +
          padStartStr(fmtVal(t.total, project.unitTable, u), 16) + '   （' + t.count + ' 行）');
      });
    }

    return out.join('\n');
  }

  /* =======================================================================
   * 浏览器下载 / 打印
   * ===================================================================== */
  function download(filename, content, mime) {
    if (typeof document === 'undefined') {
      throw new Error('download() 仅在浏览器环境可用');
    }
    var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  function openPrintWindow(html) {
    if (typeof window === 'undefined') throw new Error('openPrintWindow() 仅在浏览器环境可用');
    var w = window.open('', '_blank');
    if (!w) {
      download('计算书.html', html, 'text/html');
      return null;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    return w;
  }

  return {
    toDelimited: toDelimited,
    toCSV: toCSV,
    toTSV: toTSV,
    toMarkdown: toMarkdown,
    toPlainText: toPlainText,
    collectTotals: collectTotals,
    totalRows: totalRows,
    download: download,
    openPrintWindow: openPrintWindow
  };
});
