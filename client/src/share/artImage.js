// Visuel généré d'un album → image pour un canvas — chantier P1-C (PLAN.md 7.1, moteur d'images de partage).
// Le visuel est celui de CoverArt (même palette, même motif, partout dans le site) : rendu une fois dans un nœud
// détaché, sérialisé en SVG autonome, puis chargé depuis une URL Blob de la page. Une image de même origine ne
// « salit » jamais le canvas : l'export PNG réussit toujours avec ces visuels (repli des vraies pochettes, cartes pas
// encore obtenues, démo sans réseau).
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import CoverArt from '../components/CoverArt.jsx';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Images déjà prêtes, par graine du visuel et taille (une grille 3 × 3 redessinée change de format sans tout refaire).
const cache = new Map();
const CACHE_MAX = 80;

/**
 * SVG autonome du visuel généré de `art` (texte), à `size` pixels de côté. Les identifiants internes (dégradés) sont
 * renommés : ceux de React ne sont pas toujours des noms XML valides une fois hors de la page.
 */
export function artSvg(art, size = 512) {
  if (typeof document === 'undefined' || !art?.palette) return null;
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(CoverArt, { art: { ...art, cover: null }, generated: true })));
    const svg = host.querySelector('svg');
    if (!svg) return null;
    const ids = new Map();
    svg.querySelectorAll('[id]').forEach((el, i) => {
      ids.set(el.id, `g${i}`);
      el.id = `g${i}`;
    });
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.removeAttribute('class');
    let text = new XMLSerializer().serializeToString(svg);
    for (const [from, to] of ids) text = text.split(`url(#${from})`).join(`url(#${to})`);
    return text;
  } finally {
    root.unmount();
  }
}

/** Charge une image depuis une adresse ; rejette si elle ne se décode pas. */
function load(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_error'));
    img.src = src;
  });
}

/**
 * Visuel généré de `art` en image prête à dessiner (HTMLImageElement), gardé en cache. Rejette seulement si le
 * navigateur ne sait pas décoder un SVG (l'appelant dessine alors un aplat de la palette).
 */
export function artImage(art, size = 512) {
  const key = `${art?.seed || art?.motif || '?'}@${size}`;
  if (cache.has(key)) return cache.get(key);
  const svg = artSvg(art, size);
  const promise = svg
    ? (async () => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      try {
        const img = await load(url);
        // Copie sur un petit canvas : l'image reste utilisable après la libération de l'URL Blob.
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(img, 0, 0, size, size);
        return canvas;
      } finally {
        URL.revokeObjectURL(url);
      }
    })()
    : Promise.reject(new Error('no_svg'));
  promise.catch(() => cache.delete(key));
  cache.set(key, promise);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return promise;
}

export default artImage;
