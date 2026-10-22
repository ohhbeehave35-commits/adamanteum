import {frontmatter,tagsOf} from './vault-workspace.mjs';
import {resolver,targets} from './lib.mjs';
import {parseYaml,stringifyYaml} from './yaml-lite.mjs';

// ---------- Bases: table views over note properties, stored in the vault as .base files ----------
const MAX_ROWS = 20000;
function rowOf(d) {
  const note = d.properties ? null : frontmatter(d.body ?? '');
  const properties = d.properties ? (typeof d.properties === 'string' ? JSON.parse(d.properties) : d.properties) : note.properties;
  const tags = d.tags ? (typeof d.tags === 'string' ? JSON.parse(d.tags) : d.tags) : (d.properties ? [] : tagsOf(d.body ?? ''));
  const p = String(d.path), name = p.split('/').pop(), ext = name.includes('.') ? name.split('.').pop() : '';
  const file = { name: name.replace(/\.[^.]+$/, ''), path: p, folder: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '', ext, mtime: d.mtime ? new Date(Number(d.mtime)).toISOString() : '', size: d.bytes ?? (d.body ? d.body.length : 0), tags };
  return { file, properties, legacy: { file: p, ...properties } };
}
// A deliberately small expression language: comparisons, && || !, parentheses, and the functions
// file.hasTag(...), file.inFolder(...), x.contains(...), x.startsWith(...), x.isEmpty().
function tokenize(text) {
  const out = []; let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") { let j = i + 1, value = ''; while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; value += text[j++]; } if (j >= text.length) throw Error('Unclosed quote in filter'); out.push({ t: 'str', v: value }); i = j + 1; continue; }
    const two = text.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('<>!(),.'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    const m = /^-?\d+(\.\d+)?/.exec(text.slice(i));
    if (m && !/[\w]/.test(text[i - 1] ?? '')) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    const word = /^[\w$-]+/u.exec(text.slice(i));
    if (!word) throw Error('Unexpected "' + c + '" in filter');
    out.push({ t: 'id', v: word[0] }); i += word[0].length;
  }
  return out;
}
export function compileFilter(source) {
  const tokens = tokenize(String(source)); let at = 0;
  const peek = () => tokens[at], eat = v => (peek()?.v === v && peek().t === 'op' ? tokens[at++] : null);
  function primary() {
    const t = tokens[at++];
    if (!t) throw Error('Filter ended early');
    if (t.t === 'num' || t.t === 'str') return () => t.v;
    if (t.t === 'op' && t.v === '(') { const e = or(); if (!eat(')')) throw Error('Missing )'); return e; }
    if (t.t === 'op' && t.v === '!') { const e = primary(); return r => !truthy(e(r)); }
    if (t.t !== 'id') throw Error('Unexpected "' + t.v + '" in filter');
    if (t.v === 'true' || t.v === 'false') return () => t.v === 'true';
    const parts = [t.v];
    while (peek()?.t === 'op' && peek().v === '.' && tokens[at + 1]?.t === 'id') { at++; parts.push(tokens[at++].v); }
    if (eat('(')) {
      const args = [];
      if (!eat(')')) { do args.push(or()); while (eat(',')); if (!eat(')')) throw Error('Missing ) after arguments'); }
      const fn = parts.pop(), receiver = parts.length ? lookup(parts) : null;
      return r => call(fn, receiver ? receiver(r) : undefined, parts.join('.'), args.map(a => a(r)), r);
    }
    return lookup(parts);
  }
  function lookup(parts) {
    return r => {
      let [head, ...rest] = parts;
      let value;
      if (head === 'file') value = r.file; else if (head === 'note') value = r.properties; else { value = r.properties; rest = parts; }
      for (const key of rest) value = value == null ? undefined : value[key];
      return value;
    };
  }
  const truthy = v => !(v === undefined || v === null || v === false || v === '' || v === 0 || (Array.isArray(v) && !v.length));
  function call(fn, receiver, receiverName, args, r) {
    if (receiverName === 'file' || (receiverName === '' && fn.startsWith('has'))) {
      if (fn === 'hasTag') return args.some(a => r.file.tags.some(t => t === a || t.startsWith(a + '/')));
      if (fn === 'inFolder') return args.some(a => r.file.folder === a || r.file.folder.startsWith(a + '/'));
      if (fn === 'hasProperty') return args.some(a => r.properties[a] !== undefined);
    }
    if (fn === 'contains') return Array.isArray(receiver) ? receiver.map(String).includes(String(args[0])) : String(receiver ?? '').toLowerCase().includes(String(args[0]).toLowerCase());
    if (fn === 'startsWith') return String(receiver ?? '').startsWith(String(args[0]));
    if (fn === 'endsWith') return String(receiver ?? '').endsWith(String(args[0]));
    if (fn === 'isEmpty') return !truthy(receiver);
    if (fn === 'lower') return String(receiver ?? '').toLowerCase();
    throw Error('Unsupported filter function: ' + fn);
  }
  const compare = (a, op, b) => {
    const loose = (x, y) => (typeof x === 'number' || typeof y === 'number') && x !== undefined && y !== undefined ? Number(x) === Number(y) : String(x ?? '') === String(y ?? '');
    if (op === '==') return loose(a, b); if (op === '!=') return !loose(a, b);
    const x = typeof a === 'number' || typeof b === 'number' ? Number(a) : String(a ?? ''), y = typeof a === 'number' || typeof b === 'number' ? Number(b) : String(b ?? '');
    return op === '>' ? x > y : op === '>=' ? x >= y : op === '<' ? x < y : x <= y;
  };
  function cmp() {
    const left = primary();
    const op = ['==', '!=', '>=', '<=', '>', '<'].find(o => peek()?.t === 'op' && peek().v === o);
    if (!op) return left;
    at++; const right = primary(); return r => compare(left(r), op, right(r));
  }
  function and() { let l = cmp(); while (eat('&&')) { const a = l, b = cmp(); l = r => truthy(a(r)) && truthy(b(r)); } return l; }
  function or() { let l = and(); while (eat('||')) { const a = l, b = and(); l = r => truthy(a(r)) || truthy(b(r)); } return l; }
  const program = or();
  if (at < tokens.length) throw Error('Unexpected "' + tokens[at].v + '" in filter');
  return r => truthy(program(r));
}
function compileTree(node) {
  if (node == null || node === '') return () => true;
  if (typeof node === 'string') return compileFilter(node);
  if (Array.isArray(node)) { const all = node.map(compileTree); return r => all.every(f => f(r)); }
  if (typeof node === 'object') {
    if (node.and) { const all = [].concat(node.and).map(compileTree); return r => all.every(f => f(r)); }
    if (node.or) { const any = [].concat(node.or).map(compileTree); return r => any.some(f => f(r)); }
    if (node.not) { const none = [].concat(node.not).map(compileTree); return r => !none.some(f => f(r)); }
    // Legacy {property: value} equality map.
    const pairs = Object.entries(node); return r => pairs.every(([k, v]) => String(r.legacy[k] ?? r.properties[k]) === String(v));
  }
  throw Error('Unsupported filter');
}
const columnValue = (row, column) => column === 'file' ? row.file.path : column.startsWith('file.') ? row.file[column.slice(5)] : column.startsWith('note.') ? row.properties[column.slice(5)] : row.properties[column];
// Normalise both the Obsidian-style YAML .base shape and the first 0.4 JSON shape.
export function normalizeBase(config, viewSelector = null) {
  if (config && Array.isArray(config.views) && config.views.length) {
    // Obsidian opens the first view by default; a name or a 0-based number selects another.
    const names = config.views.map(v => v.name || v.type);
    let at = 0;
    if (viewSelector !== null && viewSelector !== undefined && viewSelector !== '') {
      const byName = names.findIndex(n => n === String(viewSelector));
      at = byName >= 0 ? byName : Number(viewSelector);
      if (!Number.isInteger(at) || at < 0 || at >= names.length) throw Error('This base has no view "' + viewSelector + '".');
    }
    const view = config.views[at] ?? {};
    return { filters: config.filters ?? null, viewFilters: view.filters ?? null, columns: view.order ?? ['file.name'], sort: [].concat(view.sort ?? []).map(s => typeof s === 'string' ? { property: s, direction: 'ASC' } : { property: s.property, direction: String(s.direction || 'ASC').toUpperCase() }), group: view.groupBy ? (typeof view.groupBy === 'string' ? { property: view.groupBy, direction: 'ASC' } : { property: view.groupBy.property, direction: String(view.groupBy.direction || 'ASC').toUpperCase() }) : null, limit: view.limit ?? null, name: names[at], views: names, view: at };
  }
  const columns = config?.columns || ['file', 'status'];
  return { filters: config?.filters ?? null, viewFilters: null, columns, sort: config?.sort ? [{ property: config.sort, direction: config.descending ? 'DESC' : 'ASC' }] : [], group: config?.group ? { property: config.group, direction: 'ASC' } : null, limit: config?.limit ?? null, name: 'Table', views: ['Table'], view: 0 };
}
const collator = new Intl.Collator(undefined, { numeric: true });
// options.view: which view of a .base file (default: the first, as Obsidian does).
// options.maxRows: stop collecting after this many matches (default 20,000 for the builder preview; null = all).
// options.offset / options.limit: send one page of rows; "total" always counts every matching row.
export function baseView(docs, config = {}, options = {}) {
  const base = normalizeBase(config, options.view), columns = base.columns;
  if (!Array.isArray(columns) || columns.length > 50) throw Error('Choose up to 50 columns');
  const keep = compileTree(base.filters), keepView = compileTree(base.viewFilters);
  const maxRows = options.maxRows === undefined ? MAX_ROWS : options.maxRows;
  let rows = [];
  for (const d of docs) { const r = rowOf(d); if (keep(r) && keepView(r)) { rows.push(r); if (maxRows && rows.length >= maxRows) break; } }
  for (const s of [...base.sort].reverse()) { const sign = s.direction === 'DESC' ? -1 : 1; rows.sort((a, b) => collator.compare(String(columnValue(a, s.property) ?? ''), String(columnValue(b, s.property) ?? '')) * sign); }
  if (base.limit) rows = rows.slice(0, Number(base.limit));
  const total = rows.length, offset = Math.max(0, Number(options.offset) || 0), page = Number(options.limit) > 0 ? Number(options.limit) : null;
  if (page || offset) rows = rows.slice(offset, page ? offset + page : undefined);
  const groups = Object.create(null);
  for (const r of rows) {
    const g = base.group ? String(columnValue(r, base.group.property) ?? 'Unassigned') : 'All';
    // Row objects keep the legacy shape (file = path) and add every requested column.
    const out = { ...r.legacy }; for (const c of columns) out[c] = columnValue(r, c);
    out.file = out.file ?? r.file.path; out.__path = r.file.path;
    (groups[g] ??= []).push(out);
  }
  const shown = rows.length, meta = { columns, total, shown, offset, name: base.name, views: base.views, view: base.view };
  if (base.group?.direction === 'DESC') { const reversed = Object.create(null); for (const k of Object.keys(groups).reverse()) reversed[k] = groups[k]; return { ...meta, groups: reversed }; }
  return { ...meta, groups };
}
export function parseBase(text) {
  const t = String(text).trim();
  // An empty .base opens as Obsidian opens it: one table of every note.
  if (!t) return { views: [{ type: 'table', name: 'Table' }] };
  if (t.startsWith('{')) { try { return JSON.parse(t); } catch { /* fall through to YAML flow syntax */ } }
  const parsed = parseYaml(t);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('A .base file holds filters and views.');
  if (!Array.isArray(parsed.views) && !parsed.columns) parsed.views = [{ type: 'table', name: 'Table' }];
  return parsed;
}
// config from the editor form -> Obsidian Bases YAML.
export function baseYaml({ filters = [], columns = ['file.name'], sort = [], group = null, name = 'Table', limit = null }) {
  const doc = {};
  const list = [].concat(filters).filter(Boolean);
  if (list.length) doc.filters = { and: list };
  const view = { type: 'table', name, order: columns };
  if (sort.length) view.sort = sort.map(s => ({ property: s.property, direction: s.direction === 'DESC' ? 'DESC' : 'ASC' }));
  if (group) view.groupBy = { property: group.property ?? group, direction: group.direction === 'DESC' ? 'DESC' : 'ASC' };
  if (limit) view.limit = limit;
  doc.views = [view];
  compileTree(doc.filters); // refuse to save a filter that cannot run
  return stringifyYaml(doc) + '\n';
}

