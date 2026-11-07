// Serveur MCP minimal (Streamable HTTP, sans état, réponses JSON)
import * as db from './db.js';

const PROTOCOL = '2025-06-18';
const kindEnum = Object.keys(db.KINDS);
const itemProps = {
  title: { type: 'string' },
  body: { type: 'string', description: 'Description en markdown' },
  status: { type: 'string', description: 'Statut ; voir la ressource des statuts par type dans « tableau_de_bord »' },
  workstream: { type: 'string', description: 'Identifiant du chantier (voir « chantiers »)' },
  owner: { type: 'string', description: 'Identifiant du référent pressenti (romain, kevin, arnaud, pierre, edouard…)' },
  priority: { type: 'string', enum: ['haute', 'normale', 'basse'] },
  start_date: { type: 'string', description: 'YYYY-MM-DD' },
  due_date: { type: 'string', description: 'Échéance YYYY-MM-DD' },
  decision_date: { type: 'string', description: 'Date de décision YYYY-MM-DD' },
  effective_date: { type: 'string', description: "Date d'application / d'effet YYYY-MM-DD" },
  options: { type: 'string', description: 'Questions : pistes / options évoquées (markdown)' },
  outcome: { type: 'string', description: 'Questions : position commune, uniquement si actée par tous' },
  url: { type: 'string', description: 'Lien externe (Drive…)' },
  audience: { type: 'string', description: 'Visibilité restreinte : identifiants séparés par des virgules (ex. « romain,pierre,edouard »). Vide = visible par tous.' },
  link_ids: { type: 'array', items: { type: 'integer' }, description: 'Identifiants des éléments liés (remplace les liens existants)' },
};

const TOOLS = [
  {
    name: 'tableau_de_bord',
    description: "Vue d'ensemble du projet de création de société : compteurs par type et statut, éléments en retard, échéances à 30 jours, questions ouvertes, chantiers, équipe et statuts possibles.",
    inputSchema: { type: 'object', properties: {} },
    run: async (env) => {
      const [o, ws, users, s] = await Promise.all([
        db.overview(env),
        env.DB.prepare('SELECT id,title,description,lead FROM workstreams ORDER BY sort').all(),
        env.DB.prepare('SELECT id,name,org,role FROM users').all(),
        env.DB.prepare("SELECT value FROM settings WHERE key='projet'").first(),
      ]);
      return { projet: s ? JSON.parse(s.value) : null, ...o, chantiers: ws.results, equipe: users.results, statuts_par_type: Object.fromEntries(Object.entries(db.KINDS).map(([k, v]) => [k, v.statuses])) };
    },
  },
  {
    name: 'tableau_de_marche',
    description: "Tableau de marche : les étapes du projet dans l'ordre, et pour chacune les questions à trancher (ordre, réponse attendue, dépendances, statut), les rendez-vous, étapes et documents. Indique l'étape en cours.",
    inputSchema: { type: 'object', properties: {} },
    run: async (env) => {
      const m = await env.DB.prepare("SELECT value FROM settings WHERE key='marche'").first();
      if (!m) return 'Tableau de marche non défini.';
      const M = JSON.parse(m.value);
      const all = (await env.DB.prepare('SELECT * FROM items').all()).results.filter((i) => db.canSee(env, i));
      const I = Object.fromEntries(all.map((i) => [i.id, i]));
      const done = (i) => i && (db.KINDS[i.kind]?.done || []).includes(i.status);
      let cur = -1, md = `# Tableau de marche\n`;
      M.phases.forEach((p, pi) => {
        const ids = [...(p.questions || []).map((q) => q.id), ...(p.etapes || []), ...(p.documents || []), ...(p.jalons || [])].filter((id) => I[id]);
        const ok = ids.filter((id) => done(I[id])).length;
        if (cur < 0 && ok < ids.length) cur = pi;
        md += `\n## ${pi + 1}. ${p.titre}${cur === pi ? ' ← étape en cours' : ''} (d'ici le ${p.fin}, ${ok}/${ids.length} traités)\nObjectif : ${p.objectif}\nRésultat attendu : ${p.resultat}\n`;
        (p.questions || []).forEach((q, qi) => { const i = I[q.id]; if (i) md += `- Q${pi + 1}.${qi + 1} [#${i.id}] ${i.title} — ${i.status}${i.outcome ? ' — position commune : ' + i.outcome : ''}\n  Réponse attendue : ${q.attendu}${q.apres ? `\n  Après : ${q.apres.map((d) => '#' + d).join(', ')}` : ''}\n`; });
        for (const [lab, key] of [['Rendez-vous', 'jalons'], ['Étapes', 'etapes'], ['Documents', 'documents']]) {
          const l = (p[key] || []).map((id) => I[id]).filter(Boolean);
          if (l.length) md += `${lab} : ${l.map((i) => `#${i.id} ${i.title} (${i.status}${i.due_date ? ', ' + i.due_date : ''})`).join(' ; ')}\n`;
        }
      });
      return md;
    },
  },
  {
    name: 'lister',
    description: 'Lister / rechercher les éléments (étapes = task, questions à trancher ensemble = decision, documents, jalons, sujets) avec filtres.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: kindEnum },
        status: { type: 'string' }, workstream: { type: 'string' }, owner: { type: 'string' },
        q: { type: 'string', description: 'Recherche plein texte' },
        open: { type: 'boolean', description: 'Uniquement les éléments non terminés' },
        before: { type: 'string', description: 'Date clé ≤ YYYY-MM-DD' },
      },
    },
    run: async (env, a) => (await db.listItems(env, a)).map(({ body, options, ...r }) => ({ ...r, extrait: (body || '').slice(0, 200) })),
  },
  {
    name: 'detail',
    description: "Détail complet d'un élément : description, options, arbitrage, commentaires, éléments liés, lien du fichier.",
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    run: async (env, a, user, origin) => {
      const it = await db.getItem(env, a.id);
      if (it.file_key) it.fichier = `${origin}/files/${encodeURIComponent(it.file_key)} (accès authentifié)`;
      return it;
    },
  },
  {
    name: 'lire_document',
    description: "Lire le contenu d'un document : texte markdown saisi dans l'outil, et contenu du fichier joint s'il est textuel (md, txt, csv, json, html).",
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    run: async (env, a) => {
      const it = await db.getItem(env, a.id);
      let fichier = null;
      if (it.file_key && env.FILES) {
        const o = await env.FILES.get(it.file_key);
        const t = o?.httpMetadata?.contentType || it.file_type || '';
        fichier = o && /^text\/|json|markdown|csv|xml/.test(t) ? (await o.text()).slice(0, 200000) : `Fichier binaire (${t || 'inconnu'}) : ${it.file_name}. Ouvrir dans l'outil web.`;
      }
      return { id: it.id, titre: it.title, statut: it.status, lien: it.url, contenu: it.body, fichier };
    },
  },
  {
    name: 'creer',
    description: 'Créer un élément (étape, question à trancher ensemble, document, jalon, sujet). Formuler le titre comme une question ou une piste, jamais comme une décision imposée.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: kindEnum }, ...itemProps }, required: ['kind', 'title'] },
    run: (env, a, user) => db.createItem({ env, user, via: 'mcp' }, a),
  },
  {
    name: 'modifier',
    description: "Modifier un élément existant (statut, référent pressenti, dates, position commune d'une question, échéances…). Seuls les champs fournis changent. Ne renseigner « outcome » que pour une position réellement actée par tous.",
    inputSchema: { type: 'object', properties: { id: { type: 'integer' }, ...itemProps }, required: ['id'] },
    run: (env, { id, ...a }, user) => db.updateItem({ env, user, via: 'mcp' }, id, a),
  },
  {
    name: 'commenter',
    description: 'Ajouter un commentaire à un élément.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' }, texte: { type: 'string' } }, required: ['id', 'texte'] },
    run: (env, a, user) => db.addComment({ env, user, via: 'mcp' }, a.id, a.texte),
  },
  {
    name: 'feuille_de_route',
    description: 'Feuille de route indicative à jour (markdown), par mois : dates de discussion, échéances envisagées, prises d’effet, avec chantier, référent pressenti et statut.',
    inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: (env, a) => db.roadmapMarkdown(env, a),
  },
  {
    name: 'chantiers',
    description: 'Liste des chantiers (axes de travail) avec avancement.',
    inputSchema: { type: 'object', properties: {} },
    run: async (env) => {
      const ws = (await env.DB.prepare('SELECT * FROM workstreams ORDER BY sort').all()).results;
      const items = (await env.DB.prepare('SELECT workstream, kind, status, audience FROM items').all()).results.filter((i) => db.canSee(env, i));
      return ws.map((w) => {
        const its = items.filter((i) => i.workstream === w.id);
        const done = its.filter((i) => db.KINDS[i.kind].done.includes(i.status)).length;
        return { ...w, elements: its.length, termines: done, avancement: its.length ? Math.round((100 * done) / its.length) + ' %' : '—' };
      });
    },
  },
  {
    name: 'contacts',
    description: 'Annuaire partagé des interlocuteurs (recherche par nom, organisation, rôle, tag).',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    run: (env, a) => db.listContacts(env, a.q),
  },
  {
    name: 'enregistrer_contact',
    description: 'Ajouter un contact, ou le modifier si id est fourni.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' }, org: { type: 'string' }, role: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, notes: { type: 'string' }, tags: { type: 'string' } },
    },
    run: (env, a, user) => db.saveContact({ env, user, via: 'mcp' }, a),
  },
  {
    name: 'activite',
    description: 'Journal des dernières modifications (qui a fait quoi, via le web ou Claude).',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
    run: (env, a) => db.listActivity(env, a.limit || 50),
  },
];

