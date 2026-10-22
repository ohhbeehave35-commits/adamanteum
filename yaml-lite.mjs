// A small, dependency-free YAML subset for note frontmatter and .base files.
// Supports block maps and lists (nested), flow lists/maps, quoted and plain scalars,
// numbers, booleans, null, comments and literal/folded block scalars. It never evaluates anything.
const MAX_DEPTH = 24;
function stripComment(s) {
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\' && quote === '"') i++; else if (c === quote) quote = null; }
    else if ((c === '"' || c === "'") && (i === 0 || /[\s:[{,-]/.test(s[i - 1]))) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}
function plain(s) {
  if (s === '') return null;
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  if (/^(null|~)$/i.test(s)) return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) && !/^[-+]?0\d/.test(s)) { const n = Number(s); if (Number.isFinite(n)) return n; }
  return s;
}
function quoted(s) {
  if (s[0] === '"') { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  return s.slice(1, -1).replace(/''/g, "'");
}
export function scalar(raw) {
  const s = raw.trim();
  if (s === '') return null;
  if ((s[0] === '"' && s.length > 1 && s.endsWith('"')) || (s[0] === "'" && s.length > 1 && s.endsWith("'"))) return quoted(s);
  if (s[0] === '[' || s[0] === '{') return flow(s);
  return plain(s);
}
function flow(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const value = depth => {
    if (depth > MAX_DEPTH) throw Error('YAML nested too deeply');
    ws();
    if (text[i] === '[') {
      i++; const out = [];
      for (;;) { ws(); if (text[i] === ']') { i++; return out; } out.push(value(depth + 1)); ws(); if (text[i] === ',') i++; else if (text[i] !== ']') throw Error('Bad flow list'); }
    }
    if (text[i] === '{') {
      i++; const out = Object.create(null);
      for (;;) {
        ws(); if (text[i] === '}') { i++; return out; }
        const key = token(true); ws(); if (text[i] !== ':') throw Error('Bad flow map'); i++;
        out[String(key)] = value(depth + 1); ws(); if (text[i] === ',') i++; else if (text[i] !== '}') throw Error('Bad flow map');
      }
    }
    return token(false);
  };
  const token = isKey => {
    ws();
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i]; let j = i + 1;
      while (j < text.length && (text[j] !== q || (q === '"' && text[j - 1] === '\\') || (q === "'" && text[j + 1] === "'" && (j++, true)))) j++;
      const raw = text.slice(i, j + 1); i = j + 1; return quoted(raw);
    }
    let j = i;
    while (j < text.length && !(isKey ? ':' : ',]}').includes(text[j])) j++;
    const raw = text.slice(i, j).trim(); i = j; return isKey ? raw : plain(raw);
  };
  const result = value(0); ws();
  if (i < text.length) throw Error('Trailing text after flow value');
  return result;
}
function splitKey(content) {
  let quote = null;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (quote) { if (c === '\\' && quote === '"') i++; else if (c === quote) quote = null; continue; }
    if ((c === '"' || c === "'") && i === 0) { quote = c; continue; }
    if (c === ':' && (i === content.length - 1 || content[i + 1] === ' ')) {
      const rawKey = content.slice(0, i).trim();
      return { key: String(rawKey[0] === '"' || rawKey[0] === "'" ? quoted(rawKey) : rawKey), rest: content.slice(i + 1).trim() };
    }
  }
  return null;
}
export function parseYaml(text) {
  const source = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const lines = source.map((raw, n) => {
    const content = stripComment(raw);
    return { n, raw, indent: raw.length - raw.trimStart().length, content: content.trim(), blank: content.trim() === '' };
  });
  let at = 0;
  const skip = () => { while (at < lines.length && lines[at].blank) at++; };
  function blockScalar(parentIndent, style) {
    const folded = style[0] === '>', keep = style.includes('+'), strip = style.includes('-');
    const out = []; let indent = null;
    while (at < lines.length) {
      const l = lines[at];
      if (l.raw.trim() === '') { out.push(''); at++; continue; }
      if (l.indent <= parentIndent) break;
      if (indent === null) indent = l.indent;
      out.push(l.raw.slice(Math.min(indent, l.indent))); at++;
    }
    while (out.length && out[out.length - 1] === '' && !keep) out.pop();
    let textOut = folded ? out.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ') : out.join('\n');
    if (!strip && out.length) textOut += '\n';
    return textOut;
  }
  function inlineValue(rest, indent, depth) {
    if (/^[|>][+-]?$/.test(rest)) return blockScalar(indent, rest);
    if (rest === '') {
      skip();
      if (at < lines.length && (lines[at].indent > indent || (lines[at].indent === indent && /^-(\s|$)/.test(lines[at].content)))) return block(lines[at].indent, depth + 1);
      return null;
    }
    return scalar(rest);
  }
  function block(indent, depth) {
    if (depth > MAX_DEPTH) throw Error('YAML nested too deeply');
    skip();
    if (at >= lines.length) return null;
    if (/^-(\s|$)/.test(lines[at].content)) {
      const list = [];
      while (at < lines.length) {
        skip();
        const l = lines[at];
        if (!l || l.indent !== indent || !/^-(\s|$)/.test(l.content)) break;
        const rest = l.content.slice(1).trim();
        if (rest === '') { at++; list.push(inlineValue('', indent, depth)); continue; }
        const pair = splitKey(rest);
        if (pair && !/^[[{"']/.test(rest)) {
          // "- key: value" starts a map whose later keys align with the first key.
          const inner = indent + (l.content.length - rest.length);
          lines[at] = { ...l, indent: inner, content: rest, raw: ' '.repeat(inner) + rest };
          list.push(block(inner, depth + 1));
        } else { at++; list.push(inlineValue(rest, indent, depth)); }
      }
      return list;
    }
    const map = Object.create(null);
    while (at < lines.length) {
      skip();
      const l = lines[at];
      if (!l || l.indent !== indent) break;
      const pair = splitKey(l.content);
      if (!pair) throw Error('Line ' + (l.n + 1) + ' is not a key: value pair');
      at++;
      map[pair.key] = inlineValue(pair.rest, indent, depth);
    }
    return map;
  }
  skip();
  if (at >= lines.length) return Object.create(null);
  const result = block(lines[at].indent, 0);
  skip();
  if (at < lines.length) throw Error('Unexpected content on line ' + (lines[at].n + 1));
  return result;
}
const needsQuote = s => s === '' || s !== s.trim() || /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /: |\s#|[\n\r\t]/.test(s) || /:$/.test(s) || /^(true|false|null|~|yes|no|on|off)$/i.test(s) || /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s);
const flowScalar = v => v === null || v === undefined ? 'null' : typeof v === 'string' ? (needsQuote(v) ? JSON.stringify(v) : v) : String(v);
export function stringifyYaml(value, indent = 0) {
  const pad = ' '.repeat(indent), out = [];
  const keyText = k => (/^[A-Za-z0-9_][A-Za-z0-9_ ./()-]*$/.test(k) && !needsQuote(k) ? k : JSON.stringify(k));
  const emit = (key, v) => {
    if (Array.isArray(v)) {
      if (!v.length) { out.push(pad + keyText(key) + ': []'); return; }
      out.push(pad + keyText(key) + ':');
      for (const item of v) {
        if (item && typeof item === 'object') {
          const nested = stringifyYaml(Array.isArray(item) ? { '': item } : item, indent + 4).split('\n');
          out.push(pad + '  - ' + nested[0].trimStart(), ...nested.slice(1));
        } else out.push(pad + '  - ' + flowScalar(item));
      }
    } else if (v && typeof v === 'object') {
      if (!Object.keys(v).length) { out.push(pad + keyText(key) + ': {}'); return; }
      out.push(pad + keyText(key) + ':', stringifyYaml(v, indent + 2));
    } else out.push(pad + keyText(key) + ': ' + flowScalar(v));
  };
  for (const [key, v] of Object.entries(value)) emit(key, v);
  return out.join('\n');
}
