// Point d'entrée alternatif : sert la PWA depuis les fichiers embarqués (src/static.gen.js)
import worker from './worker.js';
import files from './static.gen.js';
const bin = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const ASSETS = {
  fetch(req) {
    const p = new URL(req.url).pathname;
    const f = files[p] || files[p + '/index.html'] || files['/index.html'];
    return new Response(bin(f.b), { headers: { 'Content-Type': f.t, 'Cache-Control': 'public, max-age=0, must-revalidate' } });
  },
};
export default { fetch: (req, env, ctx) => worker.fetch(req, { ...env, ASSETS }, ctx) };
