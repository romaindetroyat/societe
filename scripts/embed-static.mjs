// Génère src/static.gen.js : fichiers de public/ embarqués dans le Worker
// (déploiement sans upload d'assets, ex. depuis un environnement à proxy)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const out = {};
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out['/' + p.slice('public/'.length)] = { t: T[extname(p)] || 'application/octet-stream', b: readFileSync(p).toString('base64') }; } };
walk('public');
writeFileSync('src/static.gen.js', 'export default ' + JSON.stringify(out) + ';\n');
console.log(Object.keys(out).length + ' fichiers embarqués');
