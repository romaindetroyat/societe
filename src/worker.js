// Worker unique : API JSON + serveur MCP + fichiers (R2) + PWA statique (assets)
import { handleMcp } from './mcp.js';
import * as db from './db.js';

const COOKIE = 'sk';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      // --- MCP : /mcp/<clé> ou /mcp avec Authorization: Bearer <clé>
      if (p === '/mcp' || p.startsWith('/mcp/')) {
        if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
        const key = p.startsWith('/mcp/') ? decodeURIComponent(p.slice(5)) : bearer(request);
        const user = await authKey(env, key);
        if (!user) return cors(json({ error: 'clé invalide' }, 401));
        track(ctx, env, user, 'mcp');
        return cors(await handleMcp(request, { ...env, viewer: user }, user));
      }
      // Pas d'OAuth : on dit clairement qu'il n'y en a pas
      if (p.startsWith('/.well-known/oauth')) return new Response('Not found', { status: 404 });

      if (p === '/api/login' && request.method === 'POST') return login(request, env);
      if (p === '/api/logout') return new Response(null, { status: 204, headers: { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });

      if (p.startsWith('/api/') || p.startsWith('/files/')) {
        const user = await authKey(env, readCookie(request, COOKIE) || bearer(request));
        if (!user) return json({ error: 'non authentifié' }, 401);
        if (p === '/api/bootstrap') track(ctx, env, user, 'web');
        const venv = { ...env, viewer: user };
        if (p.startsWith('/files/')) return serveFile(venv, decodeURIComponent(p.slice(7)));
        return api(request, venv, user, url);
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      const msg = e.message || String(e);
      return json({ error: msg }, /introuvable/.test(msg) ? 404 : 500);
    }
  },
};

// ---------------------------------------------------------------- suivi des connexions
// Met à jour la dernière connexion ; une entrée « connexion » au journal par session (4 h sans activité).
function track(ctx, env, user, via) {
  if (!user?.id || user.id === 'admin') return;
  const job = (async () => {
    const u = await env.DB.prepare("SELECT last_seen FROM users WHERE id=?").bind(user.id).first();
    const newSession = !u?.last_seen || u.last_seen < new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    await env.DB.prepare("UPDATE users SET last_seen=datetime('now'), last_seen_via=? WHERE id=?").bind(via, user.id).run();
    if (newSession) await env.DB.prepare('INSERT INTO activity (who, action, summary, via) VALUES (?,?,?,?)').bind(user.id, 'connexion', via === 'mcp' ? 'Connexion depuis Claude' : 'Connexion à l’outil', via).run();
  })().catch(() => {});
  ctx?.waitUntil ? ctx.waitUntil(job) : null;
}