// ---------- Canvas (JSON Canvas 1.0) ----------
export function canvasData(text) {
  const canvas = JSON.parse(text);
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges) || canvas.nodes.length > 2000 || canvas.edges.length > 10000) throw Error('Canvas exceeds 2,000 cards / 10,000 edges or has invalid arrays');
  const ids = new Set();
  for (const n of canvas.nodes) { if (typeof n.id !== 'string' || ids.has(n.id) || !['text', 'file', 'link', 'group'].includes(n.type) || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(n[k]))) throw Error('Invalid canvas card'); ids.add(n.id); }
  for (const e of canvas.edges) if (!ids.has(e.fromNode) || !ids.has(e.toNode)) throw Error('Dangling canvas edge');
  return canvas;
}
function loadCanvas(body) { try { const c = JSON.parse(body); return c && typeof c === 'object' ? { nodes: Array.isArray(c.nodes) ? c.nodes : [], edges: Array.isArray(c.edges) ? c.edges : [] } : null; } catch { return null; } }
export function canvasText(body) {
  const c = loadCanvas(body); if (!c) return '';
  const parts = [];
  for (const n of c.nodes.slice(0, 2000)) for (const v of [n.text, n.file, n.url, n.label]) if (typeof v === 'string') parts.push(v);
  for (const e of c.edges.slice(0, 10000)) if (typeof e.label === 'string') parts.push(e.label);
  return parts.join('\n');
}
export function canvasTargets(body) {
  const c = loadCanvas(body); if (!c) return [];
  const out = new Set();
  for (const n of c.nodes.slice(0, 2000)) {
    if (n.type === 'file' && typeof n.file === 'string') out.add(n.file.split('#')[0]);
    if (n.type === 'text' && typeof n.text === 'string') for (const t of targets(n.text)) out.add(t);
  }
  return [...out];
}

// ---------- Vault health and change reports ----------
export function linkHealth(docs) {
  const resolve = resolver(docs.map(d => d.path)), incoming = new Set(), broken = [], names = new Map();
  for (const d of docs) {
    const name = d.path.split('/').pop().toLowerCase();
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(d.path);
    for (const target of targets(d.body)) { const to = resolve(d.path, target); if (to) incoming.add(to); else broken.push({ source: d.path, target }); }
  }
  const orphans = docs.filter(d => !incoming.has(d.path)).map(d => d.path), duplicates = [...names.values()].filter(v => v.length > 1);
  return { broken, orphans, duplicates, summary: { notes: docs.length, broken: broken.length, orphans: orphans.length, duplicates: duplicates.length } };
}
export function changedSince(docs, since) {
  const time = Date.parse(since);
  if (!Number.isFinite(time)) throw Error('Choose an ISO date');
  return docs.filter(d => d.mtime > time).sort((a, b) => b.mtime - a.mtime).map(({ path, mtime }) => ({ path, mtime }));
}
