// Transforme dist-demo/index.html (un seul fichier généré par Vite) en page autonome prête à partager.
// Le résultat, dist-demo/albummania-demo.html, ne contient pas de balises <html>/<head>/<body> :
// il est conçu pour être publié tel quel comme page hébergée (Artifact claude.ai).
//
// La page ne doit jamais rester noire :
// - un écran de chargement statique s'affiche avant même que le script tourne ;
// - un petit script classique, chargé en premier, affiche toute erreur de démarrage à l'écran ;
// - si l'application se vide, un message de secours en CSS pur prend le relais ;
// - l'application est un script classique (pas de module), pour les lecteurs intégrés plus stricts.
import fs from 'node:fs';

const src = fs.readFileSync('dist-demo/index.html', 'utf8');
const pick = (re) => [...src.matchAll(re)].map((m) => m[0]);

const title = pick(/<title>[\s\S]*?<\/title>/g)[0] || '<title>AlbumMania</title>';
const links = pick(/<link[^>]+(?:fonts\.googleapis|fonts\.gstatic|rel="icon")[^>]*>/g);
const styles = pick(/<style[\s\S]*?<\/style>/g).map((s) => s.replace(/^<style[^>]*>/, '<style>'));
const bodies = pick(/<script[^>]*>[\s\S]*?<\/script>/g).map((s) => s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));

if (bodies.length !== 1) throw new Error(`Un seul script attendu, ${bodies.length} trouvés`);
let app = bodies[0];
if (/\bimport\.meta\b/.test(app)) throw new Error('import.meta reste dans le script : la démo doit être un script classique');
// Chargeur de routes paresseuses de react-router (mode framework) : jamais utilisé, et `import()` n'existe
// pas dans les anciens moteurs. On le remplace par un rejet pour garder un script classique pur.
app = app.replace(/\bimport\((\w+)\.module\)/g, 'Promise.reject(new Error("dynamic import disabled"))');
if (/\bimport\(/.test(app)) throw new Error('import() reste dans le script');
if (/<\/script/i.test(app) || /<!--/.test(app)) throw new Error('Le script contient une séquence qui casserait la page HTML');

// Styles de secours : lisibles même si la feuille principale ne se charge pas.
const bootStyle = `<style>
.am-boot,.am-fallback{min-height:100vh;min-height:100dvh;display:grid;place-content:center;justify-items:center;gap:14px;padding:24px 16px;background:#0f0c15;color:#d8d0de;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}
.am-fallback{display:none}
#root:empty+.am-fallback{display:grid}
.am-boot__disc{width:56px;height:56px;border-radius:50%;background:radial-gradient(circle,#0f0c15 0 8%,transparent 8.5%),radial-gradient(circle,transparent 0 36%,#1b1623 36.5%),conic-gradient(#ef3b3b,#ff8b3d,#ffd35a,#7fd36b,#4f9dff,#b17dff,#ef3b3b);animation:am-spin 1.6s linear infinite}
.am-boot__name{font:800 22px/1 system-ui,sans-serif;color:#f4eee3;letter-spacing:-.02em}
.am-boot__hint{max-width:46ch;color:#a79fb5;font-size:13px;opacity:0;animation:am-show .3s 9s forwards}
.am-fatal{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-height:60vh;overflow:auto;padding:14px 16px;border-radius:12px;background:#2a0e1a;border:1px solid #ef3b3b;color:#ffd2d2;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left}
.am-fatal strong{display:block;margin-bottom:6px;font:700 14px/1.3 system-ui,sans-serif;color:#fff}
.am-fatal button{margin-top:10px;padding:6px 12px;border-radius:999px;border:0;background:#f4eee3;color:#0f0c15;font:600 13px system-ui,sans-serif;cursor:pointer}
@keyframes am-spin{to{transform:rotate(360deg)}}
@keyframes am-show{to{opacity:1}}
@media (prefers-reduced-motion:reduce){.am-boot__disc{animation:none}}
</style>`;

const bootScreen = `<div class="am-boot" aria-busy="true">
<span class="am-boot__disc" aria-hidden="true"></span>
<span class="am-boot__name">AlbumMania</span>
<span>Chargement de la démo… · Loading the demo…</span>
<span class="am-boot__hint">Si cet écran reste affiché, le lecteur bloque peut-être les scripts. · If this screen stays, the viewer may be blocking scripts.</span>
</div>`;

// Affiché par le CSS seul si l'application vide la page sans rien rendre.
const fallback = `<div class="am-fallback" role="alert">
<span class="am-boot__name">AlbumMania</span>
<span>L’application s’est arrêtée. Recharge la page. · The app stopped. Reload the page.</span>
</div>`;

// Garde-fou : s'exécute avant l'application et affiche toute erreur tant qu'elle n'a pas démarré.
const guard = `<script>
(function(){
  var shown = false;
  function show(message){
    if (window.__albummaniaReady || shown) return;
    shown = true;
    var box = document.createElement('div');
    box.className = 'am-fatal';
    box.setAttribute('role', 'alert');
    var title = document.createElement('strong');
    title.textContent = 'La d\\u00e9mo n\\u2019a pas pu d\\u00e9marrer \\u00b7 The demo could not start';
    var text = document.createElement('div');
    text.textContent = String(message || '?').slice(0, 2000);
    var reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'R\\u00e9initialiser et recharger \\u00b7 Reset and reload';
    reset.onclick = function(){
      try { localStorage.removeItem('albummania.demo.v1'); } catch (e) {}
      try { location.reload(); } catch (e) {}
    };
    box.appendChild(title); box.appendChild(text); box.appendChild(reset);
    (document.body || document.documentElement).appendChild(box);
  }
  window.addEventListener('error', function(e){
    if (!e || !e.message) return;
    show(e.message + (e.filename ? '\\n' + e.filename + ':' + e.lineno + ':' + e.colno : '') + (e.error && e.error.stack ? '\\n' + e.error.stack : ''));
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    show(r && (r.stack || r.message) ? (r.stack || r.message) : String(r));
  });
  setTimeout(function(){
    if (!window.__albummaniaReady) show('Le script principal ne s\\u2019est pas lanc\\u00e9 apr\\u00e8s 12 secondes. \\u00b7 The main script did not start after 12 seconds.');
  }, 12000);
})();
</script>`;

const out = [
  '<meta charset="utf-8">',
  title,
  ...links,
  bootStyle,
  ...styles,
  `<div id="root">${bootScreen}</div>`,
  fallback,
  guard,
  `<script>${app}</script>`,
].join('\n');

fs.writeFileSync('dist-demo/albummania-demo.html', out);
console.log(`dist-demo/albummania-demo.html (${Math.round(out.length / 1024)} Ko)`);