export async function handleMcp(request, env, user) {
  if (request.method === 'GET') return new Response('SSE non supporté', { status: 405, headers: { Allow: 'POST' } });
  if (request.method === 'DELETE') return new Response(null, { status: 204 });
  const origin = new URL(request.url).origin;
  const msg = await request.json();
  const batch = Array.isArray(msg);
  const out = [];
  for (const m of batch ? msg : [msg]) {
    const r = await rpc(m, env, user, origin);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(batch ? out : out[0]), { headers: { 'Content-Type': 'application/json' } });
}

async function rpc(m, env, user, origin) {
  if (m.id === undefined || m.id === null) return null; // notification
  const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize':
      return ok({
        protocolVersion: m.params?.protocolVersion || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'pilotage-societe', version: '1.0.0' },
        instructions: `Outil de pilotage de la création de la nouvelle société (ex-projet Take Off). Utilisateur connecté : ${user.name} (${user.id}). Commencer par « tableau_de_bord » pour le contexte, les identifiants des chantiers et de l'équipe. C'est un outil de présentation et de suivi partagé entre futurs associés et partenaires : rien n'est acté sans l'accord de tous. Formuler les éléments comme des questions ou des pistes, avec un ton ouvert, jamais comme des décisions prises à la place des autres. Les modifications sont journalisées au nom de l'utilisateur.`,
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const t = TOOLS.find((x) => x.name === m.params?.name);
      if (!t) return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'outil inconnu' } };
      try {
        const res = await t.run(env, m.params.arguments || {}, user, origin);
        return ok({ content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 1) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: 'Erreur : ' + e.message }], isError: true });
      }
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default:
      return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'méthode inconnue' } };
  }
}
