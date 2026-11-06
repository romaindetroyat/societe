// Accès aux données (D1) partagé par l'API web et le serveur MCP

export const KINDS = {
  task: { label: 'Tâche', statuses: ['a_faire', 'en_cours', 'bloque', 'fait'], done: ['fait'] },
  decision: { label: 'Décision à trancher', statuses: ['ouverte', 'en_discussion', 'tranchee'], done: ['tranchee'] },
  document: { label: 'Document', statuses: ['a_produire', 'brouillon', 'en_revue', 'valide', 'signe'], done: ['valide', 'signe'] },
  event: { label: 'Jalon / événement', statuses: ['prevu', 'fait', 'annule'], done: ['fait', 'annule'] },
  budget: { label: 'Ligne budgétaire', statuses: ['estime', 'engage', 'paye'], done: ['paye'] },
  topic: { label: 'Sujet en cours', statuses: ['ouvert', 'en_cours', 'clos'], done: ['clos'] },
};

const FIELDS = ['kind', 'title', 'body', 'status', 'workstream', 'owner', 'priority', 'start_date', 'due_date',
  'decision_date', 'effective_date', 'amount', 'budget_type', 'options', 'outcome', 'url', 'file_key', 'file_name', 'file_type'];
const CONTACT_FIELDS = ['name', 'org', 'role', 'email', 'phone', 'address', 'notes', 'tags', 'user_id'];

const all = async (stmt) => (await stmt.all()).results;
const today = () => new Date().toISOString().slice(0, 10);

export async function log(ctx, action, itemId, summary) {
  await ctx.env.DB.prepare('INSERT INTO activity (who, action, item_id, summary, via) VALUES (?,?,?,?,?)')
    .bind(ctx.user?.id || null, action, itemId, summary, ctx.via || 'web').run();
}

export async function bootstrap(env, user) {
  const DB = env.DB;
  const [users, workstreams, items, contacts, settings, links] = await Promise.all([
    all(DB.prepare('SELECT id,name,org,role,is_admin,color FROM users ORDER BY created_at')),
    all(DB.prepare('SELECT * FROM workstreams ORDER BY sort, title')),
    all(DB.prepare(`SELECT i.*, (SELECT count(*) FROM comments c WHERE c.item_id=i.id) AS n_comments FROM items i ORDER BY i.id`)),
    all(DB.prepare('SELECT * FROM contacts ORDER BY org, name')),
    all(DB.prepare('SELECT * FROM settings')),
    all(DB.prepare('SELECT * FROM links')),
  ]);
  return {
    me: { id: user.id, name: user.name, is_admin: !!user.is_admin },
    users, workstreams, items, contacts, links, kinds: KINDS,
    settings: Object.fromEntries(settings.map((s) => [s.key, safeJson(s.value)])),
  };
}
const safeJson = (v) => { try { return JSON.parse(v); } catch { return v; } };

