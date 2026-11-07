// Pilotage NewCo — PWA sans framework
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
// typographie française : espace insécable avant ? ! : ; % € »
const nb = (s) => String(s ?? '').replace(/ ([?!:;%€»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');
const esc = (s) => nb(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => (s ? DOMPurify.sanitize(marked.parse(nb(s))) : '');
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10);
const fmtDate = (d, long) => d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: '2-digit', month: 'short' }) : '';
const eur = (n) => (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

const ST_LABEL = { a_faire: 'À instruire', en_cours: 'En cours', bloque: 'En attente', fait: 'Traité', ouverte: 'Ouverte', en_discussion: 'En discussion', tranchee: 'Position commune', a_produire: 'À préparer', brouillon: 'Brouillon', en_revue: 'En relecture', valide: 'Validé ensemble', signe: 'Signé', prevu: 'Envisagé', annule: 'Abandonné', estime: 'Estimation', engage: 'Engagé', paye: 'Payé', ouvert: 'Ouvert', clos: 'Clos' };
const ST_CLASS = { a_faire: 'todo', ouverte: 'todo', a_produire: 'todo', prevu: 'todo', estime: 'todo', ouvert: 'todo', en_cours: 'doing', en_discussion: 'doing', brouillon: 'doing', engage: 'doing', en_revue: 'review', bloque: 'block', fait: 'done', tranchee: 'done', valide: 'done', signe: 'done', paye: 'done', clos: 'done', annule: 'done' };
const KIND = {
  task: { icon: 'check-square', label: 'Étape', plural: 'Étapes' },
  decision: { icon: 'question', label: 'Question à trancher ensemble', plural: 'Questions' },
  document: { icon: 'file-text', label: 'Document', plural: 'Documents' },
  event: { icon: 'flag-banner', label: 'Jalon envisagé', plural: 'Jalons' },
  topic: { icon: 'chats-circle', label: 'Sujet en discussion', plural: 'Sujets' },
};
const EXTRA = {
  task: ['start_date', 'due_date'],
  decision: ['decision_date', 'effective_date', 'options', 'outcome'],
  document: ['due_date', 'url'],
  event: ['start_date', 'due_date', 'effective_date'],
  topic: ['due_date', 'decision_date'],
};
const F_LABEL = { start_date: 'Début envisagé', due_date: 'Échéance envisagée', decision_date: 'À discuter d’ici le', effective_date: 'Prise d’effet envisagée', amount: 'Montant € HT (estimation)', budget_type: 'Nature', options: 'Pistes / options (markdown)', outcome: 'Position commune, si actée', url: 'Lien (Drive, Docs…)' };
// palette Takeoff : lime, encre, olive, gris, + quelques teintes neutres pour distinguer les chantiers
const PALETTE = [['#C7EB00', '#0A0A0A'], ['#2A2A2A', '#FAFAFA'], ['#9BBF00', '#0A0A0A'], ['#5F7380', '#FAFAFA'], ['#A3A3A3', '#0A0A0A'], ['#4E7A00', '#FAFAFA'], ['#E0A526', '#0A0A0A'], ['#3E8E7E', '#FAFAFA'], ['#C77B58', '#FAFAFA'], ['#D4F234', '#0A0A0A'], ['#6B6B6B', '#FAFAFA']];

let D = null; // données
const S = { hide: new Set(), filters: {}, roadmapMode: null, docStatus: null, schemaTab: 'structure', zoom: null };

// ------------------------------------------------------------------ API
async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}, ...opts, body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body });
  if (r.status === 401) { showLogin(); throw new Error('non authentifié'); }
  const ct = r.headers.get('Content-Type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
async function load() { D = await api('/api/bootstrap'); index(); }
function index() {
  const UP = [['#C7EB00', '#0A0A0A'], ['#2A2A2A', '#FAFAFA'], ['#5F7380', '#FAFAFA'], ['#9BBF00', '#0A0A0A'], ['#A3A3A3', '#0A0A0A']];
  D.u = Object.fromEntries(D.users.map((u, i) => [u.id, { ...u, color: u.color || UP[i % UP.length][0], fg: UP[i % UP.length][1] }]));
  D.w = Object.fromEntries(D.workstreams.map((w, i) => [w.id, { ...w, color: w.color || PALETTE[i % PALETTE.length][0], fg: PALETTE[i % PALETTE.length][1] }]));
  D.i = Object.fromEntries(D.items.map((i) => [i.id, i]));
  D.proj = D.settings.projet || {};
}
const isDone = (i) => (D.kinds[i.kind]?.done || []).includes(i.status);
const keyDate = (i) => i.due_date || i.decision_date || i.effective_date || i.start_date;
const items = (f = {}) => D.items.filter((i) => (!f.kind || i.kind === f.kind) && (!f.ws || i.workstream === f.ws) && (!f.owner || i.owner === f.owner) && (f.open == null || !isDone(i) === f.open));

// ------------------------------------------------------------------ petits composants
const st = (s) => s ? `<span class="st s-${ST_CLASS[s] || 'todo'}">${esc(ST_LABEL[s] || s)}</span>` : '';
const initials = (n) => (n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const av = (id, cls = '') => { const u = D.u[id]; return u ? `<span class="avatar ${cls}" style="background:${u.color};color:${u.fg}" title="${esc(u.name)}">${esc(initials(u.name))}</span>` : ''; };
const wsTag = (id) => { const w = D.w[id]; return w ? `<span class="tag"><span class="dot" style="background:${w.color}"></span>${esc(w.title)}</span>` : ''; };
function dateChip(d, done) {
  if (!d) return '';
  const cls = done ? '' : d < today() ? 'late' : d <= addDays(today(), 7) ? 'soon' : '';
  return `<span class="date-chip ${cls}">${esc(fmtDate(d))}</span>`;
}
const COLLECTIVE = ['decision', 'topic'];
const ownerAv = (i) => (i && !COLLECTIVE.includes(i.kind) ? ownerAv(i) : '');
const kindIcon = (k) => `<i class="ph ph-${KIND[k].icon}"></i>`;
const lock = (i) => i.audience ? `<span class="lock" title="Visible uniquement par : ${esc(i.audience.split(',').map((u) => D.u[u.trim()]?.name || u).join(', '))}"><i class="ph ph-lock-simple"></i></span>` : '';
function itemRow(i, opt = {}) {
  return `<div class="li" data-open="${i.id}">
    <span class="muted">${kindIcon(i.kind)}</span>
    <span class="t">${esc(i.title)}</span>
    <span class="meta">${lock(i)}${opt.noWs ? '' : `<span class="hide-sm">${wsTag(i.workstream)}</span>`}${st(i.status)}${dateChip(keyDate(i), isDone(i))}${ownerAv(i)}</span>
  </div>`;
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2600); }
function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('Copié dans le presse-papiers')); }

// ------------------------------------------------------------------ coquille
const NAV = [
  ['marche', 'list-numbers', 'Tableau de marche'],
  ['schema', 'graph', 'Schéma du montage'],
  ['decisions', 'question', 'Questions ouvertes'],
  ['taches', 'kanban', 'Étapes'],
  ['documents', 'files', 'Documents'],
  ['feuille-de-route', 'calendar-dots', 'Calendrier'],
  ['contacts', 'address-book', 'Contacts'],
  null,
  ['accueil', 'squares-four', 'Vue d’ensemble'],
  ['activite', 'clock-counter-clockwise', 'Activité'],
  ['claude', 'plugs-connected', 'Connecter Claude'],
];
function shell() {
  const route = location.hash.slice(2).split('/')[0] || 'marche';
  const counts = { taches: items({ kind: 'task', open: true }).length, decisions: items({ kind: 'decision', open: true }).length, documents: items({ kind: 'document', open: true }).length };
  const nav = NAV.map((n) => n ? `<a href="#/${n[0]}" class="${route === n[0] ? 'active' : ''}"><i class="ph ph-${n[1]}"></i>${n[2]}${counts[n[0]] ? `<span class="count">${counts[n[0]]}</span>` : ''}</a>` : '<div class="sep"></div>').join('')
    + (D.me.is_admin ? `<a href="#/equipe" class="${route === 'equipe' ? 'active' : ''}"><i class="ph ph-users-three"></i>Équipe & accès</a>` : '');
  const mob = [['marche', 'list-numbers', 'Marche'], ['schema', 'graph', 'Montage'], ['decisions', 'question', 'Questions'], ['taches', 'kanban', 'Étapes'], ['plus', 'dots-three-outline', 'Plus']];
  $('#root').innerHTML = `<div class="app">
    <nav class="nav">
      <div class="brand"><div class="name">${esc(D.proj.nom || 'Nouvelle société')}</div><div class="label sub">${esc(D.proj.phase || 'Pilotage du projet')}</div></div>
      ${nav}
      <div class="foot">${av(D.me.id)}<div class="small" style="flex:1"><div style="color:var(--text);font-weight:500">${esc(D.me.name)}</div></div>
        <button class="btn icon ghost" data-act="theme" title="Thème"><i class="ph ph-circle-half"></i></button>
        <button class="btn icon ghost" data-act="logout" title="Déconnexion"><i class="ph ph-sign-out"></i></button></div>
    </nav>
    <div class="main">
      <header class="topbar">
        <div class="search"><i class="ph ph-magnifying-glass"></i><input id="q" placeholder="Rechercher une question, une étape, un contact…" autocomplete="off"><div class="search-results" id="qr" hidden></div></div>
        <div class="spacer"></div>
        <button class="btn icon ghost" data-act="refresh" title="Actualiser"><i class="ph ph-arrows-clockwise"></i></button>
        <button class="btn primary" data-act="new"><i class="ph ph-plus"></i><span>Nouveau</span></button>
      </header>
      <section class="view" id="view"></section>
    </div>
    <nav class="mobile-nav">${mob.map((m) => `<a href="#/${m[0]}" class="${route === m[0] ? 'active' : ''}"><i class="ph ph-${m[1]}"></i>${m[2]}</a>`).join('')}</nav>
  </div>`;
}

// ------------------------------------------------------------------ vues
const VIEWS = {};

VIEWS.accueil = () => {
  const open = (k) => items({ kind: k, open: true });
  const upcoming = D.items.filter((i) => !isDone(i) && keyDate(i)).sort((a, b) => keyDate(a).localeCompare(keyDate(b))).slice(0, 10);
  const decisions = open('decision').sort((a, b) => (a.decision_date || '9').localeCompare(b.decision_date || '9'));
  const mine = items({ owner: D.me.id, open: true }).filter((i) => i.kind === 'task').slice(0, 8);
  const all = D.items.length, done = D.items.filter(isDone).length;
  const pillars = D.proj.piliers || [['megaphone', 'Acculturer'], ['graduation-cap', 'Former'], ['rocket-launch', 'Transformer']];
  return `
  <div class="hero">
    <div class="glow"></div><div class="glow b"></div>
    <div class="label">${esc(D.proj.surtitre || 'Création de société')}</div>
    <h1 style="margin-top:12px">${esc(D.proj.nom || 'Nouvelle société')}</h1>
    <p>${esc(D.proj.description || '')}</p>
    ${D.proj.avertissement ? `<div class="notice"><i class="ph ph-info"></i><span>${esc(D.proj.avertissement)}</span></div>` : ''}
    <div class="pillars">${pillars.map((p) => `<span><i class="ph ph-${esc(p[0])}"></i>${esc(p[1])}</span>`).join('')}</div>
    <div class="row" style="margin-top:22px;max-width:520px"><div class="progress" style="flex:1;background:rgba(255,255,255,.12)"><i style="width:${all ? (100 * done) / all : 0}%"></i></div><span class="label">${done}/${all} traités</span></div>
  </div>
  <div class="grid g4 section">
    ${kpi('question', decisions.length, 'questions ouvertes', '#/decisions')}
    ${kpi('check-square', open('task').length, 'étapes à instruire', '#/taches')}
    ${kpi('files', open('document').length, 'documents à préparer', '#/documents')}
    ${kpi('flag-banner', open('event').length, 'jalons envisagés', '#/feuille-de-route')}
  </div>
  <div class="grid g2 section">
    <div class="card"><div class="section-head"><h2>Prochaines échéances envisagées</h2><a href="#/feuille-de-route" class="label">Feuille de route →</a></div>
      <div class="list">${upcoming.map((i) => itemRow(i)).join('') || '<div class="empty">Rien de daté pour l’instant</div>'}</div></div>
    <div class="card"><div class="section-head"><h2>Questions ouvertes</h2><a href="#/decisions" class="label">Tout voir →</a></div>
      <div class="list">${decisions.slice(0, 10).map((i) => itemRow(i)).join('') || '<div class="empty">Aucune question ouverte</div>'}</div></div>
  </div>
  <div class="section"><div class="section-head"><h2>Chantiers</h2><a href="#/schema" class="label" data-tab="chantiers">Carte interactive →</a></div>
    <div class="grid auto">${D.workstreams.map(wsCard).join('')}</div></div>
  <div class="section card"><div class="section-head"><h2>Mes étapes</h2><span class="label">${esc(D.me.name)}</span></div>
    <div class="list">${mine.map((i) => itemRow(i)).join('') || '<div class="empty">Aucune étape ouverte à votre nom</div>'}</div></div>`;
};
const kpi = (icon, v, l, href) => `<a class="card hover kpi" href="${href}" style="text-decoration:none"><span class="ico"><i class="ph ph-${icon}"></i></span><span class="v">${v}</span><span class="label">${l}</span></a>`;
function wsStats(id) { const its = items({ ws: id }); const done = its.filter(isDone).length; return { n: its.length, done, pct: its.length ? Math.round((100 * done) / its.length) : 0, its }; }
function wsCard(w) {
  const s = wsStats(w.id), c = D.w[w.id].color;
  const openDec = s.its.filter((i) => i.kind === 'decision' && !isDone(i)).length;
  return `<a class="card hover ws-card" href="#/chantier/${w.id}" style="text-decoration:none">
    <div class="row between"><span class="ico" style="background:${c};color:${D.w[w.id].fg}"><i class="ph ph-${esc(w.icon || 'circle')}"></i></span>${av(w.lead)}</div>
    <h3>${esc(w.title)}</h3>
    <div class="small muted" style="min-height:2.6em">${esc((w.description || '').slice(0, 110))}</div>
    <div class="progress"><i style="width:${s.pct}%;background:${c}"></i></div>
    <div class="counts label"><span>${s.pct} %</span><span>${s.n} éléments</span>${openDec ? `<span style="color:var(--amber-text)">${openDec} question${openDec > 1 ? 's' : ''}</span>` : ''}</div>
  </a>`;
}

