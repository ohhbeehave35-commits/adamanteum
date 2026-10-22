// Obsidian "Excluded files" (userIgnoreFilters in .obsidian/app.json).
// A filter wrapped in /.../ is a regular expression; a filter with * or ? is a glob;
// anything else is a path prefix (a folder ends with "/").
export function compileIgnore(filters) {
  const tests = [];
  for (const raw of Array.isArray(filters) ? filters : []) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const f = raw.trim();
    if (f.length > 2 && f.startsWith('/') && f.endsWith('/')) {
      try { const re = new RegExp(f.slice(1, -1)); tests.push(p => re.test(p)); continue; } catch { /* treat as a plain prefix */ }
    }
    if (f.includes('*') || f.includes('?')) {
      const body = f.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]');
      const re = new RegExp(f.includes('/') ? '^' + body + '$' : '(^|/)' + body + '$');
      tests.push(p => re.test(p)); continue;
    }
    tests.push(p => p.startsWith(f));
  }
  return p => tests.some(t => t(p));
}
