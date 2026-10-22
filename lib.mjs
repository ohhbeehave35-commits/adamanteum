import path from 'node:path';

export function category(p) {
  if (/GRAPHIFY-EXPORT.*\.bak-|(^|\/)Archive\//i.test(p)) return 'archive';
  if (/^(GRAPHIFY-EXPORT|graphify-out|graph-cc-cache|Graph\/)/i.test(p)) return 'generated';
  return 'records';
}
export function title(text, p) {
  return text.match(/^# (.+)$/m)?.[1]?.replace(/[*`]/g, '').trim() || path.posix.basename(p, '.md').replace(/[-_]/g, ' ');
}
export const LINK_PARSER_VERSION='markdown-links-5';
export const METADATA_VERSION='yaml-lite-1';
export function stripCode(text) {
  let fence=null;
  return String(text).split('\n').map(line=>{
    const marker=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim())fence=null;return '';}
    if(marker){fence=marker[1];return '';}
    return line;
  }).join('\n').replace(/(`+)([\s\S]*?)\1(?!`)/g,'');
}
export function targets(text) {
  // Code examples and comments describe links; they are not navigable note links.
  text=stripCode(String(text).replace(/<!--[\s\S]*?-->/g,''));
  const result = new Set();
  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const target = match[1].split('|')[0].split('#')[0].trim();
    if (target) result.add(target);
  }
  for (const match of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '').split('#')[0].trim();
    if (target && !/^[a-z]+:|^\/\//i.test(target) && /\.md$/i.test(target)) {
      try { result.add(decodeURIComponent(target)); } catch {}
    }
  }
  return [...result];
}
// Duplicate note names, ranked the way Obsidian's own backlink list behaves on a large real vault: the file nearest the vault root wins
// (a root 00-HOME.md beats a sibling copy), then the nearest folder to the linking note, then the shorter path. A true tie stays unresolved.
export function nearest(source, matches) {
  const distance=p=>{const a=path.posix.dirname(source).toLowerCase().split('/'),b=path.posix.dirname(p).toLowerCase().split('/');let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;return a.length+b.length-2*i;};
  const rank=p=>[p.split('/').length,distance(p),p.length],ranked=[...matches].sort((x,y)=>{const u=rank(x),v=rank(y);return u[0]-v[0]||u[1]-v[1]||u[2]-v[2]||x.localeCompare(y);});
  return ranked.length>1&&rank(ranked[0]).join()===rank(ranked[1]).join()?null:ranked[0]??null;
}
export function resolver(paths, aliases = new Map()) {
  const exact = new Map(), names = new Map();
  for (const p of paths) {
    const key = p.replace(/\.md$/i, '').toLowerCase();
    exact.set(key, p);
    const name = path.posix.basename(key);
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(p);
  }
  return (source, target) => {
    const key = target.replaceAll('\\', '/').replace(/\.md$/i, '').replace(/^\/+/, '').toLowerCase();
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(source), key)).toLowerCase();
    // A bare name is looked up by name (so a copy beside the linking note does not beat the vault-root note);
    // a name with folders is a path from the vault root first, as Obsidian resolves it, then relative to the linking note.
    if (exact.has(key)) return exact.get(key);
    if (key.includes('/') && exact.has(relative)) return exact.get(relative);
    const matches = names.get(key);
    if(!matches?.length)return aliases.get(key.trim())||null;
    return nearest(source,matches);
  };
}
export function searchExpression(query) {
  return query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 12).map(s => `"${s}"*`).join(' AND ') || '';
}