VIEWS.chantier = (id) => {
  const w = D.w[id];
  if (!w) return '<div class="empty">Chantier introuvable</div>';
  const s = wsStats(id);
  const groups = Object.keys(KIND).map((k) => [k, s.its.filter((i) => i.kind === k)]).filter(([, l]) => l.length);
  return `<div class="page-head"><div><div class="label"><a href="#/accueil">Cockpit</a> / Chantier</div>
      <h1 style="margin-top:10px;display:flex;gap:14px;align-items:center"><span class="ws-card"><span class="ico" style="background:${w.color};color:${w.fg}"><i class="ph ph-${esc(w.icon || 'circle')}"></i></span></span>${esc(w.title)}</h1>
      <p class="muted">${esc(w.description || '')}</p>
      <div class="row" style="margin-top:12px">${w.lead ? `${av(w.lead)}<span class="small">Référent pressenti : ${esc(D.u[w.lead]?.name)}</span>` : ''}<span class="label">${s.pct} % · ${s.done}/${s.n}</span></div></div>
    <div class="row"><button class="btn primary" data-act="new" data-ws="${id}"><i class="ph ph-plus"></i>Ajouter</button>${D.me.is_admin ? `<button class="btn" data-act="edit-ws" data-id="${id}"><i class="ph ph-pencil-simple"></i>Modifier</button>` : ''}</div></div>
    <div class="progress" style="margin-bottom:24px"><i style="width:${s.pct}%;background:${w.color}"></i></div>
    <div class="grid g2">${groups.map(([k, l]) => `<div class="card"><div class="section-head"><h3>${kindIcon(k)} ${KIND[k].plural}</h3><span class="label">${l.length}</span></div><div class="list">${l.map((i) => itemRow(i, { noWs: true })).join('')}</div></div>`).join('') || '<div class="empty">Aucun élément</div>'}</div>`;
};

// ------------------------------------------------------------------ tableau de marche
VIEWS.marche = () => {
  const M = D.settings.marche;
  if (!M?.phases?.length) return '<div class="empty">Tableau de marche non défini.</div>';
  const it = (id) => D.i[id];
  const num = {};
  M.phases.forEach((p, pi) => (p.questions || []).forEach((q, qi) => (num[q.id] = `${pi + 1}.${qi + 1}`)));
  const stats = M.phases.map((p) => {
    const ids = [...(p.questions || []).map((q) => q.id), ...(p.etapes || []), ...(p.documents || []), ...(p.jalons || [])].filter(it);
    const done = ids.filter((id) => isDone(it(id))).length;
    return { n: ids.length, done, pct: ids.length ? Math.round((100 * done) / ids.length) : 0 };
  });
  const cur = Math.max(0, stats.findIndex((s) => s.done < s.n));
  const P = M.phases[cur];
  // prochaines actions : questions débloquées (dépendances traitées), puis étapes les plus proches
  const ready = (P.questions || []).filter((q) => it(q.id) && !isDone(it(q.id)) && (q.apres || []).every((d) => it(d) && isDone(it(d))));
  const nextSteps = (P.etapes || []).map(it).filter((i) => i && !isDone(i)).sort((a, b) => (keyDate(a) || '9').localeCompare(keyDate(b) || '9'));
  const nextJ = (P.jalons || []).map(it).filter((i) => i && !isDone(i));
  const qLine = (q) => {
    const i = it(q.id); if (!i) return '';
    const blk = (q.apres || []).filter((d) => it(d) && !isDone(it(d)));
    return `<li class="mq ${isDone(i) ? 'done' : ''}" data-open="${i.id}">
      <span class="mq-n">${num[q.id]}</span>
      <div class="mq-b"><div class="mq-t">${esc(i.title)}</div>
        <div class="mq-a"><i class="ph ph-arrow-bend-down-right"></i> <b>Réponse attendue :</b> ${esc(q.attendu || '')}</div>
        ${i.outcome ? `<div class="mq-a" style="color:var(--accent-text)"><i class="ph ph-check-circle"></i> ${esc(i.outcome)}</div>` : ''}
        <div class="row" style="gap:6px;margin-top:8px">${st(i.status)}${i.decision_date ? `<span class="label">à discuter d’ici</span>${dateChip(i.decision_date, isDone(i))}` : ''}${blk.length ? `<span class="tag"><i class="ph ph-link"></i>après ${blk.map((d) => num[d] || '#' + d).join(', ')}</span>` : ''}${ownerAv(i)}</div></div></li>`;
  };
  const small = (ids, icon) => ids.map(it).filter(Boolean).map((i) => `<div class="li" data-open="${i.id}"><span class="muted"><i class="ph ph-${icon}"></i></span><span class="t" style="font-weight:400">${esc(i.title)}</span><span class="meta">${st(i.status)}${dateChip(keyDate(i), isDone(i))}${ownerAv(i)}</span></div>`).join('');
  return `<div class="page-head"><div><div class="label">${esc(D.proj.surtitre || 'Création de société')}</div><h1 style="margin-top:10px">Tableau de marche</h1>
      <p class="muted">${esc(M.intro || 'Les étapes dans l’ordre, les questions à trancher à chaque étape et la réponse attendue.')}</p></div>
      <a class="btn" href="#/schema"><i class="ph ph-graph"></i>Schéma du montage</a></div>
    ${D.proj.avertissement ? `<div class="notice light"><i class="ph ph-info"></i><span>${esc(D.proj.avertissement)}</span></div>` : ''}
    <div class="stepper-x">${M.phases.map((p, i) => `<a href="#ph-${i}" data-scroll="ph-${i}" class="sx ${i < cur ? 'done' : i === cur ? 'on' : ''}"><span class="sx-n">${i < cur ? '<i class="ph ph-check"></i>' : i + 1}</span><span class="sx-t">${esc(p.court || p.titre)}</span><span class="sx-d">${p.fin ? 'd’ici le ' + fmtDate(p.fin) : ''}</span><span class="sx-bar"><i style="width:${stats[i].pct}%"></i></span></a>`).join('')}</div>
    <div class="card now"><div class="row between"><div><div class="label">Maintenant · étape ${cur + 1}</div><h2 style="margin-top:6px">${esc(P.titre)}</h2></div><span class="tag accent">${stats[cur].done}/${stats[cur].n} traités</span></div>
      <div class="grid g2" style="margin-top:14px">
        <div><div class="label" style="margin-bottom:8px">Questions à trancher maintenant</div><div class="list">${ready.slice(0, 4).map((q) => small([q.id], 'question')).join('') || '<div class="muted small">Aucune question débloquée.</div>'}</div></div>
        <div><div class="label" style="margin-bottom:8px">Prochaines étapes</div><div class="list">${small([...nextJ.slice(0, 2), ...nextSteps.slice(0, 4)].map((i) => i.id), 'arrow-right')}</div></div>
      </div></div>
    ${M.phases.map((p, pi) => `<section class="phase ${pi < cur ? 'is-done' : pi === cur ? 'is-on' : ''}" id="ph-${pi}">
      <div class="ph-head"><span class="ph-n">${pi + 1}</span><div style="flex:1;min-width:0"><h2>${esc(p.titre)}</h2><div class="muted small" style="margin-top:4px">${esc(p.objectif || '')}</div></div>
        <div class="ph-meta">${p.fin ? `<span class="date-chip">d’ici le ${fmtDate(p.fin, true)}</span>` : ''}<div class="progress" style="width:120px;margin-top:8px"><i style="width:${stats[pi].pct}%"></i></div></div></div>
      ${p.resultat ? `<div class="ph-res"><i class="ph ph-flag-checkered"></i><span><b>Résultat attendu :</b> ${esc(p.resultat)}</span></div>` : ''}
      <div class="ph-grid">
        <div><div class="label" style="margin-bottom:10px">Questions à trancher, dans l’ordre</div><ol class="mqs">${(p.questions || []).map(qLine).join('') || '<div class="muted small">—</div>'}</ol></div>
        <div class="col" style="gap:18px">
          ${(p.jalons || []).length ? `<div><div class="label" style="margin-bottom:6px">Rendez-vous</div><div class="list">${small(p.jalons, 'flag-banner')}</div></div>` : ''}
          ${(p.etapes || []).length ? `<div><div class="label" style="margin-bottom:6px">Étapes</div><div class="list">${small(p.etapes, 'check-square')}</div></div>` : ''}
          ${(p.documents || []).length ? `<div><div class="label" style="margin-bottom:6px">Documents produits</div><div class="list">${small(p.documents, 'file-text')}</div></div>` : ''}
        </div>
      </div></section>`).join('')}`;
};

// ------------------------------------------------------------------ schéma
VIEWS.schema = async () => {
  const t = S.schemaTab;
  await Promise.all([document.fonts.load(FN_LABEL), document.fonts.load(FN_SUB), document.fonts.load(FN_EDGE)]).catch(() => {});
  return `<div class="page-head"><div><div class="label">Montage envisagé</div><h1 style="margin-top:10px">Schéma du montage</h1>
    <p class="muted">${t === 'structure' ? 'Qui détient quoi, qui fait quoi, qui paie qui : hypothèses de travail à discuter. Cliquez un bloc pour le détail, ou un type de flux dans la légende pour l’afficher ou le masquer.' : 'Tous les chantiers et leur avancement. Cliquez un chantier pour l’ouvrir.'}</p></div>
    <div class="tabs"><button data-tab="structure" class="${t === 'structure' ? 'on' : ''}">Montage complet</button><button data-tab="chantiers" class="${t === 'chantiers' ? 'on' : ''}">Carte des chantiers</button></div></div>
    ${t === 'structure' ? structureDiagram() : chantiersMap()}`;
};

// --- mesure de texte (cadres ajustés au contenu)
const MCTX = document.createElement('canvas').getContext('2d');
const FN_LABEL = "600 14px 'Space Grotesk'", FN_SUB = "500 10px 'JetBrains Mono'", FN_EDGE = "500 11px 'JetBrains Mono'";
function tw(text, font, ls = 0) { MCTX.font = font; return MCTX.measureText(String(text)).width + ls * String(text).length; }
function wrapText(text, font, max, ls = 0) {
  const words = nb(text || '').split(' '), lines = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (!cur || tw(t, font, ls) <= max) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  return lines;
}
const EDGE_COLOR = { capital: 'var(--text-2)', flow: 'var(--accent-line)', money: 'var(--amber)', service: 'var(--slate)', partner: 'var(--muted)' };
const EDGE_LEGEND = [['capital', 'Capital'], ['flow', 'Prestations aux clients'], ['money', 'Argent (salaire, commandes, financements)'], ['service', 'Travail fourni / sous-traitance'], ['partner', 'Réseau & partenariats']];

