# Pilotage NewCo

Tableau de bord de création et de pilotage de société : chantiers, décisions à trancher, documents, budget, feuille de route, tâches, contacts. PWA + serveur MCP pour Claude. Hébergé sur Cloudflare (Worker + D1 + R2), sans framework ni build.

> Les données ne sont pas dans ce dépôt (public) : elles sont dans D1/R2, derrière authentification par clé personnelle.

## Déployer
1. Cloudflare → Workers & Pages → **Create → Import a repository** → ce dépôt (branche `main`). Commande de déploiement : `npx wrangler deploy`.
2. Migrations D1 : `npx wrangler d1 migrations apply societe-pilotage --remote` (déjà appliquées en production).
3. Optionnel : `npx wrangler secret put ADMIN_KEY` (clé administrateur de secours).

Alternative : workflow GitHub « Déploiement Cloudflare (manuel) » avec les secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.

## Développement local
```bash
npm install
echo "ADMIN_KEY=dev" > .dev.vars
npx wrangler d1 migrations apply societe-pilotage --local
npx wrangler dev
```
Puis ouvrir `http://localhost:8787/#/login?k=dev`.

## MCP
Adresse : `https://<worker>/mcp/<clé personnelle>` (Streamable HTTP). Outils : `tableau_de_bord`, `lister`, `detail`, `lire_document`, `creer`, `modifier`, `commenter`, `feuille_de_route`, `chantiers`, `contacts`, `enregistrer_contact`, `activite`.

## Structure
- `src/worker.js` — routage, auth, API, fichiers
- `src/db.js` — accès D1 partagé web / MCP
- `src/mcp.js` — serveur MCP
- `public/` — PWA (index, app.js, styles.css, sw.js, manifest)
- `migrations/` — schéma D1
- `.planning/` — GSD light (projet, exigences, feuille de route, état)
