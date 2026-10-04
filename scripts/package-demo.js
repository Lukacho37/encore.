// Transforme dist-demo/index.html (un seul fichier généré par Vite) en page autonome prête à partager.
// Le résultat, dist-demo/albummania-demo.html, ne contient pas de balises <html>/<head>/<body> :
// il est conçu pour être publié tel quel comme page hébergée (Artifact claude.ai).
import fs from 'node:fs';

const src = fs.readFileSync('dist-demo/index.html', 'utf8');
const pick = (re) => [...src.matchAll(re)].map((m) => m[0]);

const title = pick(/<title>[\s\S]*?<\/title>/g)[0] || '<title>AlbumMania</title>';
const links = pick(/<link[^>]+(?:fonts\.googleapis|fonts\.gstatic|rel="icon")[^>]*>/g);
const styles = pick(/<style[\s\S]*?<\/style>/g);
const scripts = pick(/<script[\s\S]*?<\/script>/g);

const out = ['<meta charset="utf-8">', title, ...links, ...styles, '<div id="root"></div>', ...scripts].join('\n');
fs.writeFileSync('dist-demo/albummania-demo.html', out);
console.log(`dist-demo/albummania-demo.html (${Math.round(out.length / 1024)} Ko)`);