function layoutStructure(sch, W) {
  const mobile = W < 700;
  const maxText = mobile ? 140 : 200, icon = 46, gapX = mobile ? 12 : 30, gapY = mobile ? 78 : 96, margin = mobile ? 12 : 36, zonePad = 16, zoneTop = 34;
  const nodes = sch.nodes.map((n) => {
    const lab = wrapText(n.label, FN_LABEL, maxText), sub = n.sub ? wrapText(n.sub, FN_SUB, maxText, 0.6) : [];
    const partsW = (n.parts || []).reduce((s2, [a, b]) => s2 + tw(`${a} ${b}`, FN_SUB, 0.6) + 22, 0) + Math.max(0, (n.parts || []).length - 1) * 6;
    const textW = Math.max(...lab.map((l) => tw(l, FN_LABEL)), ...sub.map((l) => tw(l, FN_SUB, 0.6)), partsW);
    return { ...n, layer: n.layer ?? 0, lab, subL: sub, w: Math.ceil(icon + textW + 18), h: Math.max(58, 22 + lab.length * 18 + sub.length * 14 + (n.parts?.length ? 30 : 0)) };
  });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  // écart élargi entre deux voisins reliés latéralement (place pour l'étiquette)
  const sideGap = {};
  for (const e of sch.edges || []) { const a = byId[e.from], b = byId[e.to]; if (a && b && a.layer === b.layer && e.label) sideGap[[e.from, e.to].sort().join('|')] = tw(e.label, FN_EDGE) + 40; }
  const zones = sch.zones || [];
  let y = margin;
  for (const L of [...new Set(nodes.map((n) => n.layer))].sort((a, b) => a - b)) {
    const zone = zones.find((z) => z.layers.includes(L));
    if (zone && zone.layers[0] === L) y += zoneTop;
    const avail = W - 2 * margin - (zone ? 2 * zonePad : 0);
    const rows = [[]];
    let rw = 0;
    for (const n of nodes.filter((n) => n.layer === L)) {
      const r = rows.at(-1), prev = r.at(-1);
      const g = prev ? Math.max(gapX, sideGap[[prev.id, n.id].sort().join('|')] || 0) : 0;
      if (prev && rw + g + n.w > avail) { rows.push([n]); rw = n.w; n._g = 0; } else { r.push(n); rw += g + n.w; n._g = g; }
    }
    rows.forEach((r, ri) => {
      const total = r.reduce((s, n) => s + n.w + n._g, 0);
      let x = (W - total) / 2;
      const rh = Math.max(...r.map((n) => n.h));
      for (const n of r) { x += n._g; n.x = x + n.w / 2; n.y = y + rh / 2; x += n.w; }
      y += rh + (ri < rows.length - 1 ? (mobile ? 46 : 56) : 0);
    });
    y += zone && zone.layers.at(-1) === L ? zonePad + gapY : gapY;
  }
  const zb = zones.map((z) => {
    const zn = nodes.filter((n) => z.layers.includes(n.layer));
    if (!zn.length) return null;
    const x0 = Math.min(...zn.map((n) => n.x - n.w / 2)) - zonePad, x1 = Math.max(...zn.map((n) => n.x + n.w / 2)) + zonePad;
    const y0 = Math.min(...zn.map((n) => n.y - n.h / 2)) - zoneTop + 4, y1 = Math.max(...zn.map((n) => n.y + n.h / 2)) + zonePad;
    const lw = tw(z.label.toUpperCase(), FN_EDGE, 1.5) + 36;
    const w = Math.max(x1 - x0, lw);
    return { ...z, x: (x0 + x1) / 2 - w / 2, y: y0, w, h: y1 - y0 };
  }).filter(Boolean);
  return { nodes, byId, zones: zb, W, H: y - gapY + margin };
}

function routeEdges(sch, L) {
  const Z = Object.fromEntries(L.zones.map((z) => [z.id, z]));
  const edges = (sch.edges || []).map((e, idx) => {
    const a = L.byId[e.from];
    const isZ = e.to.startsWith('zone:');
    const zz = isZ ? Z[e.to.slice(5)] : null;
    const b = isZ ? (zz && { x: zz.x + zz.w / 2, y: zz.y + zz.h / 2, w: zz.w, h: zz.h, zone: zz }) : L.byId[e.to];
    if (!a || !b) return null;
    const mode = isZ ? 'zone' : Math.abs(a.y - b.y) < 8 ? 'side' : b.y > a.y ? 'down' : 'up';
    return { ...e, idx, a, b, mode };
  }).filter(Boolean);
  // points d'ancrage répartis par côté de cadre (haut / bas), entrées et sorties confondues
  const ends = {};
  for (const e of edges.filter((e) => e.mode === 'down' || e.mode === 'up')) {
    (ends[e.from + (e.mode === 'down' ? ':b' : ':t')] ??= []).push({ e, n: e.a, o: e.b, prop: 'sx' });
    (ends[e.to + (e.mode === 'down' ? ':t' : ':b')] ??= []).push({ e, n: e.b, o: e.a, prop: 'tx' });
  }
  for (const g of Object.values(ends)) {
    g.sort((p, q) => p.o.x - q.o.x);
    g.forEach((p, i) => { const span = Math.min(p.n.w * 0.6, 46 * (g.length - 1)); p.e[p.prop] = p.n.x + (g.length > 1 ? (i / (g.length - 1) - 0.5) * span : 0); });
  }
  for (const e of edges) {
    const { a, b } = e;
    if (e.mode === 'down') { e.p = [e.sx, a.y + a.h / 2, e.tx, b.y - b.h / 2]; const d = (e.p[3] - e.p[1]) / 2; e.c = [e.p[0], e.p[1] + d, e.p[2], e.p[3] - d]; }
    else if (e.mode === 'up') { e.p = [e.sx, a.y - a.h / 2, e.tx, b.y + b.h / 2]; const d = (e.p[1] - e.p[3]) / 2; e.c = [e.p[0], e.p[1] - d, e.p[2], e.p[3] + d]; }
    else if (e.mode === 'side') { const r = b.x > a.x ? 1 : -1; e.p = [a.x + r * a.w / 2, a.y, b.x - r * b.w / 2, b.y]; e.c = [e.p[0], e.p[1], e.p[2], e.p[3]]; }
    else { // vers une zone : boucle par le côté droit si la place existe, sinon arrive par le bas de la zone
      const z = b.zone, outL = z.x - 60, outR = z.x + z.w + 60;
      if (outL > 8) { const ty = z.y + z.h * 0.6; e.p = [a.x - a.w / 2 + 14, a.y - a.h / 2, z.x, ty]; e.c = [e.p[0] - 30, e.p[1] - 70, outL, ty]; e.side = true; }
      else if (outR < L.W - 8) { const ty = z.y + z.h * 0.6; e.p = [a.x + a.w / 2 - 14, a.y - a.h / 2, z.x + z.w, ty]; e.c = [e.p[0] + 30, e.p[1] - 70, outR, ty]; e.side = true; }
      else { e.p = [a.x + a.w / 2 - 18, a.y - a.h / 2, Math.min(z.x + z.w - 36, a.x + a.w / 2 + 120), z.y + z.h]; const d = (e.p[1] - e.p[3]) / 2; e.c = [e.p[0], e.p[1] - d, e.p[2], e.p[3] + d]; }
    }
  }
  // étiquettes : premier emplacement libre le long de la courbe
  const boxes = L.nodes.map((n) => [n.x - n.w / 2 - 4, n.y - n.h / 2 - 4, n.x + n.w / 2 + 4, n.y + n.h / 2 + 4]);
  const hit = (r) => boxes.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
  const bez = (e, t) => { const [x0, y0, x3, y3] = e.p, [x1, y1, x2, y2] = e.c, u = 1 - t; return [u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]; };
  for (const e of edges.filter((e) => e.label)) {
    const w = tw(e.label, FN_EDGE) + 18, h = 22;
    let best = null;
    for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
      const [x, y] = bez(e, t), r = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (!hit(r)) { best = r; break; }
      best ??= r;
    }
    boxes.push(best);
    e.lb = { x: (best[0] + best[2]) / 2, y: (best[1] + best[3]) / 2, w, h };
  }
  // intitulés de zones : coin haut gauche ou haut droit, le moins traversé
  for (const z of L.zones) {
    const lw = tw(z.label.toUpperCase(), FN_EDGE, 1.5) + 12;
    const cand = [{ x: z.x + 18, anchor: 'start', r: [z.x + 12, z.y + 4, z.x + 18 + lw, z.y + 30] }, { x: z.x + z.w - 18, anchor: 'end', r: [z.x + z.w - 18 - lw, z.y + 4, z.x + z.w - 12, z.y + 30] }];
    const cost = (r) => edges.reduce((n, e) => { for (let t = 0; t <= 1; t += 0.01) { const [x, y] = bez(e, t); if (x > r[0] - 8 && x < r[2] + 8 && y > r[1] - 6 && y < r[3] + 6) n++; } return n; }, 0) + boxes.filter((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]).length * 5;
    z.lab = cand.sort((p, q) => cost(p.r) - cost(q.r))[0];
    if (z.note) { // pastille posée sur le bord haut ou bas du cadre, là où rien ne passe
      const nw = tw(z.note, FN_EDGE) + 30, opts = [];
      for (const yy of [z.y + z.h, z.y]) for (let x = z.x + 16; x + nw <= z.x + z.w - 16; x += 12) opts.push([x, yy - 11, x + nw, yy + 11]);
      const lr = z.lab.r;
      const c2 = (r) => cost(r) * 3 + ((r[0] < lr[2] && r[2] > lr[0] && r[1] < lr[3] && r[3] > lr[1]) ? 50 : 0);
      z.noteBox = opts.sort((p, q) => c2(p) - c2(q) || p[0] - q[0])[0] || [z.x + 16, z.y + z.h - 11, z.x + 16 + nw, z.y + z.h + 11];
    }
  }
  return edges;
}

