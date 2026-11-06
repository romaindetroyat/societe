# PROJECT — Pilotage NewCo

## Vision
Un cockpit unique, partagé par les 5 personnes du projet, pour piloter la création et le démarrage de la nouvelle société (successeur du consortium Take Off) : chantiers, décisions à trancher, documents, budget, feuille de route, contacts — consultable et modifiable depuis le web (PWA) et depuis Claude (MCP).

## Contraintes
- Très léger : pas de framework front, pas d'étape de build, un seul Worker Cloudflare.
- Dépôt **public** : aucune donnée métier dans le code. Les données vivent dans D1 / R2, derrière authentification.
- Design dérivé de la charte Takeoff, sans logo, palette adoucie, clair / sombre.
- Accès : 5 utilisateurs, clé personnelle (web + MCP), journal des actions.

## Stack
Cloudflare Worker (API + MCP + assets) · D1 (données) · R2 (fichiers) · HTML/CSS/JS vanilla · Phosphor Icons · marked + DOMPurify.

## Décisions techniques
| Décision | Raison |
|---|---|
| Modèle « item » générique (tâche, décision, document, jalon, budget, sujet) | Une seule table, une seule modale, feuille de route calculée sur toutes les dates |
| Auth par clé personnelle (hash SHA-256 en base), cookie HttpOnly | Zéro dépendance, même clé pour le web et le MCP |
| MCP Streamable HTTP sans état, réponses JSON, clé dans l'URL | Compatible connecteurs personnalisés claude.ai sans OAuth |
| Schéma de structure stocké en JSON dans `settings` | Modifiable sans redéploiement, rien de confidentiel dans le dépôt |
