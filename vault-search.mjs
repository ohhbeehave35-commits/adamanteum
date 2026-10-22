// Obsidian-style search operators: -word, "exact phrase", path: file: tag: line: key:value,
// [key:value], and OR between groups. Everything is parameterised; nothing is interpolated into SQL.
export function searchPlan(query) {
  const groups = [{ terms: [], filters: [] }];
  const text = String(query).replace(/\[([\w-]+):([^\]]*)\]/g, '$1:$2');
  for (const token of text.match(/-?(?:[\w-]+:)?(?:"[^"]*"|[^\s"]+)/g) || []) {
    if (token === 'OR') { groups.push({ terms: [], filters: [] }); continue; }
    const current = groups[groups.length - 1];
    const negative = token.startsWith('-'), value = negative ? token.slice(1) : token, pair = /^([\w-]+):(.*)$/.exec(value), unquote = s => s.replace(/^"|"$/g, '');
    if (pair) current.filters.push({ key: pair[1], value: unquote(pair[2]).replace(/^#/, pair[1] === 'tag' ? '' : '#'), negative });
    else current.terms.push({ value: unquote(value), negative, phrase: value.startsWith('"') });
  }
  const first = groups[0];
  return { terms: first.terms, filters: first.filters, groups: groups.filter(g => g.terms.length || g.filters.length) };
}
const FILE_NAME = "substr(d.path,length(rtrim(d.path,replace(d.path,'/','')))+1)";
function groupClause(group, args) {
  const where = [];
  for (const term of group.terms) {
    const expression = '"' + term.value.replaceAll('"', '""') + '"' + (term.phrase ? '' : '*');
    where.push(`${term.negative ? 'NOT ' : ''}(d.id IN (SELECT rowid FROM search WHERE search MATCH ?))`);
    args.push(expression);
  }
  for (const f of group.filters) {
    let clause;
    if (['path', 'file', 'line', 'content'].includes(f.key)) {
      const column = f.key === 'line' || f.key === 'content' ? 'd.body' : f.key === 'file' ? FILE_NAME : 'd.path';
      clause = `instr(lower(${column}),lower(?))>0`; args.push(f.value);
    } else if (f.key === 'tag') {
      clause = 'EXISTS(SELECT 1 FROM doc_metadata m,json_each(m.tags) t WHERE m.id=d.id AND (lower(t.value)=lower(?) OR lower(t.value) LIKE lower(?)))'; args.push(f.value, f.value + '/%');
    } else {
      // Property match: scalar equality (case-insensitive), a value inside a list, or a checkbox true/false.
      clause = "EXISTS(SELECT 1 FROM doc_metadata m,json_each(m.properties) p WHERE m.id=d.id AND lower(p.key)=lower(?) AND (lower(CAST(p.value AS TEXT))=lower(?) OR p.type=lower(?) OR EXISTS(SELECT 1 FROM json_each(CASE WHEN p.type='array' THEN p.value ELSE '[]' END) v WHERE lower(CAST(v.value AS TEXT))=lower(?))))";
      args.push(f.key, f.value, f.value, f.value);
    }
    where.push((f.negative ? 'NOT ' : '') + '(' + clause + ')');
  }
  return where.length ? where.join(' AND ') : '1';
}
export function advancedSearch(db, query, scope, folder, offset) {
  const plan = searchPlan(query), args = [scope], where = ['d.category=?'];
  if (folder) { where.push('d.folder=?'); args.push(folder); }
  const alternatives = plan.groups.map(g => '(' + groupClause(g, args) + ')');
  if (alternatives.length) where.push('(' + alternatives.join(' OR ') + ')');
  // A partial filename match outranks a body-only match (Obsidian's file-name-first behaviour).
  const lead = plan.groups.flatMap(g => g.terms).find(t => !t.negative)?.value ?? '';
  const escaped = lead.toLowerCase().replace(/[\\%_]/g, '\\$&');
  const rank = lead ? `CASE WHEN lower(${FILE_NAME}) LIKE ? ESCAPE '\\' THEN 0 WHEN lower(d.path) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,` : '';
  return db.prepare(`SELECT d.id,d.path,d.title,d.folder,d.category,d.degree,d.mtime,d.bytes FROM docs d WHERE ${where.join(' AND ')} ORDER BY ${rank} d.mtime DESC,d.id LIMIT 80 OFFSET ?`).all(...args, ...(lead ? ['%' + escaped + '%', '%' + escaped + '%'] : []), offset);
}