function structureDiagram() {
  const sch = D.settings.structure;
  if (!sch?.nodes?.length) return `<div class="empty">Aucun schéma défini. ${D.me.is_admin ? 'Ajoutez-le dans « Équipe & accès ».' : ''}</div>`;
  const avail = Math.max(320, ($('#view')?.clientWidth || innerWidth) - 4);
  if (avail < 700) return structureList(sch);
  const W = avail >= 900 ? 1200 : Math.round(avail);
  const schF = { ...sch, edges: (sch.edges || []).filter((e) => !S.hide.has(e.type)) };
  const L = layoutStructure(schF, W), E = routeEdges(schF, L), mobile = W < 700;
  const markers = Object.entries(EDGE_COLOR).map(([k, c]) => `<marker id="arr-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join('');
  const zones = L.zones.map((z) => `<g><rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="22" fill="var(--zone)" stroke="var(--border-strong)" stroke-dasharray="4 6"/><text x="${z.lab?.x ?? z.x + 18}" y="${z.y + 22}" text-anchor="${z.lab?.anchor || 'start'}" class="dg-label" style="text-transform:uppercase;letter-spacing:.14em;fill:var(--muted)">${esc(z.label)}</text>${z.noteBox ? `<g><rect x="${z.noteBox[0]}" y="${z.noteBox[1]}" width="${z.noteBox[2] - z.noteBox[0]}" height="22" rx="11" fill="var(--card)" stroke="${EDGE_COLOR[z.noteType] || 'var(--amber)'}"/><text x="${z.noteBox[0] + 12}" y="${z.noteBox[1] + 15}" class="dg-label" style="fill:var(--text-2)">↻ ${esc(z.note)}</text></g>` : ''}</g>`).join('');
  const edges = E.map((e) => `<g data-edge="${e.idx}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><path class="dg-edge ${e.type !== 'capital' ? 'flow' : ''}" d="M${e.p[0]},${e.p[1]} C${e.c[0]},${e.c[1]} ${e.c[2]},${e.c[3]} ${e.p[2]},${e.p[3]}" style="stroke:${EDGE_COLOR[e.type] || 'var(--border-strong)'}" marker-end="url(#arr-${e.type})"/></g>`).join('');
  const labels = E.filter((e) => e.lb).map((e) => `<g class="dg-lab" data-edge-label="${e.idx}"><rect class="dg-label-bg" x="${e.lb.x - e.lb.w / 2}" y="${e.lb.y - e.lb.h / 2}" width="${e.lb.w}" height="${e.lb.h}" rx="11" style="stroke:${EDGE_COLOR[e.type]}"/><text class="dg-label" x="${e.lb.x}" y="${e.lb.y + 4}" text-anchor="middle">${esc(e.label)}</text></g>`).join('');
  const ST = { newco: ['#0A0A0A', '#FAFAFA', 'var(--accent)', 'var(--accent)', '#0A0A0A'], company: ['var(--card)', 'var(--text)', 'var(--border-strong)', 'var(--bg-2)', 'var(--text-2)'], person: ['var(--card)', 'var(--text)', 'var(--border-strong)', 'var(--bg-2)', 'var(--text-2)'], offer: ['var(--accent-soft)', 'var(--text)', 'var(--accent-line)', 'var(--accent)', '#0A0A0A'], partner: ['var(--bg-2)', 'var(--text)', 'var(--border-strong)', 'var(--card)', 'var(--text-2)'], client: ['var(--card)', 'var(--text)', 'var(--border-strong)', 'var(--bg-2)', 'var(--text-2)'] };
  const nodes = L.nodes.map((n) => {
    const [fill, txt, stroke, icBg, icFg] = ST[n.kind] || ST.company;
    const x = n.x - n.w / 2, y = n.y - n.h / 2;
    const th = n.lab.length * 18 + n.subL.length * 14 + (n.parts?.length ? 30 : 0);
    let ty = n.y - th / 2 + 13;
    const t1 = n.lab.map((l) => { const s = `<text x="${x + 50}" y="${ty}" style="font:${FN_LABEL};fill:${txt}">${esc(l)}</text>`; ty += 18; return s; }).join('');
    ty -= 2;
    const t2 = n.subL.map((l) => { const s = `<text x="${x + 50}" y="${ty}" style="font:${FN_SUB};letter-spacing:.06em;fill:${n.kind === 'newco' ? 'var(--accent)' : 'var(--muted)'}">${esc(l)}</text>`; ty += 14; return s; }).join('');
    return `<g class="dg-node" data-node="${esc(n.id)}">${n.kind === 'newco' ? `<rect class="pulse-r" x="${x - 6}" y="${y - 6}" width="${n.w + 12}" height="${n.h + 12}" rx="22" fill="none" stroke="var(--accent)" stroke-width="2"/>` : ''}
      <rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="${n.kind === 'person' ? Math.min(28, n.h / 2) : 16}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${n.kind === 'partner' ? 'stroke-dasharray="5 4"' : ''}/>
      <foreignObject x="${x + 10}" y="${n.y - 16}" width="32" height="32"><div xmlns="http://www.w3.org/1999/xhtml" style="width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:${icBg};color:${icFg};font-size:17px"><i class="ph ph-${esc(n.icon || (n.kind === 'person' ? 'user' : 'buildings'))}"></i></div></foreignObject>
      ${t1}${t2}${(() => { if (!n.parts?.length) return ''; let px = x + 50; const py = ty - 6; return n.parts.map(([a, b]) => { const w = tw(`${a} ${b}`, FN_SUB, 0.6) + 22; const g = `<rect x="${px}" y="${py}" width="${w}" height="22" rx="11" fill="var(--bg-2)" stroke="var(--border-strong)"/><text x="${px + 11}" y="${py + 15}" style="font:${FN_SUB};letter-spacing:.06em;fill:var(--text)"><tspan style="font-weight:600">${esc(a)}</tspan> ${esc(b)}</text>`; px += w + 6; return g; }).join(''); })()}</g>`;
  }).join('');
  return `<div class="diagram-wrap ${mobile ? 'mobile' : ''}" id="dg"><div class="bg-grid"></div>
    ${mobile ? '' : `<div class="dg-tools"><button class="btn icon sm" data-zoom="1.2" title="Dézoomer"><i class="ph ph-minus"></i></button><button class="btn icon sm" data-zoom="0.83" title="Zoomer"><i class="ph ph-plus"></i></button><button class="btn icon sm" data-zoom="0" title="Recentrer"><i class="ph ph-arrows-in"></i></button></div>`}
    <svg id="dgsvg" viewBox="${(!mobile && S.zoom) || `0 0 ${L.W} ${L.H}`}" data-vb="0 0 ${L.W} ${L.H}" data-pan="${mobile ? 0 : 1}"><defs>${markers}</defs>${zones}${edges}${labels}${nodes}</svg>
    <div id="dgpanel"></div>
    <div class="legend">${EDGE_LEGEND.map(([k, l]) => `<button class="lg ${S.hide.has(k) ? 'off' : ''}" data-etype="${k}" title="Afficher / masquer"><i class="sw" style="background:${EDGE_COLOR[k]}"></i>${l}</button>`).join('')}<span class="muted"><i class="ph ph-question"></i> « ? » = hypothèse à discuter</span></div>
  </div>`;
}
// version mobile : sections empilées, relations écrites dans chaque carte
function structureList(sch) {
  const layers = [...new Set(sch.nodes.map((n) => n.layer ?? 0))].sort((a, b) => a - b);
  const name = (id) => id.startsWith('zone:') ? (sch.zones || []).find((z) => 'zone:' + z.id === id)?.label : sch.nodes.find((n) => n.id === id)?.label || id;
  const zoneOf = (n) => (sch.zones || []).find((z) => z.layers.includes(n.layer ?? 0));
  const rel = (n) => (sch.edges || []).filter((e) => e.from === n.id || e.to === n.id || (e.to.startsWith('zone:') && zoneOf(n) && e.to === 'zone:' + zoneOf(n).id));
  const card = (n) => `<div class="sl-card ${n.kind}" data-slnode="${esc(n.id)}">
      <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span class="sl-ico"><i class="ph ph-${esc(n.icon || 'circle')}"></i></span>
      <div style="min-width:0"><div class="sl-t">${esc(n.label)}</div>${n.sub ? `<div class="sl-s">${esc(n.sub)}</div>` : ''}</div></div>
      ${n.parts?.length ? `<div class="sl-rel">${n.parts.map(([a, b]) => `<span class="sl-chip"><b>${esc(a)}</b> ${esc(b)}</span>`).join('')}</div>` : ''}
      ${n.desc ? `<div class="md small sl-d">${md(n.desc)}</div>` : ''}
      ${rel(n).length ? `<div class="sl-rel">${rel(n).map((e) => { const out = e.from === n.id; return `<span class="sl-chip"><i class="sw" style="background:${EDGE_COLOR[e.type]}"></i>${out ? '→' : '←'} ${esc(name(out ? e.to : e.from))}${e.label ? ` · <b>${esc(e.label)}</b>` : ''}</span>`; }).join('')}</div>` : ''}
    </div>`;
  const titles = sch.layerLabels || [];
  return `<div class="sl">${layers.map((L, i) => `${i ? '<div class="sl-arrow"><i class="ph ph-arrow-down"></i></div>' : ''}<section class="sl-sec"><div class="label" style="margin-bottom:10px">${esc(titles[L] || zoneOf({ layer: L })?.label || '')}</div>${zoneOf({ layer: L })?.note ? `<div class="sl-chip" style="margin-bottom:10px"><i class="sw" style="background:${EDGE_COLOR[zoneOf({ layer: L }).noteType] || 'var(--amber)'}"></i>↻ ${esc(zoneOf({ layer: L }).note)}</div>` : ''}<div class="col">${sch.nodes.filter((n) => (n.layer ?? 0) === L).map(card).join('')}</div></section>`).join('')}
    <div class="legend" style="border:0;padding:16px 0 0">${EDGE_LEGEND.map(([k, l]) => `<span><i class="sw" style="background:${EDGE_COLOR[k]}"></i>${l}</span>`).join('')}<span class="muted">« ? » = hypothèse à discuter</span></div></div>`;
}
function nodePanel(id) {
  const sch = D.settings.structure, n = sch.nodes.find((x) => x.id === id);
  if (!n) return '';
  const rel = (sch.edges || []).filter((e) => e.from === id || e.to === id);
  const name = (nid) => nid.startsWith('zone:') ? (sch.zones || []).find((z) => 'zone:' + z.id === nid)?.label : sch.nodes.find((x) => x.id === nid)?.label || nid;
  const linked = D.items.filter((i) => (n.workstreams || []).includes(i.workstream) && !isDone(i) && (i.kind === 'decision' || i.kind === 'topic')).slice(0, 8);
  return `<div class="panel"><div class="row between"><span class="label">${esc(n.sub || n.kind)}</span><button class="btn icon sm ghost" data-act="close-panel"><i class="ph ph-x"></i></button></div>
    <h2 style="margin:8px 0 10px">${esc(n.label)}</h2><div class="md small">${md(n.desc || '')}</div>
    ${rel.length ? `<div class="label" style="margin:14px 0 8px">Relations</div>${rel.map((e) => `<div class="small" style="margin-bottom:6px"><i class="ph ph-arrow-${e.from === id ? 'right' : 'left'}"></i> ${esc(name(e.from === id ? e.to : e.from))} <span class="muted">${e.label ? '— ' + esc(e.label) : ''}</span></div>`).join('')}` : ''}
    ${linked.length ? `<div class="label" style="margin:14px 0 4px">Questions ouvertes liées</div><div class="list">${linked.map((i) => itemRow(i, { noWs: true })).join('')}</div>` : ''}
  </div>`;
}
function bindDiagram() {
  const svg = $('#dgsvg');
  if (!svg) return;
  const wrap = $('#dg');
  const select = (id) => {
    wrap.classList.toggle('dimmed', !!id);
    $$('.dg-node', svg).forEach((g) => g.classList.toggle('on', g.dataset.node === id));
    const nb = new Set(), labs = new Set();
    $$('[data-edge]', svg).forEach((g) => { const on = id && (g.dataset.from === id || g.dataset.to === id); $('path', g).classList.toggle('hl', !!on); if (on) { nb.add(g.dataset.from); nb.add(g.dataset.to); labs.add(g.dataset.edge); } });
    $$('.dg-lab', svg).forEach((g) => g.classList.toggle('on', labs.has(g.dataset.edgeLabel)));
    $$('.dg-node', svg).forEach((g) => g.classList.toggle('nb', nb.has(g.dataset.node)));
    $('#dgpanel').innerHTML = id ? nodePanel(id) : '';
    if (id && wrap.classList.contains('mobile')) $('#dgpanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  let start = null, moved = false;
  svg.addEventListener('click', (e) => { const g = e.target.closest('.dg-node'); if (!moved) select(g ? g.dataset.node : null); });
  if (svg.dataset.pan !== '1') return;
  const vb = () => svg.getAttribute('viewBox').split(/\s+/).map(Number);
  svg.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, vb: vb() }; moved = false; });
  window.onpointermove = (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    const k = start.vb[2] / svg.clientWidth;
    S.zoom = [start.vb[0] - dx * k, start.vb[1] - dy * k, start.vb[2], start.vb[3]].join(' ');
    svg.setAttribute('viewBox', S.zoom);
  };
  window.onpointerup = () => { start = null; setTimeout(() => (moved = false), 0); };
  $$('[data-zoom]', wrap).forEach((b) => b.onclick = () => {
    const f = +b.dataset.zoom;
    if (!f) { S.zoom = null; svg.setAttribute('viewBox', svg.dataset.vb); return; }
    const [x, y, w, h] = vb();
    S.zoom = [x + (w - w * f) / 2, y + (h - h * f) / 2, w * f, h * f].join(' ');
    svg.setAttribute('viewBox', S.zoom);
  });
}

function chantiersMap() {
  const avail = ($('#view')?.clientWidth || innerWidth);
  if (avail < 700) return `<div class="grid auto">${D.workstreams.map(wsCard).join('')}</div>`;
  const W = 1200, H = 840, cx = W / 2, cy = 410, rx = 440, ry = 285;
  const ws = D.workstreams, n = ws.length || 1;
  const nodes = ws.map((w, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
    const s = wsStats(w.id), c = D.w[w.id].color, r = 40, circ = 2 * Math.PI * (r + 7);
    const openN = s.its.filter((i) => !isDone(i)).length;
    const qN = s.its.filter((i) => i.kind === 'decision' && !isDone(i)).length;
    const lines = wrapText(w.title, FN_LABEL, 170);
    return { w, x, y, svg: `<a href="#/chantier/${w.id}" class="dg-node">
      <circle cx="${x}" cy="${y}" r="${r + 7}" fill="none" stroke="var(--bg-2)" stroke-width="5"/>
      ${s.pct ? `<circle cx="${x}" cy="${y}" r="${r + 7}" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(circ * s.pct) / 100} ${circ}" transform="rotate(-90 ${x} ${y})"/>` : ''}
      <circle class="body" cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="var(--border)"/>
      <foreignObject x="${x - 18}" y="${y - 25}" width="36" height="34"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:24px;color:${D.w[w.id].fg};text-align:center;line-height:34px"><i class="ph ph-${esc(w.icon || 'circle')}"></i></div></foreignObject>
      <text x="${x}" y="${y + 21}" text-anchor="middle" style="font:600 11px var(--font-mono);fill:${D.w[w.id].fg}">${s.pct}%</text>
      ${lines.map((l, i) => `<text x="${x}" y="${y + r + 26 + i * 17}" text-anchor="middle" style="font:600 14px var(--font-display);fill:var(--text)">${esc(l)}</text>`).join('')}
      <text x="${x}" y="${y + r + 26 + lines.length * 17}" text-anchor="middle" class="dg-label">${openN} ouverts${qN ? ` · ${qN} question${qN > 1 ? 's' : ''}` : ''}</text>
    </a>` };
  });
  const lines = nodes.map((p) => `<path class="dg-edge flow" d="M${cx},${cy} Q${(cx + p.x) / 2},${(cy + p.y) / 2 - 30} ${p.x},${p.y}" style="stroke:var(--border-strong)"/>`).join('');
  const all = D.items.length, done = D.items.filter(isDone).length;
  return `<div class="diagram-wrap"><div class="bg-grid"></div><svg viewBox="0 0 ${W} ${H}">
    ${lines}
    <circle class="pulse" cx="${cx}" cy="${cy}" r="70" fill="var(--accent)" opacity=".35"/>
    <circle cx="${cx}" cy="${cy}" r="78" fill="#0A0A0A" stroke="var(--accent)" stroke-width="2"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" style="font:700 19px var(--font-display);fill:#FAFAFA">${esc(D.proj.nom_court || D.proj.nom || 'NewCo')}</text>
    <text x="${cx}" y="${cy + 20}" text-anchor="middle" style="font:500 11px var(--font-mono);fill:var(--accent);letter-spacing:.1em">${done}/${all} traités</text>
    ${nodes.map((p) => p.svg).join('')}
  </svg></div>`;
}

// ------------------------------------------------------------------ feuille de route
VIEWS['feuille-de-route'] = () => {
  const mode = S.roadmapMode || (innerWidth < 860 ? 'liste' : 'gantt');
  const f = S.filters.rm || {};
  const its = D.items.filter((i) => (i.start_date || i.due_date || i.decision_date || i.effective_date) && (!f.owner || i.owner === f.owner) && (!f.kind || i.kind === f.kind) && (f.done || !isDone(i)));
  return `<div class="page-head"><div><div class="label">Toujours à jour</div><h1 style="margin-top:10px">Feuille de route</h1>
    <p class="muted">Générée en direct à partir des dates indicatives de chaque élément. Calendrier de travail, à ajuster ensemble.</p></div>
    <div class="row"><div class="tabs"><button data-rm="gantt" class="${mode === 'gantt' ? 'on' : ''}">Gantt</button><button data-rm="liste" class="${mode === 'liste' ? 'on' : ''}">Chronologie</button></div>
    <button class="btn" data-act="export-rm"><i class="ph ph-download-simple"></i>Markdown</button><button class="btn hide-sm" data-act="print"><i class="ph ph-printer"></i>Imprimer</button></div></div>
    <div class="filters">
      ${ownerChips('rm')}
      <select class="input inline" data-filter="rm.kind"><option value="">Tous types</option>${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${v.plural}</option>`).join('')}</select>
      <button class="chip plain ${f.done ? 'on' : ''}" data-toggle="rm.done">Inclure les éléments terminés</button>
    </div>
    ${its.length ? (mode === 'gantt' ? gantt(its) : chrono(its)) : '<div class="empty">Aucun élément daté avec ces filtres</div>'}
    <div class="legend" style="border:0;padding:14px 0"><span><i class="g-mark diamond" style="position:static;display:inline-block;background:var(--amber);margin:0"></i> À discuter</span><span><i class="g-mark" style="position:static;display:inline-block;background:var(--text-2);border-radius:3px;margin:0"></i> Échéance envisagée</span><span><i class="g-mark circle" style="position:static;display:inline-block;background:var(--accent);margin:0"></i> Prise d’effet</span><span><i class="sw" style="background:var(--slate);height:8px;width:28px"></i> Période envisagée</span></div>`;
};
function ownerChips(scope) {
  const cur = S.filters[scope]?.owner;
  return `<button class="chip plain ${!cur ? 'on' : ''}" data-owner="${scope}:">Tous</button>` + D.users.map((u) => `<button class="chip ${cur === u.id ? 'on' : ''}" data-owner="${scope}:${u.id}">${av(u.id)}${esc(u.name.split(' ')[0])}</button>`).join('');
}
function gantt(its) {
  const dates = its.flatMap((i) => [i.start_date, i.due_date, i.decision_date, i.effective_date]).filter(Boolean).concat(today()).sort();
  const s0 = new Date(dates[0].slice(0, 7) + '-01'), e0 = new Date(dates.at(-1).slice(0, 7) + '-01');
  e0.setMonth(e0.getMonth() + 1);
  const months = [];
  for (const d = new Date(s0); d < e0; d.setMonth(d.getMonth() + 1)) months.push(new Date(d));
  const t0 = s0.getTime(), span = e0.getTime() - t0;
  const pos = (d) => `calc(260px + (100% - 260px) * ${((new Date(d + 'T12:00:00').getTime() - t0) / span).toFixed(5)})`;
  const groups = D.workstreams.map((w) => [w, its.filter((i) => i.workstream === w.id)]).concat([[{ id: '', title: 'Sans chantier', color: '#A3A3A3' }, its.filter((i) => !D.w[i.workstream])]]).filter(([, l]) => l.length);
  const grid = months.map((m) => `<div class="g-grid" style="left:${pos(m.toISOString().slice(0, 10))}"></div>`).join('');
  const rows = groups.map(([w, l]) => {
    const c = D.w[w.id]?.color || w.color;
    return `<div class="g-group"><span class="dot" style="width:9px;height:9px;border-radius:50%;background:${c}"></span>${esc(w.title)}<span class="label">${l.length}</span></div>` +
      l.sort((a, b) => keyDate(a).localeCompare(keyDate(b))).map((i) => {
        let h = '';
        const end = i.due_date || i.effective_date;
        if (i.start_date && end && end > i.start_date) h += `<div class="g-bar" data-open="${i.id}" title="${esc(i.title)}" style="left:${pos(i.start_date)};width:calc(${pos(end)} - ${pos(i.start_date)});background:${c};opacity:${isDone(i) ? .35 : .8}"></div>`;
        if (i.decision_date) h += `<div class="g-mark diamond" data-open="${i.id}" title="À discuter d’ici le ${fmtDate(i.decision_date)}" style="left:${pos(i.decision_date)};background:var(--amber)"></div>`;
        if (i.due_date) h += `<div class="g-mark" data-open="${i.id}" title="Échéance ${fmtDate(i.due_date)}" style="left:${pos(i.due_date)};background:${i.start_date ? 'var(--text-2)' : c};border-radius:4px"></div>`;
        if (i.effective_date) h += `<div class="g-mark circle" data-open="${i.id}" title="Prise d’effet envisagée ${fmtDate(i.effective_date)}" style="left:${pos(i.effective_date)};background:var(--accent);border:2px solid var(--card)"></div>`;
        return `<div class="g-row"><div class="g-name" data-open="${i.id}">${kindIcon(i.kind)}<span style="overflow:hidden;text-overflow:ellipsis">${esc(i.title)}</span><span style="margin-left:auto">${ownerAv(i)}</span></div>${h}</div>`;
      }).join('');
  }).join('');
  return `<div class="gantt"><div class="gantt-inner">
    <div class="g-head" style="grid-template-columns:260px repeat(${months.length},1fr)"><div style="border:0">Élément</div>${months.map((m) => `<div>${m.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}</div>`).join('')}</div>
    <div style="position:relative">${grid}<div class="g-today" style="left:${pos(today())}"></div>${rows}</div>
  </div></div>`;
}
function chrono(its) {
  const ev = [];
  for (const i of its) for (const [f, l] of [['decision_date', 'À discuter'], ['due_date', 'Échéance envisagée'], ['effective_date', 'Prise d’effet'], ['start_date', 'Début']]) if (i[f]) ev.push({ d: i[f], l, i });
  ev.sort((a, b) => a.d.localeCompare(b.d));
  let cur = '', out = '';
  for (const e of ev) {
    const m = e.d.slice(0, 7);
    if (m !== cur) { cur = m; out += `<h2 class="tl-month">${new Date(m + '-01T12:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</h2>`; }
    out += `<div class="tl-item"><div class="card hover" data-open="${e.i.id}" style="padding:14px 16px"><div class="row between"><span class="label">${fmtDate(e.d, true)} · ${e.l}</span>${st(e.i.status)}</div>
      <div class="row" style="margin-top:8px"><span class="muted">${kindIcon(e.i.kind)}</span><span style="flex:1;color:var(--text);font-weight:500">${esc(e.i.title)}</span>${ownerAv(e.i)}</div><div style="margin-top:8px">${wsTag(e.i.workstream)}</div></div></div>`;
  }
  return `<div class="timeline">${out}</div>`;
}

// ------------------------------------------------------------------ tâches (kanban)
VIEWS.taches = () => {
  const f = S.filters.t || {};
  const its = items({ kind: 'task', owner: f.owner, ws: f.ws });
  const cols = D.kinds.task.statuses;
  return `<div class="page-head"><div><div class="label">Plan de travail</div><h1 style="margin-top:10px">Étapes</h1><p class="muted">Les étapes à instruire, chacune avec un référent pressenti. Glissez une carte pour changer son statut.</p></div>
    <button class="btn primary" data-act="new" data-kind="task"><i class="ph ph-plus"></i>Nouvelle étape</button></div>
    <div class="filters">${ownerChips('t')}${wsSelect('t')}</div>
    <div class="tabs ktabs">${cols.map((c) => `<button data-kcol="${c}" class="${(S.kcol || cols[0]) === c ? 'on' : ''}">${ST_LABEL[c]} · ${its.filter((i) => i.status === c).length}</button>`).join('')}</div>
    <div class="kanban">${cols.map((c) => {
      const l = its.filter((i) => i.status === c).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));
      return `<div class="kcol ${(S.kcol || cols[0]) === c ? 'on' : ''}" data-col="${c}"><h3>${st(c)}<span class="label">${l.length}</span></h3>${l.map((i) => `<div class="kcard" draggable="true" data-drag="${i.id}" data-open="${i.id}">
        <div class="row" style="align-items:flex-start;flex-wrap:nowrap"><span class="ws-bar" style="background:${D.w[i.workstream]?.color || 'var(--border)'}"></span><div class="t" style="flex:1">${i.priority === 'haute' ? '<i class="ph ph-arrow-fat-up prio-haute"></i> ' : ''}${esc(i.title)}</div></div>
        <div class="row between"><span class="small muted">${esc(D.w[i.workstream]?.title || '')}</span><span class="row" style="gap:6px">${lock(i)}${i.n_comments ? `<span class="small muted"><i class="ph ph-chat-circle"></i>${i.n_comments}</span>` : ''}${dateChip(i.due_date, isDone(i))}${ownerAv(i)}</span></div>
      </div>`).join('')}</div>`;
    }).join('')}</div>`;
};
function wsSelect(scope) {
  const cur = S.filters[scope]?.ws || '';
  return `<select class="input inline" data-filter="${scope}.ws"><option value="">Tous les chantiers</option>${D.workstreams.map((w) => `<option value="${w.id}" ${cur === w.id ? 'selected' : ''}>${esc(w.title)}</option>`).join('')}</select>`;
}
function bindKanban() {
  $$('[data-drag]').forEach((c) => {
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.drag); c.classList.add('dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
  });
  $$('[data-col]').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const id = +e.dataTransfer.getData('text/plain');
      if (!id || D.i[id].status === col.dataset.col) return;
      D.i[id].status = col.dataset.col; render();
      await api(`/api/items/${id}`, { method: 'PUT', body: { status: col.dataset.col } });
      await load(); render();
    });
  });
}

