import crypto from 'node:crypto';

// The automatic model switcher, built from the same rules as a
// production Python model router. It is not an import: that side is Python.
//   trigger  : HTTP 401/402/403/429, any 5xx, a 400 whose body mentions credit / insufficient_quota /
//              quota exceeded, a timeout, a refused or dropped connection.        (model_router.is_fallback_trigger)
//   refusal  : any other provider answer that is not usable (400/404/422, empty or unreadable reply) is a
//              "refused request shape": ONE text-only retry on that same provider, then move on.   (answer())
//              Every problem switches at once, 429 busy
//              included, with no waiting and no Retry-After pause; the person only hears of it when every provider has failed.
//   order    : the connection the caller chose first, then the rest in the order they were attached.
//   memory   : a trigger failure marks that provider down for 10 minutes (status and reason only, never the
//              provider's own error text); a down provider is skipped until the time is up.   (remember())
//   spent    : every provider failed or is down -> one clear line for the owner plus a FAILOVER_EXHAUSTED event.
//   anything that is not a provider failure (the caller's own abort, a bug in our code) is raised untouched.
export const DEAD_MS = 10 * 60 * 1000;
export const EXHAUSTED_EVENT = 'FAILOVER_EXHAUSTED';
const CREDIT_WORDS = ['credit', 'insufficient_quota', 'quota exceeded'];
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

// A provider failure with a status and a safe reason. It never carries the provider's own text.
export class ProviderError extends Error {
  constructor(kind, status = null, creditWords = false) {
    super(`provider ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'ProviderError'; this.kind = kind; this.status = status; this.creditWords = creditWords;
  }
}
export class FailoverExhausted extends Error {
  constructor(message, outcomes) { super(message); this.name = 'FailoverExhausted'; this.code = EXHAUSTED_EVENT; this.status = 503; this.outcomes = outcomes; }
}

export function isFallbackTrigger(err) {
  if (!(err instanceof ProviderError)) return false;
  if (err.kind === 'timeout' || err.kind === 'network') return true;
  const s = err.status;
  if (s === null) return false;
  return s === 401 || s === 402 || s === 403 || s === 429 || s >= 500 || (s === 400 && err.creditWords);
}
// A short, key-free reason class (provider_switch.reason_of).
export function reasonOf(err) {
  if (!(err instanceof ProviderError)) return 'error';
  if (err.kind === 'timeout') return 'timeout';
  if (err.kind === 'network') return 'connection refused';
  if (err.kind === 'empty') return 'refused request shape';
  const s = err.status;
  if (s === 401 || s === 403) return 'auth';
  if (s === 402 || err.creditWords) return 'out of credit';
  if (s === 429) return 'rate limit';
  if (s >= 500) return 'server error';
  return s ? 'refused request shape' : 'error';
}

// Turns a fetch outcome into a ProviderError, or returns null when the failure is not the provider's
// (the caller aborted on purpose), so it is raised as a real error.
export function classifyTransport(err, callerSignal) {
  if (err instanceof ProviderError) return err;
  if (callerSignal?.aborted) return null;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return new ProviderError('timeout');
  const code = err?.cause?.code || err?.code;
  if ((code && NETWORK_CODES.has(code)) || (err instanceof TypeError && /fetch failed/i.test(err.message || ''))) return new ProviderError('network');
  return null;
}
export async function providerErrorFromResponse(response) {
  let text = '';
  try { text = String(await response.text()).toLowerCase(); } catch { /* the body is only read to spot the credit words */ }
  return new ProviderError('http', response.status, CREDIT_WORDS.some(w => text.includes(w)));
}

// The same question with no tools and a flat text history: what a provider gets after it refused the full
// tool-shaped request. Nothing is executed here; the caller still owns tools and approvals.
export function textOnly(body) {
  const flat = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p?.type === 'text').map(p => p.text).join('\n') : '';
  const { tools, tool_choice, ...rest } = body, messages = [];
  for (const m of body.messages || []) {
    const text = flat(m.content);
    if (!text.trim()) continue;
    messages.push(m.role === 'tool' ? { role: 'user', content: 'Tool result: ' + text } : { role: m.role, content: text });
  }
  return { ...rest, messages };
}

const identity = c => crypto.createHash('sha256').update(`${c.endpoint}\n${c.key || ''}`).digest('hex');
const scrub = (text, keys) => keys.filter(Boolean).reduce((t, k) => t.split(k).join('[key removed]'), String(text));

export class ModelSwitcher {
  constructor({ ttlMs = DEAD_MS, now = Date.now, receipt = () => {}, log = line => console.error(line) } = {}) {
    this.ttlMs = ttlMs; this.now = now; this.receipt = receipt; this.log = log; this.down = new Map();
  }
  unavailable(connection) {
    const id = identity(connection), entry = this.down.get(id);
    if (entry && entry.until > this.now()) return entry;
    this.down.delete(id); return null;
  }
  remember(connection, err) {
    if (!isFallbackTrigger(err) || this.unavailable(connection)) return;
    this.down.set(identity(connection), { until: this.now() + this.ttlMs, status: err.status, reason: reasonOf(err) });
  }
  // Order: the connection the caller chose, then the others as attached.
  order(connections, preferredId) {
    const all = [...connections].map(([id, c]) => ({ id, ...c }));
    const first = all.find(c => c.id === preferredId);
    return first ? [first, ...all.filter(c => c !== first)] : all;
  }
  // attempt(connection, {textOnly}) performs ONE provider call and returns its parsed answer, or throws.
  async run({ connections, preferredId, actor = 'owner-screen', site, attempt, signal }) {
    const keys = [...connections.values()].map(c => c.key), outcomes = [];
    const note = (kind, entry) => {
      const row = { actor, kind, site, ...entry };
      try { this.receipt(row); } catch { /* a receipt problem never changes the answer */ }
      this.log(scrub(`${kind === EXHAUSTED_EVENT ? EXHAUSTED_EVENT : 'MODEL_SWITCH'} ${JSON.stringify(row)}`, keys));
    };
    const chain = this.order(connections, preferredId);
    const label = c => ({ name: c.name, model: c.model });
    for (let i = 0; i < chain.length; i++) {
      const c = chain[i], nextLive = () => chain.slice(i + 1).find(n => !this.unavailable(n));
      const down = this.unavailable(c);
      if (down) { outcomes.push({ provider: c.name, outcome: 'down', reason: down.reason, status: down.status }); continue; }
      let failure = null;
      for (const shaped of [false, true]) {
        try { return { ...(await attempt(c, { textOnly: shaped })), connection: c, switched: outcomes.length > 0 }; }
        catch (raw) {
          const err = classifyTransport(raw, signal);
          if (!err) throw raw;
          failure = err;
          if (isFallbackTrigger(err)) { this.remember(c, err); break; }
          if (!shaped) { note('model-text-only-retry', { tried: label(c), reason: reasonOf(err), status: err.status }); continue; }
        }
      }
      outcomes.push({ provider: c.name, outcome: isFallbackTrigger(failure) ? 'down' : 'refused request', reason: reasonOf(failure), status: failure.status });
      const next = nextLive();
      note('model-switch', { tried: label(c), reason: reasonOf(failure), status: failure.status, movedOnTo: next ? label(next) : 'none left' });
    }
    const detail = outcomes.map(o => `${o.provider}: ${o.reason}`).join('; ') || 'none connected';
    note(EXHAUSTED_EVENT, { outcomes });
    throw new FailoverExhausted(`None of your connected AI providers could answer just now (${detail}), so nothing was written; check their credit or limits, or try again shortly.`, outcomes);
  }
}
