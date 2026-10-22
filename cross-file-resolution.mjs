// Cross-file call resolution for Go, C, Java and Rust. Conservative by design: a call resolves only when
// exactly one declaration can be named by the language's own scoping rules; everything else stays
// unresolved with a reason. Shadowed names, receiver (object.method) dispatch, overloads and
// packages outside the project are never guessed.
import path from 'node:path';
const FUNCTION = /function|method/;
const dirOf = file => path.posix.dirname(file);
const unique = list => (list.length === 1 ? list[0] : null);
export function crossFileTargets(extractions) {
  const multi = extractions.filter(x => ['go', 'c', 'java', 'rust'].includes(x.symbols?.language));
  const result = new Map();
  if (!multi.length) return result;
  const parentOf = new Map(), nodeById = new Map();
  for (const x of multi) { for (const n of x.nodes) nodeById.set(n.id, n); for (const e of x.edges) if (e.type === 'contains') parentOf.set(e.target, e.source); }
  const declarations = [];
  for (const x of multi) for (const n of x.nodes) {
    if (!FUNCTION.test(n.kind) || n.kind === 'call') continue;
    const parent = nodeById.get(parentOf.get(n.id));
    declarations.push({ node: n, file: x.path, dir: dirOf(x.path), language: x.symbols.language, pkg: x.symbols.package || '', klass: parent && /class|struct|interface|enum|impl/.test(parent.kind) ? parent.title : null, isStatic: !!n.static });
  }
  const byName = new Map();
  for (const d of declarations) { const key = d.language + ':' + d.node.title; if (!byName.has(key)) byName.set(key, []); byName.get(key).push(d); }
  const classes = new Map();
  for (const x of multi) if (x.symbols.language === 'java') for (const n of x.nodes) if (/class_declaration|interface_declaration|enum_declaration/.test(n.kind)) { if (!classes.has(n.title)) classes.set(n.title, []); classes.get(n.title).push({ node: n, file: x.path }); }
  for (const x of multi) {
    const language = x.symbols.language, imports = x.imports || [];
    for (const call of x.symbols.calls || []) {
      if (call.ref || call.shadowed || (call.qualified && !(language === 'java' && call.receiver))) continue;
      const name = language === 'java' && call.receiver ? call.receiver + '.' + call.name : String(call.name || ''), tail = name.split(/::|\./).pop();
      let target = null;
      if (language === 'c' && /^[A-Za-z_]\w*$/.test(name)) {
        // C has one global namespace: a non-static definition elsewhere in the project is the only possible target.
        target = unique((byName.get('c:' + name) || []).filter(d => d.node.kind === 'function_definition' && d.file !== x.path && !d.isStatic));
      } else if (language === 'go') {
        if (/^[A-Za-z_]\w*$/.test(name)) target = unique((byName.get('go:' + name) || []).filter(d => d.dir === dirOf(x.path) && d.pkg === (x.symbols.package || '') && d.file !== x.path));
        else if (/^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(name)) {
          const [qualifier, member] = name.split('.');
          const imported = imports.find(i => path.posix.basename(i.target) === qualifier);
          if (imported) target = unique((byName.get('go:' + member) || []).filter(d => path.posix.basename(d.dir) === qualifier && !d.klass));
        }
      } else if (language === 'java' && /^[A-Z]\w*\.[A-Za-z_]\w*$/.test(name)) {
        const [klass, member] = name.split('.'), found = classes.get(klass);
        if (found?.length === 1) target = unique((byName.get('java:' + member) || []).filter(d => d.klass === klass && d.file === found[0].file && d.node.kind === 'method_declaration'));
      } else if (language === 'rust') {
        const parts = name.split('::');
        if (parts.length >= 2 && /^[A-Za-z_]\w*$/.test(tail)) {
          const module = parts[parts.length - 2];
          target = unique((byName.get('rust:' + tail) || []).filter(d => { const base = path.posix.basename(d.file).replace(/\.rs$/, ''); return base === module || (base === 'mod' && path.posix.basename(d.dir) === module); }));
        } else if (parts.length === 1 && /^[A-Za-z_]\w*$/.test(name)) {
          // use crate::util::target;  ->  util.rs or util/mod.rs, function target
          for (const i of imports) {
            const m = new RegExp('(?:^|::)(\\w+)::(?:\\{[^}]*\\b' + name + '\\b[^}]*\\}|' + name + ')$').exec(i.target.replace(/\s+/g, ''));
            if (m) { target = unique((byName.get('rust:' + name) || []).filter(d => { const base = path.posix.basename(d.file).replace(/\.rs$/, ''); return base === m[1] || (base === 'mod' && path.posix.basename(d.dir) === m[1]); })); if (target) break; }
          }
        }
      }
      if (target) result.set(call.id, target.node.id);
    }
  }
  return result;
}