// ------------------------------------------------------------------ décisions & sujets
VIEWS.decisions = () => {
  const f = S.filters.d || {};
  const dec = items({ kind: 'decision', ws: f.ws, owner: f.owner }).sort((a, b) => (isDone(a) - isDone(b)) || (a.decision_date || '9').localeCompare(b.decision_date || '9'));
  const top = items({ kind: 'topic', ws: f.ws, owner: f.owner });
  return `<div class="page-head"><div><div class="label">À discuter ensemble</div><h1 style="margin-top:10px">Questions ouvertes</h1><p class="muted">Les questions à trancher ensemble, avec les pistes évoquées et un calendrier indicatif. Rien n’est acté sans l’accord de tous.</p></div>
    <div class="row"><button class="btn primary" data-act="new" data-kind="decision"><i class="ph ph-plus"></i>Nouvelle question</button><button class="btn" data-act="new" data-kind="topic"><i class="ph ph-plus"></i>Sujet</button></div></div>
    <div class="filters">${ownerChips('d')}${wsSelect('d')}</div>
    <div class="grid g2">${dec.map((i) => `<div class="card hover" data-open="${i.id}" style="${isDone(i) ? 'opacity:.7' : ''}">
      <div class="row between">${wsTag(i.workstream)}${st(i.status)}</div>
      <h3 style="margin:14px 0 10px;font-size:1.15rem">${esc(i.title)}</h3>
      ${i.outcome ? `<div class="md small" style="padding:10px 12px;border-radius:12px;background:var(--accent-soft);margin-bottom:10px"><b>Position commune :</b> ${md(i.outcome)}</div>` : i.options ? `<div class="md small muted" style="max-height:7.5em;overflow:hidden">${md(i.options)}</div>` : ''}
      <div class="row" style="margin-top:12px">${i.decision_date ? `<span class="label">À discuter d’ici</span>${dateChip(i.decision_date, isDone(i))}` : ''}${i.effective_date ? `<span class="label">Effet</span><span class="date-chip">${fmtDate(i.effective_date)}</span>` : ''}<span class="spacer"></span>${ownerAv(i)}</div>
    </div>`).join('') || '<div class="empty">Aucune question</div>'}</div>
    <div class="section card"><div class="section-head"><h2>Sujets en discussion</h2><span class="label">${top.length}</span></div><div class="list">${top.map((i) => itemRow(i)).join('') || '<div class="empty">Aucun sujet</div>'}</div></div>`;
};

