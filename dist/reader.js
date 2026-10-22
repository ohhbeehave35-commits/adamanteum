// Rendered note view: Obsidian-compatible links, embeds, properties, tags, callouts and tasks.
// Everything is built with DOM nodes and textContent; note text is never interpreted as HTML.
const TOKEN = /(!\[\[[^\]\n]+\]\]|\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^)\n]+\)|\[[^\]\n]+\]\([^)\n]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`|(?<![\w&/])#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*|\*[^*\n]+\*)/gu;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
export const slug = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
export function splitTarget(raw) {
  const [pathPart, alias] = raw.split('|'), hash = pathPart.indexOf('#'), caret = pathPart.indexOf('^');
  const cut = [hash, caret].filter(i => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  return { name: (cut < 0 ? pathPart : pathPart.slice(0, cut)).trim(), anchor: cut < 0 ? '' : pathPart.slice(cut), alias: alias?.trim() ?? '' };
}
// The part of a note an embed or link points at: "#Heading" (to the next heading of the same or higher level) or "^block".
export function sectionOf(body, anchor) {
  if (!anchor) return body;
  const lines = body.split('\n');
  if (anchor[0] === '^') { const id = anchor.slice(1); const hit = lines.findIndex(l => l.trimEnd().endsWith('^' + id)); return hit < 0 ? '' : lines[hit].replace(/\s*\^[\w-]+\s*$/, ''); }
  const want = slug(anchor.slice(1));
  const start = lines.findIndex(l => /^#{1,6}\s/.test(l) && slug(l.replace(/^#{1,6}\s+/, '')) === want);
  if (start < 0) return '';
  const level = lines[start].match(/^#+/)[0].length; let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { const m = /^(#{1,6})\s/.exec(lines[i]); if (m && m[1].length <= level) { end = i; break; } }
  return lines.slice(start, end).join('\n');
}
export function createReader({ el, api, openDoc, filterTag }) {
  function scrollTo(root, anchor) {
    if (!anchor || anchor[0] === '^') return;
    const want = slug(anchor.slice(1)), target = [...root.querySelectorAll('h2,h3,h4,h5,h6')].find(h => h.dataset.slug === want);
    target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
  function embed(raw, d, depth, inlineMode) {
    const { name, anchor, alias } = splitTarget(raw);
    const wrap = el(inlineMode ? 'span' : 'section');
    wrap.className = 'embed';
    if (IMAGE.test(name)) {
      const image = el('img'); image.alt = name; image.loading = 'lazy'; image.style.maxWidth = '100%';
      if (/^\d+(x\d+)?$/.test(alias)) image.style.width = alias.split('x')[0] + 'px';
      image.src = '/api/workspace/asset?' + new URLSearchParams({ path: name, source: d.path || '' });
      image.onerror = () => wrap.replaceChildren(el('em', 'Image not found: ' + name));
      wrap.append(image); return wrap;
    }
    wrap.append(el('em', 'Loading ' + name + '…'));
    api('workspace/resolve', { source: d.path || '', target: name }).then(found => found ? api('doc', { id: found.id }) : null).then(note => {
      if (!note) { wrap.replaceChildren(el('em', 'Unresolved embed: ' + name)); return; }
      const text = sectionOf(note.renderBody || '', anchor).slice(0, 50000);
      const head = el('strong', note.title + (anchor ? ' · ' + anchor.slice(1) : '')), open = el('button', 'Open'); open.onclick = () => openDoc(note.id, false, anchor);
      const body = depth < 2 ? view({ ...note, properties: {}, tags: [], renderBody: text }, depth + 1) : el('pre', text);
      wrap.replaceChildren(head, open, body);
    }).catch(e => { wrap.textContent = e.message; });
    return wrap;
  }
  function link(target, label, d) {
    const raw = target.trim();
    if (/^https?:\/\//i.test(raw)) { const a = el('a', label); a.href = raw; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
    const { name, anchor } = splitTarget(raw.replace(/^<|>$/g, ''));
    const b = el('button', label, 'inline-link'); b.title = raw;
    b.onclick = async () => {
      if (!name) { scrollTo(b.closest('article') || document, anchor); return; }
      let clean = name; try { clean = decodeURIComponent(name); } catch { /* keep as typed */ }
      const found = await api('workspace/resolve', { source: d.path || '', target: clean });
      if (found) openDoc(found.id, false, anchor); else { b.textContent = label + ' (unresolved)'; b.style.opacity = '.6'; }
    };
    return b;
  }
  function inline(node, text, d, depth) {
    let from = 0;
    for (const m of text.matchAll(TOKEN)) {
      node.append(document.createTextNode(text.slice(from, m.index)));
      const token = m[0];
      if (token.startsWith('![[')) node.append(embed(token.slice(3, -2), d, depth, true));
      else if (token.startsWith('[[')) { const { alias, name, anchor } = splitTarget(token.slice(2, -2)); node.append(link(name + anchor, alias || (name + (anchor ? ' > ' + anchor.slice(1) : '')) || anchor, d)); }
      else if (token.startsWith('![')) { const alt = token.slice(2, token.indexOf('](')), src = token.slice(token.indexOf('](') + 2, -1); if (/^https?:/i.test(src)) node.append(el('a', alt || src, undefined)); else node.append(embed(decodeURIComponentSafe(src), d, depth, true)); }
      else if (token.startsWith('[')) node.append(link(token.slice(token.indexOf('](') + 2, -1), token.slice(1, token.indexOf('](')), d));
      else if (token.startsWith('**') || token.startsWith('__')) node.append(el('strong', token.slice(2, -2)));
      else if (token.startsWith('~~')) node.append(el('s', token.slice(2, -2)));
      else if (token.startsWith('==')) node.append(el('mark', token.slice(2, -2)));
      else if (token.startsWith('`')) node.append(el('code', token.slice(1, -1)));
      else if (token.startsWith('#')) { const b = el('button', token, 'inline-link tag'); b.onclick = () => filterTag(token.slice(1)); node.append(b); }
      else node.append(el('em', token.slice(1, -1)));
      from = m.index + token.length;
    }
    node.append(document.createTextNode(text.slice(from)));
  }
  const decodeURIComponentSafe = s => { try { return decodeURIComponent(s); } catch { return s; } };
  function valueNode(value, d) {
    if (Array.isArray(value)) { const span = el('span'); for (const item of value) { const chip = el('span'); inline(chip, typeof item === 'object' ? JSON.stringify(item) : String(item), d, 9); chip.className = 'property-chip'; chip.style.marginRight = '.5em'; span.append(chip); } return span; }
    if (typeof value === 'boolean') return el('span', value ? '☑ true' : '☐ false');
    if (value && typeof value === 'object') return el('code', JSON.stringify(value));
    const span = el('span'); inline(span, value === null ? '' : String(value), d, 9); return span;
  }
  function view(d, depth = 0) {
    const root = el('article', undefined, 'doc-body reading');
    if (d.properties && Object.keys(d.properties).length) {
      const panel = el('details'); panel.open = true; panel.className = 'properties-panel'; panel.append(el('summary', 'Properties'));
      for (const [key, value] of Object.entries(d.properties)) { const row = el('p'); row.className = 'property-row'; row.dataset.type = Array.isArray(value) ? 'list' : value === null ? 'text' : typeof value; row.append(el('strong', key + ': '), valueNode(value, d)); panel.append(row); }
      root.append(panel);
    }
    if (d.frontmatterError) root.append(el('p', 'Properties could not be read: ' + d.frontmatterError));
    if (d.tags?.length) { const row = el('p'); row.className = 'tag-row'; for (const t of d.tags) { const b = el('button', '#' + t, 'inline-link tag'); b.onclick = () => filterTag(t); row.append(b, document.createTextNode(' ')); } root.append(row); }
    let code = null, list = null, table = null, quote = null;
    const lines = (d.renderBody ?? d.body ?? '').split('\n');
    for (const line of lines) {
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) { if (code) { root.append(el('pre', code.join('\n'), 'code-block')); code = null; } else code = []; list = null; table = null; quote = null; continue; }
      if (code) { code.push(line); continue; }
      if (!line.trim()) { list = null; table = null; quote = null; continue; }
      const alone = /^!\[\[([^\]]+)\]\]$/.exec(line.trim());
      if (alone) { root.append(embed(alone[1], d, depth, false)); list = null; table = null; quote = null; continue; }
      if (/^\s*\|/.test(line)) { if (/^[\s|:-]+$/.test(line)) continue; if (!table) { table = el('table'); root.append(table); } const tr = el('tr'); for (const cell of line.trim().replace(/^\||\|$/g, '').split('|')) { const td = el('td'); inline(td, cell.trim(), d, depth); tr.append(td); } table.append(tr); continue; }
      table = null;
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { root.append(el('hr')); list = null; continue; }
      const heading = line.match(/^(#{1,6})\s+(.*)/), bullet = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)/), quoted = line.match(/^>\s?(.*)/);
      if (bullet) {
        if (!list) { list = el('ul'); root.append(list); }
        const li = el('li'), task = /^\[([ xX])\]\s+(.*)/.exec(bullet[1]);
        if (task) { const box = el('input'); box.type = 'checkbox'; box.disabled = true; box.checked = task[1] !== ' '; box.setAttribute('aria-label', 'Task'); li.append(box, document.createTextNode(' ')); inline(li, task[2], d, depth); } else inline(li, bullet[1], d, depth);
        list.append(li); continue;
      }
      list = null;
      if (quoted) {
        const callout = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(quoted[1]);
        if (callout) { quote = el('blockquote'); quote.className = 'callout callout-' + callout[1].toLowerCase(); quote.append(el('strong', callout[2] || callout[1][0].toUpperCase() + callout[1].slice(1))); root.append(quote); continue; }
        if (!quote) { quote = el('blockquote'); root.append(quote); }
        const p = el('p'); inline(p, quoted[1], d, depth); quote.append(p); continue;
      }
      quote = null;
      const n = el(heading ? 'h' + Math.min(6, heading[1].length + 1) : 'p');
      if (heading) n.dataset.slug = slug(heading[2].replace(/\s*\^[\w-]+\s*$/, ''));
      inline(n, heading ? heading[2] : line, d, depth); root.append(n);
    }
    if (code) root.append(el('pre', code.join('\n'), 'code-block'));
    root.scrollToAnchor = anchor => scrollTo(root, anchor);
    return root;
  }
  return { view, scrollTo };
}