// ---------------------------------------------------------------- auth
export async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function authKey(env, key) {
  if (!key) return null;
  if (env.ADMIN_KEY && key === env.ADMIN_KEY) {
    const u = await env.DB.prepare('SELECT * FROM users WHERE is_admin=1 ORDER BY created_at LIMIT 1').first();
    return u || { id: 'admin', name: 'Administrateur', is_admin: 1 };
  }
  const h = await sha256(key);
  return env.DB.prepare('SELECT * FROM users WHERE token_hash=?').bind(h).first();
}
function bearer(req) {
  const a = req.headers.get('Authorization') || '';
  return a.startsWith('Bearer ') ? a.slice(7).trim() : null;
}
function readCookie(req, name) {
  const c = req.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
async function login(request, env) {
  const { key } = await request.json();
  const user = await authKey(env, (key || '').trim());
  if (!user) return json({ error: 'Clé d’accès invalide' }, 401);
  return json(publicUser(user), 200, {
    'Set-Cookie': `${COOKIE}=${encodeURIComponent(key.trim())}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
  });
}
const publicUser = ({ token_hash, ...u }) => ({ ...u, has_key: !!token_hash });

// ---------------------------------------------------------------- API
async function api(request, env, user, url) {
  const m = request.method;
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // sans 'api'
  const [res, id, sub] = parts;
  const body = ['POST', 'PUT', 'PATCH'].includes(m) && !(request.headers.get('Content-Type') || '').startsWith('multipart')
    ? await request.json().catch(() => ({})) : null;
  const ctx = { env, user, via: 'web' };

  switch (res) {
    case 'me':
      return json(publicUser(user));
    case 'bootstrap':
      return json(await db.bootstrap(env, user));
    case 'items':
      if (m === 'GET' && !id) return json(await db.listItems(env, Object.fromEntries(url.searchParams)));
      if (m === 'GET' && id) return json(await db.getItem(env, +id));
      if (m === 'POST' && id && sub === 'comments') return json(await db.addComment(ctx, +id, body.body));
      if (m === 'POST' && id && sub === 'file') return json(await uploadFile(request, ctx, +id));
      if (m === 'POST' && id && sub === 'links') return json(await db.setLinks(ctx, +id, body.ids || []));
      if (m === 'POST') return json(await db.createItem(ctx, body));
      if ((m === 'PUT' || m === 'PATCH') && id) return json(await db.updateItem(ctx, +id, body));
      if (m === 'DELETE' && id) return json(await db.deleteItem(ctx, +id));
      break;
    case 'contacts':
      if (m === 'GET') return json(await db.listContacts(env, url.searchParams.get('q')));
      if (m === 'POST') return json(await db.saveContact(ctx, body));
      if (m === 'PUT' && id) return json(await db.saveContact(ctx, { ...body, id: +id }));
      if (m === 'DELETE' && id) return json(await db.deleteContact(ctx, +id));
      break;
    case 'workstreams':
      if (m === 'POST' || m === 'PUT') return json(await db.saveWorkstream(ctx, body));
      break;
    case 'settings':
      if (m === 'PUT' && id) return json(await db.saveSetting(ctx, id, body.value));
      break;
    case 'activity':
      return json(await db.listActivity(env, +(url.searchParams.get('limit') || 100)));
    case 'roadmap':
      return new Response(await db.roadmapMarkdown(env, {}), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
    case 'users':
      if (!user.is_admin) return json({ error: 'réservé à l’administrateur' }, 403);
      if (m === 'GET') return json((await env.DB.prepare('SELECT * FROM users ORDER BY created_at').all()).results.map(publicUser));
      if (m === 'POST' && id && sub === 'key') {
        const key = randomKey();
        await env.DB.prepare('UPDATE users SET token_hash=? WHERE id=?').bind(await sha256(key), id).run();
        await db.log(ctx, 'clé', null, `Nouvelle clé d’accès générée pour ${id}`);
        return json({ key });
      }
      if (m === 'POST') {
        await env.DB.prepare('INSERT INTO users (id,name,org,role,is_admin,color) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, org=excluded.org, role=excluded.role, color=excluded.color')
          .bind(body.id, body.name, body.org || null, body.role || null, body.is_admin ? 1 : 0, body.color || null).run();
        return json({ ok: true });
      }
      break;
  }
  return json({ error: 'route inconnue' }, 404);
}

function randomKey() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
}

async function uploadFile(request, ctx, id) {
  const fd = await request.formData();
  const f = fd.get('file');
  if (!f || typeof f === 'string') throw new Error('fichier manquant');
  const key = `items/${id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
  await ctx.env.FILES.put(key, f.stream(), { httpMetadata: { contentType: f.type || 'application/octet-stream' } });
  return db.updateItem(ctx, id, { file_key: key, file_name: f.name, file_type: f.type });
}
async function serveFile(env, key) {
  const m = key.match(/^items\/(\d+)\//);
  const it = m && (await env.DB.prepare('SELECT audience FROM items WHERE id=?').bind(+m[1]).first());
  if (!it || !db.canSee(env, it)) return new Response('Introuvable', { status: 404 });
  const o = await env.FILES.get(key);
  if (!o) return new Response('Introuvable', { status: 404 });
  const h = new Headers();
  o.writeHttpMetadata(h);
  h.set('Cache-Control', 'private, max-age=3600');
  return new Response(o.body, { headers: h });
}

// ---------------------------------------------------------------- utils
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
function cors(res) {
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  r.headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  return r;
}