export async function listItems(env, f = {}) {
  const where = [], args = [];
  if (f.kind) { where.push('kind=?'); args.push(f.kind); }
  if (f.status) { where.push('status=?'); args.push(f.status); }
  if (f.workstream) { where.push('workstream=?'); args.push(f.workstream); }
  if (f.owner) { where.push('owner=?'); args.push(f.owner); }
  if (f.q) { where.push('(title LIKE ? OR body LIKE ? OR options LIKE ? OR outcome LIKE ?)'); const q = `%${f.q}%`; args.push(q, q, q, q); }
  if (f.open === 'true' || f.open === true) {
    const done = Object.values(KINDS).flatMap((k) => k.done);
    where.push(`(status IS NULL OR status NOT IN (${done.map(() => '?').join(',')}))`); args.push(...done);
  }
  if (f.before) { where.push('coalesce(due_date, decision_date, effective_date) <= ?'); args.push(f.before); }
  const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY coalesce(due_date, decision_date, effective_date, '9999') , id LIMIT ${Math.min(+f.limit || 500, 1000)}`;
  return all(env.DB.prepare(sql).bind(...args));
}

export async function getItem(env, id) {
  const item = await env.DB.prepare('SELECT * FROM items WHERE id=?').bind(id).first();
  if (!item) throw new Error(`élément ${id} introuvable`);
  const [comments, linked] = await Promise.all([
    all(env.DB.prepare('SELECT * FROM comments WHERE item_id=? ORDER BY created_at').bind(id)),
    all(env.DB.prepare(`SELECT i.id, i.kind, i.title, i.status FROM links l JOIN items i
      ON i.id = CASE WHEN l.from_id=? THEN l.to_id ELSE l.from_id END WHERE l.from_id=? OR l.to_id=?`).bind(id, id, id)),
  ]);
  return { ...item, comments, linked };
}

function clean(data) {
  const out = {};
  for (const k of FIELDS) if (k in data) out[k] = data[k] === '' ? null : data[k];
  if ('amount' in out && out.amount != null) out.amount = Number(out.amount);
  return out;
}

export async function createItem(ctx, data) {
  const d = clean(data);
  if (!d.kind || !KINDS[d.kind]) throw new Error(`type invalide (${Object.keys(KINDS).join(', ')})`);
  if (!d.title) throw new Error('titre requis');
  if (!d.status) d.status = KINDS[d.kind].statuses[0];
  const keys = Object.keys(d);
  const r = await ctx.env.DB.prepare(`INSERT INTO items (${keys.join(',')}, created_by) VALUES (${keys.map(() => '?').join(',')}, ?) RETURNING id`)
    .bind(...keys.map((k) => d[k]), ctx.user?.id || null).first();
  if (Array.isArray(data.link_ids)) await setLinks(ctx, r.id, data.link_ids, true);
  await log(ctx, 'création', r.id, `${KINDS[d.kind].label} « ${d.title} »`);
  return getItem(ctx.env, r.id);
}

export async function updateItem(ctx, id, data) {
  const before = await ctx.env.DB.prepare('SELECT * FROM items WHERE id=?').bind(id).first();
  if (!before) throw new Error(`élément ${id} introuvable`);
  const d = clean(data);
  delete d.kind;
  const keys = Object.keys(d);
  if (keys.length) {
    await ctx.env.DB.prepare(`UPDATE items SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`)
      .bind(...keys.map((k) => d[k]), id).run();
    const changed = keys.filter((k) => String(before[k] ?? '') !== String(d[k] ?? ''));
    if (changed.length) {
      const detail = changed.includes('status') ? ` → ${d.status}` : '';
      await log(ctx, 'modification', id, `« ${before.title} » (${changed.join(', ')})${detail}`);
    }
  }
  if (Array.isArray(data.link_ids)) await setLinks(ctx, id, data.link_ids, true);
  return getItem(ctx.env, id);
}

export async function deleteItem(ctx, id) {
  const it = await ctx.env.DB.prepare('SELECT title, file_key FROM items WHERE id=?').bind(id).first();
  if (!it) throw new Error('introuvable');
  if (it.file_key && ctx.env.FILES) await ctx.env.FILES.delete(it.file_key);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM comments WHERE item_id=?').bind(id),
    ctx.env.DB.prepare('DELETE FROM links WHERE from_id=? OR to_id=?').bind(id, id),
    ctx.env.DB.prepare('DELETE FROM items WHERE id=?').bind(id),
  ]);
  await log(ctx, 'suppression', id, `« ${it.title} »`);
  return { ok: true };
}

export async function setLinks(ctx, id, ids, silent) {
  const stmts = [ctx.env.DB.prepare('DELETE FROM links WHERE from_id=? OR to_id=?').bind(id, id)];
  for (const o of new Set(ids.map(Number).filter((x) => x && x !== id)))
    stmts.push(ctx.env.DB.prepare('INSERT OR IGNORE INTO links (from_id, to_id) VALUES (?,?)').bind(id, o));
  await ctx.env.DB.batch(stmts);
  if (!silent) await log(ctx, 'liens', id, `${ids.length} lien(s)`);
  return getItem(ctx.env, id);
}

export async function addComment(ctx, id, body) {
  if (!body) throw new Error('commentaire vide');
  await ctx.env.DB.prepare('INSERT INTO comments (item_id, author, body) VALUES (?,?,?)').bind(id, ctx.user?.id, body).run();
  await ctx.env.DB.prepare("UPDATE items SET updated_at=datetime('now') WHERE id=?").bind(id).run();
  await log(ctx, 'commentaire', id, body.slice(0, 140));
  return getItem(ctx.env, id);
}

export async function listContacts(env, q) {
  if (!q) return all(env.DB.prepare('SELECT * FROM contacts ORDER BY org, name'));
  const like = `%${q}%`;
  return all(env.DB.prepare('SELECT * FROM contacts WHERE name LIKE ? OR org LIKE ? OR role LIKE ? OR tags LIKE ? OR notes LIKE ? OR email LIKE ? ORDER BY org, name')
    .bind(like, like, like, like, like, like));
}
export async function saveContact(ctx, c) {
  const d = {};
  for (const k of CONTACT_FIELDS) if (k in c) d[k] = c[k] === '' ? null : c[k];
  if (c.id) {
    const keys = Object.keys(d);
    await ctx.env.DB.prepare(`UPDATE contacts SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`).bind(...keys.map((k) => d[k]), c.id).run();
    await log(ctx, 'contact', null, `Contact modifié : ${d.name || c.id}`);
    return ctx.env.DB.prepare('SELECT * FROM contacts WHERE id=?').bind(c.id).first();
  }
  if (!d.name) throw new Error('nom requis');
  const keys = Object.keys(d);
  const r = await ctx.env.DB.prepare(`INSERT INTO contacts (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) RETURNING *`).bind(...keys.map((k) => d[k])).first();
  await log(ctx, 'contact', null, `Contact ajouté : ${d.name}`);
  return r;
}
export async function deleteContact(ctx, id) {
  await ctx.env.DB.prepare('DELETE FROM contacts WHERE id=?').bind(id).run();
  await log(ctx, 'contact', null, `Contact supprimé (${id})`);
  return { ok: true };
}

export async function saveWorkstream(ctx, w) {
  if (!w.id || !w.title) throw new Error('id et titre requis');
  await ctx.env.DB.prepare(`INSERT INTO workstreams (id,title,description,icon,color,lead,sort) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, icon=excluded.icon, color=excluded.color, lead=excluded.lead, sort=excluded.sort`)
    .bind(w.id, w.title, w.description || null, w.icon || null, w.color || null, w.lead || null, w.sort || 0).run();
  await log(ctx, 'chantier', null, `Chantier « ${w.title} » enregistré`);
  return { ok: true };
}

export async function saveSetting(ctx, key, value) {
  await ctx.env.DB.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(key, typeof value === 'string' ? value : JSON.stringify(value)).run();
  await log(ctx, 'paramètre', null, `Paramètre « ${key} » mis à jour`);
  return { ok: true };
}

export async function listActivity(env, limit = 100) {
  return all(env.DB.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').bind(Math.min(limit, 500)));
}

export async function overview(env) {
  const items = await all(env.DB.prepare('SELECT * FROM items'));
  const t = today();
  const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const isOpen = (i) => !KINDS[i.kind].done.includes(i.status);
  const keyDate = (i) => i.due_date || i.decision_date || i.effective_date;
  const byKind = {};
  for (const i of items) {
    byKind[i.kind] ??= { total: 0, ouverts: 0, par_statut: {} };
    byKind[i.kind].total++;
    if (isOpen(i)) byKind[i.kind].ouverts++;
    byKind[i.kind].par_statut[i.status] = (byKind[i.kind].par_statut[i.status] || 0) + 1;
  }
  const budget = { charge: 0, produit: 0, investissement: 0 };
  for (const i of items.filter((i) => i.kind === 'budget')) budget[i.budget_type || 'charge'] += i.amount || 0;
  const slim = (i) => ({ id: i.id, kind: i.kind, title: i.title, status: i.status, owner: i.owner, workstream: i.workstream, date: keyDate(i) });
  return {
    date_du_jour: t,
    compteurs: byKind,
    budget_total_ht: budget,
    en_retard: items.filter((i) => isOpen(i) && keyDate(i) && keyDate(i) < t).map(slim),
    a_venir_30j: items.filter((i) => isOpen(i) && keyDate(i) >= t && keyDate(i) <= in30).sort((a, b) => keyDate(a).localeCompare(keyDate(b))).map(slim),
    decisions_ouvertes: items.filter((i) => i.kind === 'decision' && isOpen(i)).map(slim),
  };
}

export async function roadmapMarkdown(env, { from, to } = {}) {
  const [items, ws, users] = await Promise.all([
    all(env.DB.prepare('SELECT * FROM items')),
    all(env.DB.prepare('SELECT * FROM workstreams ORDER BY sort')),
    all(env.DB.prepare('SELECT id,name FROM users')),
  ]);
  const uname = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const wname = Object.fromEntries(ws.map((w) => [w.id, w.title]));
  const rows = [];
  for (const i of items) {
    for (const [field, lab] of [['decision_date', 'Décision'], ['due_date', 'Échéance'], ['effective_date', 'Application']]) {
      const d = i[field];
      if (!d || (from && d < from) || (to && d > to)) continue;
      rows.push({ d, lab, i });
    }
  }
  rows.sort((a, b) => a.d.localeCompare(b.d));
  const months = {};
  for (const r of rows) (months[r.d.slice(0, 7)] ??= []).push(r);
  let md = `# Feuille de route — générée le ${today()}\n`;
  for (const [m, rs] of Object.entries(months)) {
    const label = new Date(m + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    md += `\n## ${label}\n\n| Date | Type | Élément | Chantier | Responsable | Statut |\n|---|---|---|---|---|---|\n`;
    for (const { d, lab, i } of rs)
      md += `| ${d} | ${lab} | #${i.id} ${i.title} | ${wname[i.workstream] || '—'} | ${uname[i.owner] || '—'} | ${i.status || ''} |\n`;
  }
  return md;
}
