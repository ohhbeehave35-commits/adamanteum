// Deterministic Louvain modularity communities (Blondel et al. 2008). No randomness: nodes are visited in
// index order and ties go to the lower community number, so the same graph always gives the same answer.
export function louvain(nodeCount, edgePairs, {maxLevels = 12, maxPasses = 24, resolution = 1} = {}) {
  let adj = Array.from({length: nodeCount}, () => new Map());
  for (const [a, b] of edgePairs) {
    if (a === b) continue;
    adj[a].set(b, (adj[a].get(b) || 0) + 1);
    adj[b].set(a, (adj[b].get(a) || 0) + 1);
  }
  const membership = Int32Array.from({length: nodeCount}, (_, i) => i);
  let current = Array.from({length: nodeCount}, (_, i) => i); // original node -> node of the current level
  for (let level = 0; level < maxLevels; level++) {
    const n = adj.length;
    const degree = adj.map(m => { let s = 0; for (const w of m.values()) s += w; return s; });
    let twoM = 0; for (const d of degree) twoM += d;
    if (!twoM) break;
    const community = Int32Array.from({length: n}, (_, i) => i), total = Float64Array.from(degree);
    let movedAny = false;
    for (let pass = 0; pass < maxPasses; pass++) {
      let moved = 0;
      for (let i = 0; i < n; i++) {
        const own = community[i], weights = new Map();
        for (const [j, w] of adj[i]) { if (j === i) continue; const c = community[j]; weights.set(c, (weights.get(c) || 0) + w); }
        total[own] -= degree[i];
        let best = own, bestGain = (weights.get(own) || 0) - resolution * total[own] * degree[i] / twoM;
        for (const [c, w] of weights) {
          const gain = w - resolution * total[c] * degree[i] / twoM;
          if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && c < best)) { best = c; bestGain = gain; }
        }
        total[best] += degree[i];
        if (best !== own) { community[i] = best; moved++; }
      }
      if (moved) movedAny = true; else break;
    }
    if (!movedAny) break;
    // Renumber communities by first appearance, apply to the original nodes, then collapse the graph.
    const renumber = new Map();
    for (let i = 0; i < n; i++) if (!renumber.has(community[i])) renumber.set(community[i], renumber.size);
    for (let v = 0; v < nodeCount; v++) current[v] = renumber.get(community[current[v]]);
    const next = Array.from({length: renumber.size}, () => new Map());
    for (let i = 0; i < n; i++) {
      const ci = renumber.get(community[i]);
      for (const [j, w] of adj[i]) { const cj = renumber.get(community[j]); next[ci].set(cj, (next[ci].get(cj) || 0) + w); }
    }
    if (next.length === n) break;
    adj = next;
  }
  for (let v = 0; v < nodeCount; v++) membership[v] = current[v];
  return membership;
}
export function modularity(nodeCount, edgePairs, membership) {
  const degree = new Float64Array(nodeCount), inside = new Map(), totals = new Map();
  let m = 0;
  for (const [a, b] of edgePairs) { if (a === b) continue; degree[a]++; degree[b]++; m++; if (membership[a] === membership[b]) inside.set(membership[a], (inside.get(membership[a]) || 0) + 1); }
  for (let i = 0; i < nodeCount; i++) totals.set(membership[i], (totals.get(membership[i]) || 0) + degree[i]);
  let q = 0; for (const [c, t] of totals) q += (inside.get(c) || 0) / m - (t / (2 * m)) ** 2;
  return m ? q : 0;
}