// ------------------------------------------------------------------ documents
const fileIcon = (i) => i.file_type?.includes('pdf') ? 'file-pdf' : i.file_type?.startsWith('image') ? 'file-image' : /docs\.google|document/.test(i.url || '') ? 'file-doc' : /sheet|xls/.test(i.url || i.file_name || '') ? 'file-xls' : i.url || i.file_key ? 'file-text' : 'file-dashed';
VIEWS.documents = () => {
  const sts = D.kinds.document.statuses;
  const all = items({ kind: 'document', ws: S.filters.doc?.ws });
  const l = S.docStatus ? all.filter((i) => i.status === S.docStatus) : all;
  return `<div class="page-head"><div><div class="label">Base documentaire</div><h1 style="margin-top:10px">Documents</h1><p class="muted">Documents produits et à produire : statuts, pièces jointes, liens Drive et aperçu intégré.</p></div>
    <button class="btn primary" data-act="new" data-kind="document"><i class="ph ph-plus"></i>Nouveau document</button></div>
    <div class="stepper">${sts.map((s) => `<button data-docst="${s}" class="${S.docStatus === s ? 'on' : ''}"><b>${all.filter((i) => i.status === s).length}</b>${st(s)}</button>`).join('')}</div>
    <div class="filters">${wsSelect('doc')}${S.docStatus ? `<button class="chip plain" data-docst="">Tous les statuts <i class="ph ph-x"></i></button>` : ''}</div>
    <div class="grid auto">${l.sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9')).map((i) => `<div class="card hover" data-open="${i.id}">
      <div class="row between"><span class="ico" style="width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:1.4rem;background:${D.w[i.workstream]?.color || 'var(--bg-2)'};color:${D.w[i.workstream]?.fg || 'var(--text)'}"><i class="ph ph-${fileIcon(i)}"></i></span>${st(i.status)}</div>
      <h3 style="margin:14px 0 6px">${esc(i.title)}</h3>
      <div class="small muted" style="min-height:2.6em">${esc((i.body || '').replace(/[#*_>`-]/g, '').slice(0, 100))}</div>
      <div class="row" style="margin-top:10px">${lock(i)}${i.file_key ? '<span class="tag accent"><i class="ph ph-paperclip"></i>Fichier</span>' : ''}${i.url ? '<span class="tag"><i class="ph ph-link"></i>Lien</span>' : ''}<span class="spacer"></span>${dateChip(i.due_date, isDone(i))}${ownerAv(i)}</div>
    </div>`).join('') || '<div class="empty">Aucun document</div>'}</div>`;
};
function drivePreview(url) {
  const m = url.match(/\/(?:document|spreadsheets|presentation|file)\/d\/([\w-]+)/);
  if (!m) return null;
  const kind = url.match(/\/(document|spreadsheets|presentation|file)\//)[1];
  return kind === 'file' ? `https://drive.google.com/file/d/${m[1]}/preview` : `https://docs.google.com/${kind}/d/${m[1]}/preview`;
}

// ------------------------------------------------------------------ contacts
VIEWS.contacts = () => {
  const q = (S.filters.cq || '').toLowerCase();
  const l = D.contacts.filter((c) => !q || [c.name, c.org, c.role, c.tags, c.email, c.notes].join(' ').toLowerCase().includes(q));
  const orgs = [...new Set(l.map((c) => c.org || 'Autres'))];
  return `<div class="page-head"><div><div class="label">Annuaire partagé</div><h1 style="margin-top:10px">Contacts</h1><p class="muted">Coordonnées des associés, partenaires et interlocuteurs, partagées avec toute l’équipe (et interrogeables depuis Claude).</p></div>
    <button class="btn primary" data-act="new-contact"><i class="ph ph-user-plus"></i>Nouveau contact</button></div>
    <div class="filters"><input class="input" style="max-width:360px" placeholder="Filtrer (nom, organisation, tag…)" data-cq value="${esc(S.filters.cq || '')}"></div>
    ${orgs.map((o) => `<div class="section"><div class="section-head"><h3>${esc(o)}</h3><span class="label">${l.filter((c) => (c.org || 'Autres') === o).length}</span></div><div class="grid auto">
      ${l.filter((c) => (c.org || 'Autres') === o).map((c) => `<div class="card hover" data-contact="${c.id}">
        <div class="row" style="flex-wrap:nowrap"><span class="avatar lg" style="background:${c.user_id && D.u[c.user_id] ? D.u[c.user_id].color : '#A3A3A3'};color:${c.user_id && D.u[c.user_id] ? D.u[c.user_id].fg : '#0A0A0A'}">${esc(initials(c.name))}</span><div style="min-width:0"><h3>${esc(c.name)}</h3><div class="small muted">${esc(c.role || '')}</div></div></div>
        <div class="col small" style="margin-top:14px;gap:6px">
          ${c.email ? `<a href="mailto:${esc(c.email)}" data-stop><i class="ph ph-envelope-simple"></i> ${esc(c.email)}</a>` : '<span class="muted"><i class="ph ph-envelope-simple"></i> email à compléter</span>'}
          ${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}" data-stop><i class="ph ph-phone"></i> ${esc(c.phone)}</a>` : ''}
        </div>
        ${c.tags ? `<div class="row" style="margin-top:12px;gap:6px">${c.tags.split(',').map((t) => `<span class="tag">${esc(t.trim())}</span>`).join('')}</div>` : ''}
      </div>`).join('')}</div></div>`).join('') || '<div class="empty">Aucun contact</div>'}`;
};

// ------------------------------------------------------------------ activité
VIEWS.activite = async () => {
  const l = await api('/api/activity?limit=200');
  return `<div class="page-head"><div><div class="label">Journal</div><h1 style="margin-top:10px">Activité</h1><p class="muted">Toutes les modifications, depuis l’outil web ou depuis Claude (MCP).</p></div></div>
    <div class="card"><div class="list">${l.map((a) => `<div class="li" ${a.item_id && D.i[a.item_id] ? `data-open="${a.item_id}"` : ''}>${av(a.who) || '<span class="avatar" style="background:#A3A3A3">?</span>'}<span class="t" style="font-weight:400"><b style="color:var(--text)">${esc(D.u[a.who]?.name || a.who || '')}</b> · ${esc(a.action)} — ${esc(a.summary || '')}</span><span class="meta">${a.via === 'mcp' ? '<span class="tag accent"><i class="ph ph-robot"></i>Claude</span>' : ''}<span class="label">${new Date(a.at + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span></span></div>`).join('') || '<div class="empty">Rien pour l’instant</div>'}</div></div>`;
};

// ------------------------------------------------------------------ Claude / MCP
VIEWS.claude = () => {
  const key = store.get('key');
  const url = key ? `${location.origin}/mcp/${key}` : null;
  return `<div class="page-head"><div><div class="label">Serveur MCP</div><h1 style="margin-top:10px">Connecter Claude</h1><p class="muted">Interrogez et mettez à jour le tableau de bord depuis Claude : « quelles questions restent ouvertes avant fin novembre ? », « ajoute une étape pour Kevin », « donne-moi la feuille de route ».</p></div></div>
    <div class="grid g2">
      <div class="card"><h3>Votre adresse MCP personnelle</h3><p class="small muted">Elle contient votre clé d’accès : ne la partagez pas. Les modifications faites par Claude sont journalisées à votre nom.</p>
        ${url ? `<code class="code">${esc(url)}</code><div class="row" style="margin-top:12px"><button class="btn primary" data-copy="${esc(url)}"><i class="ph ph-copy"></i>Copier</button></div>` : `<div class="empty">Clé non mémorisée sur cet appareil. Reconnectez-vous avec votre clé pour afficher l’adresse.</div>`}</div>
      <div class="card"><h3>Claude.ai (web, desktop, mobile)</h3><ol class="small" style="padding-left:18px;line-height:1.9"><li>Paramètres → <b>Connecteurs</b> → <b>Ajouter un connecteur personnalisé</b></li><li>Nom : <code>Pilotage</code> — URL : votre adresse MCP</li><li>Laissez les champs OAuth vides, validez</li><li>Activez le connecteur dans une conversation</li></ol>
        <h3 style="margin-top:18px">Claude Code</h3><code class="code">claude mcp add --transport http pilotage ${esc(url || '<adresse MCP>')}</code></div>
    </div>
    <div class="card section"><h3>Outils disponibles</h3><div class="grid auto small" style="margin-top:14px">${[['tableau_de_bord', 'Vue d’ensemble, retards, échéances, questions ouvertes'], ['lister', 'Recherche filtrée des éléments'], ['detail', 'Détail, commentaires, liens'], ['lire_document', 'Contenu d’un document'], ['creer / modifier', 'Créer ou mettre à jour une question, une étape, un document, un jalon'], ['commenter', 'Ajouter un commentaire'], ['feuille_de_route', 'Feuille de route markdown à jour'], ['chantiers', 'Avancement par chantier'], ['contacts / enregistrer_contact', 'Annuaire partagé'], ['activite', 'Journal des modifications']].map(([n, d]) => `<div><code>${n}</code><div class="muted" style="margin-top:4px">${d}</div></div>`).join('')}</div></div>`;
};

// ------------------------------------------------------------------ équipe & accès (admin)
VIEWS.equipe = async () => {
  if (!D.me.is_admin) return '<div class="empty">Réservé à l’administrateur</div>';
  const users = await api('/api/users');
  return `<div class="page-head"><div><div class="label">Administration</div><h1 style="margin-top:10px">Équipe & accès</h1><p class="muted">Générez une clé personnelle pour chaque membre : elle donne accès à l’outil web et au MCP. Générer une nouvelle clé révoque l’ancienne. La dernière connexion de chacun s’affiche à côté de son nom ; le journal « Activité » liste les connexions.</p></div>
    <button class="btn" data-act="new-user"><i class="ph ph-user-plus"></i>Ajouter un membre</button></div>
    <div class="card"><div class="list">${users.map((u) => `<div class="li" style="cursor:default">${av(u.id)}<span class="t">${esc(u.name)} <span class="muted small">· ${esc(u.org || '')} ${u.role ? '· ' + esc(u.role) : ''}</span></span><span class="meta"><span class="small muted" title="Dernière connexion">${u.last_seen ? `<i class="ph ph-clock"></i> ${new Date(u.last_seen + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${u.last_seen_via === 'mcp' ? ' · Claude' : ''}` : 'jamais connecté'}</span>${u.has_key ? '<span class="tag accent">clé active</span>' : '<span class="tag">pas de clé</span>'}${u.is_admin ? '<span class="tag">admin</span>' : ''}<button class="btn sm" data-genkey="${u.id}"><i class="ph ph-key"></i>${u.has_key ? 'Régénérer' : 'Générer'} la clé</button></span></div>`).join('')}</div></div>
    <div class="card section"><div class="section-head"><h3>Chantiers</h3><button class="btn sm" data-act="edit-ws"><i class="ph ph-plus"></i>Chantier</button></div><div class="list">${D.workstreams.map((w) => `<div class="li" data-act="edit-ws" data-id="${w.id}"><i class="ph ph-${esc(w.icon || 'circle')}" style="color:${D.w[w.id].color}"></i><span class="t">${esc(w.title)}</span><span class="meta">${av(w.lead)}<span class="label">${esc(w.id)}</span></span></div>`).join('')}</div></div>`;
};

// ------------------------------------------------------------------ modal élément
async function openItem(id, preset = {}) {
  const it = id ? await api(`/api/items/${id}`) : { kind: preset.kind || 'task', status: '', workstream: preset.ws || '', owner: D.me.id, priority: 'normale', comments: [], linked: [], ...preset };
  const k = it.kind;
  const statuses = D.kinds[k].statuses;
  const f = (name, label, input) => `<label class="field"><span>${label}</span>${input}</label>`;
  const inp = (n, type = 'text') => `<input class="input" type="${type}" name="${n}" value="${esc(it[n] ?? '')}" ${type === 'number' ? 'step="any"' : ''}>`;
  const extra = EXTRA[k].map((n) => {
    const label = k === 'event' && n === 'due_date' ? 'Date' : F_LABEL[n];
    if (n === 'options' || n === 'outcome') return f(n, label, `<textarea class="input" name="${n}" placeholder="Markdown">${esc(it[n] || '')}</textarea>`);
    if (n === 'amount') return f(n, label, inp(n, 'number'));
    if (n === 'url') return f(n, label, inp(n, 'url'));
    return f(n, label, inp(n, 'date'));
  });
  const dates = extra.filter((x) => x.includes('type="date"'));
  const others = extra.filter((x) => !x.includes('type="date"'));
  let preview = '';
  if (it.file_key) {
    const src = `/files/${encodeURIComponent(it.file_key)}`;
    preview = it.file_type?.includes('pdf') ? `<iframe src="${src}"></iframe>` : it.file_type?.startsWith('image') ? `<img src="${src}" alt="">` : /text|markdown|json|csv/.test(it.file_type || '') ? `<div class="md" style="padding:16px" data-textfile="${src}">Chargement…</div>` : '';
    preview = `<div class="preview">${preview}<div class="row between" style="padding:10px 14px"><span class="small"><i class="ph ph-paperclip"></i> ${esc(it.file_name)}</span><a class="btn sm" href="${src}" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out"></i>Ouvrir</a></div></div>`;
  } else if (it.url && drivePreview(it.url)) preview = `<div class="preview"><iframe src="${esc(drivePreview(it.url))}" allow="autoplay"></iframe></div>`;
  const others2 = D.items.filter((x) => x.id !== it.id);
  const html = `<div class="modal-bg" id="modal"><form class="modal" id="itemform">
    <div class="modal-head"><span class="ico" style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:var(--accent);color:#0A0A0A">${kindIcon(k)}</span>
      <div style="flex:1;min-width:0"><div class="label">${id ? `#${it.id} · ` : 'Nouveau · '}${KIND[k].label}</div><input class="title-input" name="title" value="${esc(it.title || '')}" placeholder="${k === 'document' ? 'Nom du document' : 'Formulez une question…'}" required></div>
      <button type="button" class="btn icon ghost" data-close><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div>
        ${!id ? f('kind', 'Type', `<select class="input" name="kind" data-kindswitch>${Object.entries(KIND).map(([kk, v]) => `<option value="${kk}" ${kk === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`) : ''}
        <div class="fgrid">
          ${f('status', 'Statut', `<select class="input" name="status">${statuses.map((s) => `<option value="${s}" ${it.status === s ? 'selected' : ''}>${ST_LABEL[s]}</option>`).join('')}</select>`)}
          ${COLLECTIVE.includes(k) ? '<input type="hidden" name="owner" value="">' : f('owner', 'Référent pressenti', `<select class="input" name="owner"><option value="">—</option>${D.users.map((u) => `<option value="${u.id}" ${it.owner === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`)}
          ${f('workstream', 'Chantier', `<select class="input" name="workstream"><option value="">—</option>${D.workstreams.map((w) => `<option value="${w.id}" ${it.workstream === w.id ? 'selected' : ''}>${esc(w.title)}</option>`).join('')}</select>`)}
          ${f('priority', 'Priorité', `<select class="input" name="priority">${['haute', 'normale', 'basse'].map((p) => `<option ${it.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>`)}
          ${dates.join('')}
        </div>
        ${others.join('')}
        <div class="field"><span>Visible par <span class="muted" style="text-transform:none;letter-spacing:0">(aucune case = tout le monde)</span></span>
          <div class="row" style="gap:6px">${D.users.map((u) => `<label class="chip ${(it.audience || '').split(',').includes(u.id) ? 'on' : ''}"><input type="checkbox" name="aud" value="${u.id}" ${(it.audience || '').split(',').includes(u.id) ? 'checked' : ''} hidden onchange="this.parentElement.classList.toggle('on', this.checked)">${av(u.id)}${esc(u.name.split(' ')[0])}</label>`).join('')}</div></div>
        ${f('body', 'Description (markdown)', `<textarea class="input" name="body" style="min-height:160px">${esc(it.body || '')}</textarea>`)}
      </div>
      <div class="col" style="gap:16px">
        ${preview}
        ${k === 'document' || it.file_key ? (id ? `<label class="drop-zone" id="dz"><input type="file" hidden id="file"><i class="ph ph-upload-simple" style="font-size:1.6rem"></i><div class="small">${it.file_key ? 'Remplacer le fichier' : 'Déposer un fichier (PDF, image, docx, md…)'}</div></label>` : '<div class="small muted">Enregistrez d’abord pour joindre un fichier.</div>') : ''}
        ${it.body ? `<div><div class="label" style="margin-bottom:8px">Aperçu</div><div class="md card" style="padding:16px;border-radius:16px">${md(it.body)}</div></div>` : ''}
        <div><div class="label" style="margin-bottom:8px">Éléments liés</div>
          <div class="row" id="links" style="gap:6px">${(it.linked || []).map((l) => `<span class="tag" data-link="${l.id}">${kindIcon(l.kind)} ${esc(l.title)} <i class="ph ph-x" data-unlink="${l.id}" style="cursor:pointer"></i></span>`).join('')}</div>
          <input class="input" list="itemlist" placeholder="Lier un élément…" id="linkadd" style="margin-top:8px"><datalist id="itemlist">${others2.map((x) => `<option value="#${x.id} ${esc(x.title)}">`).join('')}</datalist></div>
        ${id ? `<div><div class="label" style="margin-bottom:8px">Commentaires</div>${(it.comments || []).map((c) => `<div class="comment"><div class="row between"><span class="row" style="gap:8px">${av(c.author)}<b class="small">${esc(D.u[c.author]?.name || c.author)}</b></span><span class="label">${new Date(c.created_at + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span></div><div class="md small" style="margin-top:8px">${md(c.body)}</div></div>`).join('')}
          <div class="row" style="flex-wrap:nowrap"><input class="input" id="newcomment" placeholder="Ajouter un commentaire…"><button type="button" class="btn icon" data-act="comment"><i class="ph ph-paper-plane-right"></i></button></div></div>` : ''}
      </div>
    </div>
    <div class="modal-foot">${id ? `<button type="button" class="btn danger ghost" data-act="delete" style="margin-right:auto"><i class="ph ph-trash"></i>Supprimer</button>` : ''}
      <button type="button" class="btn" data-close>Annuler</button><button class="btn primary" type="submit"><i class="ph ph-check"></i>Enregistrer</button></div>
  </form></div>`;
  closeModal();
  document.body.insertAdjacentHTML('beforeend', html);
  const m = $('#modal'), form = $('#itemform');
  let links = (it.linked || []).map((l) => l.id);
  const tf = $('[data-textfile]', m);
  if (tf) fetch(tf.dataset.textfile).then((r) => r.text()).then((t) => (tf.innerHTML = md(t)));
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
  $('[data-kindswitch]', m)?.addEventListener('change', (e) => openItem(null, { ...Object.fromEntries(new FormData(form)), kind: e.target.value, status: '' }));
  $('#linkadd', m).addEventListener('change', (e) => {
    const lid = +(e.target.value.match(/^#(\d+)/) || [])[1];
    if (lid && !links.includes(lid)) { links.push(lid); $('#links', m).insertAdjacentHTML('beforeend', `<span class="tag" data-link="${lid}">${kindIcon(D.i[lid].kind)} ${esc(D.i[lid].title)} <i class="ph ph-x" data-unlink="${lid}" style="cursor:pointer"></i></span>`); }
    e.target.value = '';
  });
  $('#links', m).addEventListener('click', (e) => { const u = e.target.closest('[data-unlink]'); if (u) { links = links.filter((x) => x !== +u.dataset.unlink); u.parentElement.remove(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = Object.fromEntries(fd);
    delete body.aud;
    body.audience = fd.getAll('aud').join(',');
    body.link_ids = links;
    const saved = id ? await api(`/api/items/${id}`, { method: 'PUT', body }) : await api('/api/items', { method: 'POST', body: { ...body, kind: body.kind || k } });
    toast('Enregistré');
    await load(); render();
    if (!id && (body.kind || k) === 'document') openItem(saved.id); else closeModal();
  });
  $('[data-act="delete"]', m)?.addEventListener('click', async () => { if (!confirm('Supprimer définitivement cet élément ?')) return; await api(`/api/items/${id}`, { method: 'DELETE' }); closeModal(); await load(); render(); toast('Supprimé'); });
  $('[data-act="comment"]', m)?.addEventListener('click', async () => { const v = $('#newcomment', m).value.trim(); if (!v) return; await api(`/api/items/${id}/comments`, { method: 'POST', body: { body: v } }); await load(); openItem(id); });
  $('#newcomment', m)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-act="comment"]', m).click(); } });
  const dz = $('#dz', m);
  if (dz) {
    const up = async (file) => { if (!file) return; dz.innerHTML = '<div class="small">Envoi…</div>'; const fd = new FormData(); fd.append('file', file); await api(`/api/items/${id}/file`, { method: 'POST', body: fd }); await load(); render(); openItem(id); toast('Fichier joint'); };
    $('#file', m).addEventListener('change', (e) => up(e.target.files[0]));
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); up(e.dataTransfer.files[0]); });
  }
}
function closeModal() { $('#modal')?.remove(); }

function formModal(title, fields, values, onSave, extra = '') {
  closeModal();
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-bg" id="modal"><form class="modal narrow" id="fm">
    <div class="modal-head"><h2 style="flex:1">${esc(title)}</h2><button type="button" class="btn icon ghost" data-close><i class="ph ph-x"></i></button></div>
    <div class="modal-body single">${fields.map(([n, l, t]) => `<label class="field"><span>${l}</span>${t === 'textarea' ? `<textarea class="input" name="${n}">${esc(values[n] || '')}</textarea>` : Array.isArray(t) ? `<select class="input" name="${n}"><option value="">—</option>${t.map(([v, lab]) => `<option value="${esc(v)}" ${values[n] === v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>` : `<input class="input" name="${n}" type="${t || 'text'}" value="${esc(values[n] ?? '')}">`}</label>`).join('')}${extra}</div>
    <div class="modal-foot">${values.id && onSave.del ? `<button type="button" class="btn danger ghost" data-del style="margin-right:auto"><i class="ph ph-trash"></i>Supprimer</button>` : ''}<button type="button" class="btn" data-close>Annuler</button><button class="btn primary"><i class="ph ph-check"></i>Enregistrer</button></div></form></div>`);
  const m = $('#modal');
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
  $('#fm').addEventListener('submit', async (e) => { e.preventDefault(); await onSave(Object.fromEntries(new FormData(e.target))); closeModal(); await load(); render(); toast('Enregistré'); });
  $('[data-del]', m)?.addEventListener('click', async () => { if (!confirm('Supprimer ?')) return; await onSave.del(); closeModal(); await load(); render(); });
}
function contactModal(c = {}) {
  const save = (v) => api(c.id ? `/api/contacts/${c.id}` : '/api/contacts', { method: c.id ? 'PUT' : 'POST', body: v });
  save.del = () => api(`/api/contacts/${c.id}`, { method: 'DELETE' });
  formModal(c.id ? c.name : 'Nouveau contact', [['name', 'Nom'], ['org', 'Organisation'], ['role', 'Rôle / fonction'], ['email', 'Email', 'email'], ['phone', 'Téléphone', 'tel'], ['address', 'Adresse'], ['tags', 'Tags (séparés par des virgules)'], ['notes', 'Notes', 'textarea'], ['user_id', 'Membre de l’équipe', D.users.map((u) => [u.id, u.name])]], c, save,
    c.id ? `<div class="row"><button type="button" class="btn sm" data-vcard="${c.id}"><i class="ph ph-identification-card"></i>Télécharger la vCard</button>${c.email ? `<button type="button" class="btn sm" data-copy="${esc(c.email)}"><i class="ph ph-copy"></i>Copier l’email</button>` : ''}</div>` : '');
}
function vcard(c) {
  const v = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${c.name}`, c.org && `ORG:${c.org}`, c.role && `TITLE:${c.role}`, c.email && `EMAIL:${c.email}`, c.phone && `TEL:${c.phone}`, c.address && `ADR:;;${c.address}`, c.notes && `NOTE:${c.notes.replace(/\n/g, '\\n')}`, 'END:VCARD'].filter(Boolean).join('\r\n');
  download(`${c.name}.vcf`, v, 'text/vcard');
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }
function wsModal(id) {
  const w = D.workstreams.find((x) => x.id === id) || {};
  formModal(id ? w.title : 'Nouveau chantier', [['id', 'Identifiant (slug)'], ['title', 'Titre'], ['description', 'Description', 'textarea'], ['icon', 'Icône Phosphor (ex. scales)'], ['lead', 'Pilote', D.users.map((u) => [u.id, u.name])], ['color', 'Couleur (CSS, optionnel)'], ['sort', 'Ordre', 'number']], w, (v) => api('/api/workstreams', { method: 'POST', body: { ...v, sort: +v.sort || 0 } }));
}
function newMenu(ws) {
  closeModal();
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-bg" id="modal"><div class="modal narrow"><div class="modal-head"><h2 style="flex:1">Créer</h2><button class="btn icon ghost" data-close><i class="ph ph-x"></i></button></div>
    <div class="modal-body single"><div class="grid g2">${Object.entries(KIND).map(([k, v]) => `<button class="card hover" style="text-align:left;cursor:pointer" data-newkind="${k}"><span class="kpi"><span class="ico"><i class="ph ph-${v.icon}"></i></span></span><h3>${v.label}</h3></button>`).join('')}
    <button class="card hover" style="text-align:left;cursor:pointer" data-act="new-contact"><span class="kpi"><span class="ico"><i class="ph ph-user-plus"></i></span></span><h3>Contact</h3></button></div></div></div></div>`);
  const m = $('#modal');
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-newkind]'); if (b) openItem(null, { kind: b.dataset.newkind, ws }); else if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
}

// ------------------------------------------------------------------ rendu & routage
async function render() {
  if (!D) return;
  const [route, arg] = location.hash.slice(2).split('/');
  if (route === 'plus') return renderPlus();
  shell();
  const v = VIEWS[route || 'marche'] || VIEWS.marche;
  $('#view').innerHTML = await v(arg);
  bindDiagram();
  if (route === 'taches') bindKanban();
}
function renderPlus() {
  shell();
  $('#view').innerHTML = `<h1 style="margin-bottom:18px">Menu</h1><div class="grid g2">${NAV.filter(Boolean).concat(D.me.is_admin ? [['equipe', 'users-three', 'Équipe & accès']] : []).map((n) => `<a class="card hover" href="#/${n[0]}" style="text-decoration:none"><span class="kpi"><span class="ico"><i class="ph ph-${n[1]}"></i></span></span><h3>${n[2]}</h3></a>`).join('')}
    <button class="card hover" data-act="theme" style="text-align:left;cursor:pointer"><span class="kpi"><span class="ico"><i class="ph ph-circle-half"></i></span></span><h3>Changer de thème</h3></button>
    <button class="card hover" data-act="logout" style="text-align:left;cursor:pointer"><span class="kpi"><span class="ico"><i class="ph ph-sign-out"></i></span></span><h3>Déconnexion</h3></button></div>`;
}

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-stop]')) return;
  const a = t.closest('[data-act]');
  if (a) {
    const act = a.dataset.act;
    if (act === 'new') return a.dataset.kind ? openItem(null, { kind: a.dataset.kind, ws: a.dataset.ws }) : newMenu(a.dataset.ws);
    if (act === 'new-contact') return contactModal();
    if (act === 'edit-ws') return wsModal(a.dataset.id);
    if (act === 'theme') { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const n = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; store.set('theme', n); return; }
    if (act === 'logout') { await fetch('/api/logout'); store.set('key', null); location.hash = ''; return showLogin(); }
    if (act === 'refresh') { await load(); render(); return toast('Données actualisées'); }
    if (act === 'close-panel') { $('#dgpanel').innerHTML = ''; $('#dg').classList.remove('dimmed'); $$('.dg-node').forEach((g) => g.classList.remove('on', 'nb')); $$('.dg-edge').forEach((p) => p.classList.remove('hl')); return; }
    if (act === 'export-rm') return download(`feuille-de-route-${today()}.md`, await api('/api/roadmap'), 'text/markdown');
    if (act === 'print') return print();
    if (act === 'new-user') return formModal('Nouveau membre', [['id', 'Identifiant (prénom en minuscules)'], ['name', 'Nom complet'], ['org', 'Organisation'], ['role', 'Rôle']], {}, (v) => api('/api/users', { method: 'POST', body: v }));
  }
  const o = t.closest('[data-open]');
  if (o && !t.closest('.modal')) return openItem(+o.dataset.open);
  const tab = t.closest('[data-tab]');
  if (tab) { S.schemaTab = tab.dataset.tab; if (location.hash !== '#/schema') location.hash = '#/schema'; else render(); e.preventDefault(); return; }
  const rm = t.closest('[data-rm]'); if (rm) { S.roadmapMode = rm.dataset.rm; return render(); }
  const ow = t.closest('[data-owner]'); if (ow) { const [sc, id] = ow.dataset.owner.split(':'); S.filters[sc] = { ...(S.filters[sc] || {}), owner: id || null }; return render(); }
  const tg = t.closest('[data-toggle]'); if (tg) { const [sc, k] = tg.dataset.toggle.split('.'); S.filters[sc] = { ...(S.filters[sc] || {}), [k]: !S.filters[sc]?.[k] }; return render(); }
  const sc = t.closest('[data-scroll]'); if (sc) { e.preventDefault(); document.getElementById(sc.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const et = t.closest('[data-etype]'); if (et) { const k = et.dataset.etype; S.hide.has(k) ? S.hide.delete(k) : S.hide.add(k); return render(); }
  const kc = t.closest('[data-kcol]'); if (kc) { S.kcol = kc.dataset.kcol; return render(); }
  const ds = t.closest('[data-docst]'); if (ds) { S.docStatus = ds.dataset.docst || null; return render(); }
  const ct = t.closest('[data-contact]'); if (ct) return contactModal(D.contacts.find((c) => c.id === +ct.dataset.contact));
  const vc = t.closest('[data-vcard]'); if (vc) return vcard(D.contacts.find((c) => c.id === +vc.dataset.vcard));
  const cp = t.closest('[data-copy]'); if (cp) return copy(cp.dataset.copy);
  const gk = t.closest('[data-genkey]');
  if (gk) {
    if (!confirm('Générer une nouvelle clé ? L’ancienne sera révoquée.')) return;
    const { key } = await api(`/api/users/${gk.dataset.genkey}/key`, { method: 'POST' });
    const link = `${location.origin}/#/login?k=${key}`, mcp = `${location.origin}/mcp/${key}`;
    formModal(`Accès de ${D.u[gk.dataset.genkey]?.name}`, [], {}, async () => {}, `<p class="small">À transmettre <b>de façon privée</b> (cette clé n’est affichée qu’une fois).</p>
      <div class="label">Lien de connexion</div><code class="code">${esc(link)}</code><button type="button" class="btn sm" data-copy="${esc(link)}"><i class="ph ph-copy"></i>Copier le lien</button>
      <div class="label" style="margin-top:14px">Adresse MCP (Claude)</div><code class="code">${esc(mcp)}</code><button type="button" class="btn sm" data-copy="${esc(mcp)}"><i class="ph ph-copy"></i>Copier l’adresse MCP</button>
      <div class="label" style="margin-top:14px">Clé seule</div><code class="code">${esc(key)}</code>`);
    if (gk.dataset.genkey === D.me.id) store.set('key', key);
    return;
  }
  const ss = t.closest('[data-save-setting]');
  if (ss) { try { const v = JSON.parse($(`#set-${ss.dataset.saveSetting}`).value); await api(`/api/settings/${ss.dataset.saveSetting}`, { method: 'PUT', body: { value: v } }); await load(); render(); toast('Enregistré'); } catch (err) { toast('JSON invalide : ' + err.message); } }
});
document.addEventListener('change', (e) => {
  const f = e.target.closest('[data-filter]');
  if (f) { const [sc, k] = f.dataset.filter.split('.'); S.filters[sc] = { ...(S.filters[sc] || {}), [k]: f.value || null }; render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-cq]')) { S.filters.cq = e.target.value; const pos = e.target.selectionStart; render().then(() => { const i = $('[data-cq]'); i.focus(); i.setSelectionRange(pos, pos); }); }
  if (e.target.id === 'q') {
    const q = e.target.value.trim().toLowerCase(), box = $('#qr');
    if (q.length < 2) { box.hidden = true; return; }
    const its = D.items.filter((i) => [i.title, i.body, i.options, i.outcome].join(' ').toLowerCase().includes(q)).slice(0, 12);
    const cs = D.contacts.filter((c) => [c.name, c.org, c.role, c.tags].join(' ').toLowerCase().includes(q)).slice(0, 5);
    box.innerHTML = its.map((i) => `<a href="javascript:void 0" data-open="${i.id}">${kindIcon(i.kind)}<span style="flex:1">${esc(i.title)}</span>${st(i.status)}</a>`).join('') + cs.map((c) => `<a href="javascript:void 0" data-contact="${c.id}"><i class="ph ph-user"></i><span style="flex:1">${esc(c.name)}</span><span class="small muted">${esc(c.org || '')}</span></a>`).join('') || '<div class="small muted" style="padding:10px">Aucun résultat</div>';
    box.hidden = false;
  }
});
document.addEventListener('focusout', (e) => { if (e.target.id === 'q') setTimeout(() => { const b = $('#qr'); if (b) b.hidden = true; }, 200); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q')?.focus(); } });
let rsz; let lastW = innerWidth;
window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 40 && /schema/.test(location.hash) && !$('#modal')) { lastW = innerWidth; S.zoom = null; render(); } }, 250); });
window.addEventListener('hashchange', () => { closeModal(); render(); scrollTo(0, 0); });

// ------------------------------------------------------------------ connexion
function showLogin(msg) {
  D = null;
  $('#root').innerHTML = `<div class="login"><div class="hero" style="position:fixed;inset:0;border-radius:0"><div class="glow"></div><div class="glow b"></div></div>
    <form class="card" id="login"><div class="label">Espace privé</div><h1 style="margin:12px 0 8px;font-size:2rem">Pilotage du projet</h1>
    <p class="muted small">Saisissez la clé d’accès personnelle qui vous a été transmise.</p>
    <input class="input" name="key" type="password" placeholder="Clé d’accès" autocomplete="current-password" required style="margin:14px 0">
    ${msg ? `<p class="small" style="color:var(--danger)">${esc(msg)}</p>` : ''}
    <button class="btn primary" style="width:100%"><i class="ph ph-sign-in"></i>Entrer</button></form></div>`;
  $('#login').addEventListener('submit', async (e) => { e.preventDefault(); await tryLogin(new FormData(e.target).get('key')); });
}
async function tryLogin(key) {
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
  if (!r.ok) return showLogin('Clé invalide');
  store.set('key', key);
  location.hash = '#/marche';
  await start();
}
async function start() {
  const m = location.hash.match(/[?&]k=([^&]+)/) || location.search.match(/[?&]k=([^&]+)/);
  if (m) { history.replaceState(null, '', '/#/marche'); return tryLogin(decodeURIComponent(m[1])); }
  try { await load(); render(); } catch (e) { if (!D) showLogin(); }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
