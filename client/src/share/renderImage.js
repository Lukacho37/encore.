// Image à partager (PNG) — chantier P1-C (PLAN.md 9.2, règles 7.1 ; DESIGN-OVERRIDE point 5 : vraies pochettes).
// renderImage(spec, options?) → Promise<{ blob, usedCovers, width, height }>
//   spec = { format: 'portrait' | 'square' | 'story', theme: 'ink' | 'ivory', title, subtitle?,
//            tiles: [{ albumId | trackId, label?, sub? } | null], blocks?: [...], footer: 'AlbumMania', attribution? }
//   blocks : [{ kind: 'stat', value, label } | { kind: 'text', text } | { kind: 'bars', items: [{ label, value (0 à 1) }] }]
//   options = { covers (valeur de useCovers()), realCovers (défaut true : SHARE_COVERS vaut « deezer » par défaut) }
//
// Tout est composé dans le navigateur, jamais sur le serveur (rien n'est envoyé ni stocké). Chaque vignette est la vraie
// pochette (CDN de la plateforme, `crossOrigin = 'anonymous'`), sauf si elle ne charge pas, ne passe pas le contrôle
// CORS ou salirait le canvas : la vignette prend alors le visuel généré d'AlbumMania (artImage.js), et l'export
// réussit toujours. Pochette retirée par l'admin (`coverBlocked`) : visuel généré. Quand au moins une vraie pochette
// est dessinée, une ligne discrète « Pochettes : Deezer » est ajoutée. Pied de l'image : le logo AlbumMania (disque +
// « Album » + « Mania » en dégradé), sans adresse. Formats 1080 × 1350, 1080 × 1080, 1080 × 1920 ; thèmes Encre et
// Papier, couleurs lues dans les jetons du site (:root), avec les valeurs de app.css en repli.
import { getAlbum, getTrack } from '../catalogStore.js';
import { requestAlbums, requestTracks } from '../state/catalog.js';
import { realCover } from '../state/CoversContext.jsx';
import { artImage } from './artImage.js';

export const FORMATS = { portrait: [1080, 1350], square: [1080, 1080], story: [1080, 1920] };
export const THEMES = ['ink', 'ivory'];
/** Vignettes au plus par image. */
export const MAX_TILES = 25;
/** Attente maximale d'une vraie pochette avant de passer au visuel généré. */
const COVER_TIMEOUT = 6000;
const FONT_TIMEOUT = 2500;

// Valeurs de app.css (:root), utilisées si les jetons ne sont pas lisibles.
const FALLBACK = {
  '--ink': '#0f0c15', '--paper': '#f4eee3', '--haze': '#a79fb5',
  '--glow-violet': 'rgba(194, 107, 255, 0.22)', '--glow-cue': 'rgba(63, 214, 196, 0.12)',
  '--r-uncommon': '#7fd36b', '--r-rare': '#4f9dff', '--r-super': '#b17dff', '--r-ultra': '#ff8b3d', '--r-legendary': '#ffd35a',
  '--r-promo': '#ef3b3b', '--groove-mark': '#1b1623', '--groove-mark-2': '#241d2e',
  '--font-display': "'Archivo', 'Arial Black', 'Helvetica Neue', system-ui, sans-serif",
  '--font-body': "'Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-mono': "'Martian Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
};

function tokens() {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
  const read = (name) => (style?.getPropertyValue(name) || '').trim() || FALLBACK[name];
  return Object.fromEntries(Object.keys(FALLBACK).map((k) => [k, read(k)]));
}

/** Couleurs d'un thème (Encre : fond encre et halos du héros ; Papier : fond ivoire, titre et logo à l'encre). */
function palette(theme, tk) {
  const ink = theme !== 'ivory';
  return {
    ink,
    bg: ink ? tk['--ink'] : tk['--paper'],
    text: ink ? tk['--paper'] : tk['--ink'],
    muted: ink ? tk['--haze'] : '#5a5068',
    rule: ink ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 12, 21, 0.14)',
    empty: ink ? 'rgba(244, 238, 227, 0.22)' : 'rgba(15, 12, 21, 0.22)',
    shadow: ink ? 'rgba(0, 0, 0, 0.8)' : 'rgba(40, 24, 60, 0.28)',
    glowViolet: ink ? tk['--glow-violet'] : 'rgba(194, 107, 255, 0.16)',
    glowCue: ink ? tk['--glow-cue'] : 'rgba(63, 214, 196, 0.10)',
  };
}

// ----- chargement ----------------------------------------------------------------------------

/** Polices du site attendues (Archivo, Figtree, Martian Mono), sans bloquer plus de 2,5 s (démo : polices système). */
async function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const wanted = ['900 64px Archivo', '800 64px Archivo', '600 32px Figtree', '700 32px Figtree', '600 28px "Martian Mono"'];
  await Promise.race([
    Promise.allSettled(wanted.map((f) => document.fonts.load(f))),
    new Promise((resolve) => setTimeout(resolve, FONT_TIMEOUT)),
  ]);
}

/** Albums et morceaux des vignettes : déjà dans le catalogue du site, sinon demandés par lots. */
async function resolveTiles(tiles) {
  const albumIds = tiles.filter((t) => t?.albumId && !getAlbum(t.albumId)).map((t) => t.albumId);
  const trackIds = tiles.filter((t) => t?.trackId && !getTrack(t.trackId)).map((t) => t.trackId);
  await Promise.all([albumIds.length && requestAlbums(albumIds), trackIds.length && requestTracks(trackIds)].filter(Boolean));
  return tiles.map((t) => {
    if (!t || (!t.albumId && !t.trackId)) return null;
    const item = t.albumId ? getAlbum(t.albumId) : getTrack(t.trackId);
    const art = item?.art || { palette: ['#2a2336', '#3a3149', '#a79fb5'], motif: 'rings', seed: String(t.albumId || t.trackId) };
    return { ...t, art, title: item?.title || '', artist: item?.artist || '' };
  });
}

/** Image d'une autre origine chargée en mode CORS ; rejette en cas d'échec ou après COVER_TIMEOUT. */
function loadCors(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('cover_timeout'));
      img.removeAttribute('src');
    }, COVER_TIMEOUT);
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => finish(resolve, img);
    img.onerror = () => finish(reject, new Error('cover_error'));
    img.src = src;
  });
}

/** Une image dessinée salirait-elle le canvas ? Essai sur un canvas de 1 × 1, jeté ensuite. */
export function taints(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return false;
  } catch {
    return true;
  }
}

/**
 * Source d'une vignette : { img, real }. Vraie pochette si permise, chargée et exportable ; sinon le visuel généré ;
 * en dernier recours { img: null } (aplat de la palette).
 */
async function tileSource(tile, { covers, realCovers }) {
  if (realCovers && !tile.art.coverBlocked) {
    const real = realCover(tile.art, covers);
    const src = real?.cover || real?.thumb;
    if (src) {
      try {
        const img = await loadCors(src);
        if (!taints(img)) return { img, real: true, provider: real.provider || 'deezer' };
      } catch {
        // Pochette indisponible ou refusée par CORS : visuel généré (ci-dessous).
      }
    }
  }
  try {
    return { img: await artImage(tile.art, 512), real: false };
  } catch {
    return { img: null, real: false };
  }
}

// ----- dessin ----------------------------------------------------------------------------------

function setFont(ctx, { weight, size, family, stretch = false, spacing = 0 }) {
  ctx.font = `${weight} ${Math.round(size)}px ${family}`;
  if ('fontStretch' in ctx) ctx.fontStretch = stretch ? 'semi-expanded' : 'normal';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(spacing * size).toFixed(2)}px`;
}

function ellipsis(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Coupe un texte en lignes de largeur `max` (au plus `lines`, la dernière terminée par « … » si besoin). */
function wrap(ctx, text, max, lines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (!line || ctx.measureText(next).width <= max) {
      line = next;
      continue;
    }
    out.push(line);
    if (out.length === lines - 1) {
      line = words.slice(i).join(' ');
      break;
    }
    line = words[i];
  }
  if (line) out.push(line);
  return out.slice(0, lines).map((l, i, all) => (i === all.length - 1 ? ellipsis(ctx, l, max) : l));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Fond : aplat du thème, halos du héros (violet en haut à gauche, turquoise en bas à gauche), disque gravé (Encre). */
function drawBackground(ctx, W, H, pal) {
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (cx, cy, rx, ry, color) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, color);
    g.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };
  glow(W * 0.18, 0, W * 0.5, H * 0.6, pal.glowViolet);
  glow(0, H, W * 0.4, H * 0.45, pal.glowCue);
  if (pal.ink) {
    // Le disque gravé du héros, dans le coin (comme .nine-share::after).
    const cx = W * 0.92;
    const cy = W * 0.12;
    const R = W * 0.26;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = Math.max(1, W * 0.0025);
    for (let r = W * 0.02; r < R; r += W * 0.02) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Vignette : ombre portée, image recadrée au carré (jamais plus), coins arrondis ; case vide en pointillés. */
function drawTile(ctx, x, y, s, src, tile, pal, W) {
  const r = W * 0.016;
  if (!tile) {
    ctx.save();
    ctx.setLineDash([W * 0.012, W * 0.01]);
    ctx.lineWidth = Math.max(2, W * 0.002);
    ctx.strokeStyle = pal.empty;
    roundRect(ctx, x + 1, y + 1, s - 2, s - 2, r);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.shadowColor = pal.shadow;
  ctx.shadowBlur = W * 0.035;
  ctx.shadowOffsetY = W * 0.016;
  ctx.fillStyle = tile.art.palette?.[0] || pal.bg;
  roundRect(ctx, x, y, s, s, r);
  ctx.fill();
  ctx.restore();
  if (!src?.img) return;
  ctx.save();
  roundRect(ctx, x, y, s, s, r);
  ctx.clip();
  const iw = src.img.naturalWidth || src.img.width;
  const ih = src.img.naturalHeight || src.img.height;
  const side = Math.min(iw, ih);
  ctx.drawImage(src.img, (iw - side) / 2, (ih - side) / 2, side, side, x, y, s, s);
  ctx.restore();
}

/** Logo AlbumMania : petit vinyle aux couleurs des raretés, « Album » et « Mania » en dégradé. Centré sur `cx`. */
function drawLogo(ctx, cx, cy, size, pal, tk) {
  setFont(ctx, { weight: 900, size, family: tk['--font-display'], stretch: true, spacing: -0.035 });
  const wAlbum = ctx.measureText('Album').width;
  const wMania = ctx.measureText('Mania').width;
  const d = size * 1.18;
  const gap = size * 0.32;
  let x = cx - (d + gap + wAlbum + wMania) / 2;
  const dcx = x + d / 2;
  const R = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(dcx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  const colors = ['--r-promo', '--r-ultra', '--r-legendary', '--r-uncommon', '--r-rare', '--r-super', '--r-promo'].map((k) => tk[k]);
  const fill = ctx.createConicGradient ? ctx.createConicGradient(-Math.PI / 2, dcx, cy) : ctx.createLinearGradient(dcx - R, cy - R, dcx + R, cy + R);
  colors.forEach((c, i) => fill.addColorStop(i / (colors.length - 1), c));
  ctx.fillStyle = fill;
  ctx.fillRect(dcx - R, cy - R, d, d);
  const ring = (r0, r1, color) => {
    ctx.beginPath();
    ctx.arc(dcx, cy, R * r1, 0, Math.PI * 2);
    ctx.arc(dcx, cy, R * r0, 0, Math.PI * 2, true);
    ctx.fillStyle = color;
    ctx.fill();
  };
  ring(0.375, 1, tk['--groove-mark']);
  ring(0.62, 0.64, tk['--groove-mark-2']);
  ring(0.8, 0.82, tk['--groove-mark-2']);
  ctx.beginPath();
  ctx.arc(dcx, cy, R * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = tk['--ink'];
  ctx.fill();
  ctx.restore();
  x += d + gap;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.text;
  ctx.fillText('Album', x, cy + size * 0.04);
  const g = ctx.createLinearGradient(x + wAlbum, cy - size / 2, x + wAlbum + wMania, cy + size / 2);
  g.addColorStop(0, tk['--r-legendary']);
  g.addColorStop(0.55, tk['--r-ultra']);
  g.addColorStop(1, tk['--r-promo']);
  ctx.fillStyle = g;
  ctx.fillText('Mania', x + wAlbum, cy + size * 0.04);
}

const PROVIDER_NAMES = { deezer: 'Deezer', spotify: 'Spotify' };

/** Texte d'attribution par défaut, dans la langue de la page, avec les plateformes des pochettes dessinées. */
function defaultAttribution(sources) {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'fr';
  const names = [...new Set(sources.filter((s) => s?.real).map((s) => PROVIDER_NAMES[s.provider] || PROVIDER_NAMES.deezer))];
  return `${lang === 'en' ? 'Covers: ' : 'Pochettes : '}${(names.length ? names : [PROVIDER_NAMES.deezer]).join(', ')}`;
}

/** Blocs (Taste Match, Rétro…) : chiffre, texte, barres. Renvoie la hauteur occupée ; `dry` : mesure sans dessiner. */
function drawBlocks(ctx, blocks, x, y, w, W, pal, tk, dry = false) {
  let h = 0;
  for (const b of blocks || []) {
    if (!b) continue;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if (b.kind === 'stat') {
      const size = W * 0.16;
      if (!dry) {
        const value = String(b.value ?? '');
        setFont(ctx, { weight: 900, size, family: tk['--font-display'], stretch: true, spacing: -0.02 });
        ctx.fillStyle = pal.text;
        ctx.fillText(value, x, y + h + size * 0.82);
        const vw = ctx.measureText(value).width;
        setFont(ctx, { weight: 600, size: W * 0.032, family: tk['--font-body'] });
        ctx.fillStyle = pal.muted;
        wrap(ctx, b.label, Math.max(W * 0.2, w - vw - W * 0.03), 2)
          .forEach((l, i) => ctx.fillText(l, x + vw + W * 0.03, y + h + size * 0.45 + i * W * 0.042));
      }
      h += size + W * 0.03;
    } else if (b.kind === 'text') {
      setFont(ctx, { weight: 600, size: W * 0.034, family: tk['--font-body'] });
      const lines = wrap(ctx, b.text, w, 3);
      if (!dry) {
        ctx.fillStyle = pal.muted;
        lines.forEach((l, i) => ctx.fillText(l, x, y + h + W * 0.034 + i * W * 0.046));
      }
      h += lines.length * W * 0.046 + W * 0.02;
    } else if (b.kind === 'bars') {
      for (const it of (b.items || []).slice(0, 5)) {
        if (!dry) {
          setFont(ctx, { weight: 600, size: W * 0.028, family: tk['--font-body'] });
          ctx.fillStyle = pal.text;
          ctx.fillText(ellipsis(ctx, String(it.label || ''), w * 0.36), x, y + h + W * 0.03);
          const bx = x + w * 0.4;
          const bw = w * 0.6;
          const v = Math.min(1, Math.max(0, Number(it.value) || 0));
          ctx.fillStyle = pal.rule;
          roundRect(ctx, bx, y + h + W * 0.012, bw, W * 0.02, W * 0.01);
          ctx.fill();
          ctx.fillStyle = tk['--r-rare'];
          roundRect(ctx, bx, y + h + W * 0.012, Math.max(W * 0.02, bw * v), W * 0.02, W * 0.01);
          ctx.fill();
        }
        h += W * 0.05;
      }
      h += W * 0.01;
    }
  }
  return h;
}

/** Compose l'image sur `canvas` ; `sources[i]` : image de la vignette i. Renvoie true si une vraie pochette y est. */
function compose(canvas, spec, tiles, sources, tk) {
  const [W, H] = FORMATS[spec.format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const pal = palette(spec.theme, tk);
  drawBackground(ctx, W, H, pal);
  const story = spec.format === 'story';
  const pad = W * 0.08;
  const cw = W - pad * 2;
  const usedCovers = sources.some((s) => s?.real);
  const single = tiles.length === 1;
  const withLabels = !single && tiles.some((t) => t && (t.label || t.sub));

  // Pied : logo centré sur un filet ; attribution discrète au-dessus quand une vraie pochette est dessinée.
  const logoSize = W * 0.056;
  const footH = logoSize * 1.18 + W * 0.04;
  const footTop = H - pad * (story ? 1.4 : 0.75) - footH;
  ctx.fillStyle = pal.rule;
  ctx.fillRect(pad, footTop, cw, Math.max(1, W * 0.0012));
  drawLogo(ctx, W / 2, footTop + W * 0.04 + (logoSize * 1.18) / 2, logoSize, pal, tk);
  if (usedCovers) {
    setFont(ctx, { weight: 500, size: W * 0.019, family: tk['--font-mono'] });
    ctx.fillStyle = pal.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(spec.attribution || defaultAttribution(sources), W - pad, footTop - W * 0.016);
  }
  const bottom = footTop - W * (usedCovers ? 0.06 : 0.04);

  if (single) {
    // Une pochette : grande, centrée, titre et sous-titre dessous (moment de complétion, carte d'un album).
    setFont(ctx, { weight: 800, size: W * 0.07, family: tk['--font-display'], stretch: true, spacing: -0.02 });
    const titleLines = wrap(ctx, spec.title, cw, 2);
    const titleH = titleLines.length * W * 0.078;
    const subH = spec.subtitle ? W * 0.05 : 0;
    const blocksH = drawBlocks(ctx, spec.blocks, pad, 0, cw, W, pal, tk, true);
    const avail = bottom - pad - titleH - subH - blocksH - W * 0.06;
    const s = Math.max(W * 0.3, Math.min(cw * 0.82, avail));
    const total = s + W * 0.06 + titleH + subH + blocksH;
    let y = pad + Math.max(0, (bottom - pad - total) / 2);
    drawTile(ctx, (W - s) / 2, y, s, sources[0], tiles[0], pal, W);
    y += s + W * 0.06;
    setFont(ctx, { weight: 800, size: W * 0.07, family: tk['--font-display'], stretch: true, spacing: -0.02 });
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    titleLines.forEach((l, i) => ctx.fillText(l, W / 2, y + W * 0.06 + i * W * 0.078));
    y += titleH;
    if (spec.subtitle) {
      setFont(ctx, { weight: 600, size: W * 0.034, family: tk['--font-body'] });
      ctx.fillStyle = pal.muted;
      ctx.fillText(ellipsis(ctx, spec.subtitle, cw), W / 2, y + W * 0.04);
      y += subH;
    }
    drawBlocks(ctx, spec.blocks, pad, y + W * 0.02, cw, W, pal, tk);
    return usedCovers;
  }

  // En-tête : titre (Archivo 800, 2 lignes au plus) et sous-titre (« @pseudo ») en mono, à droite s'il tient, sinon
  // dessous ; plus petit en carré, où la hauteur manque (le sous-titre y tient alors plus souvent sur la même ligne).
  const square = spec.format === 'square';
  const titleSize = W * (square ? 0.064 : 0.084);
  const subSize = W * 0.034;
  setFont(ctx, { weight: 600, size: subSize, family: tk['--font-mono'] });
  const subW = spec.subtitle ? ctx.measureText(spec.subtitle).width : 0;
  setFont(ctx, { weight: 800, size: titleSize, family: tk['--font-display'], stretch: true, spacing: -0.02 });
  const inline = !!spec.subtitle && subW <= cw * 0.36 && ctx.measureText(spec.title).width <= cw - subW - W * 0.035;
  const titleLines = wrap(ctx, spec.title, inline ? cw - subW - W * 0.035 : cw, 2);
  // Sous-titre dessous : sa ligne de base laisse passer les jambages du titre.
  const subBelow = titleLines.length * titleSize * 1.04 + subSize * 1.2;
  const headH = spec.subtitle && !inline ? subBelow + subSize * 0.35 : titleLines.length * titleSize * 1.04;
  const blocksH = drawBlocks(ctx, spec.blocks, pad, 0, cw, W, pal, tk, true);

  // Grille : 2 colonnes jusqu'à 4 vignettes, 3 jusqu'à 9, 4 au-delà ; libellés sous les pochettes si demandés, à
  // une taille qui suit celle des pochettes (bornée pour rester lisible) : la place des libellés dépend donc de la
  // taille des pochettes, et réciproquement. La plus grande taille qui tient est cherchée par dichotomie.
  const n = tiles.length;
  const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const gap = W * 0.024;
  const gapTop = W * (square ? 0.035 : 0.05);
  const availH = bottom - pad - headH - blocksH - gapTop;
  const fonts = (sz) => ({
    label: Math.min(W * 0.026, Math.max(W * 0.017, sz * 0.115)),
    sub: Math.min(W * 0.022, Math.max(W * 0.015, sz * 0.1)),
  });
  const labelOf = (sz) => {
    if (!withLabels) return 0;
    const f = fonts(sz);
    return W * 0.012 + f.label * 1.3 + f.sub * 1.3;
  };
  const needH = (sz) => rows * (sz + labelOf(sz)) + (rows - 1) * gap;
  let s = (cw - gap * (cols - 1)) / cols;
  if (needH(s) > availH) {
    let lo = W * 0.08;
    let hi = s;
    for (let i = 0; i < 24 && hi - lo > 0.5; i++) {
      const mid = (lo + hi) / 2;
      if (needH(mid) <= availH) lo = mid;
      else hi = mid;
    }
    s = lo;
  }
  const labelH = labelOf(s);
  const font = fonts(s);
  const gridW = cols * s + (cols - 1) * gap;
  const content = headH + blocksH + gapTop + needH(s);
  // Story : le bloc est centré verticalement ; sinon il part du haut.
  let y = story ? pad + Math.max(0, (bottom - pad - content) / 2) : pad;

  ctx.fillStyle = pal.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // Un bloc « text » mesuré à blanc a pu changer ctx.font : la police du titre est remise avant de l'écrire.
  setFont(ctx, { weight: 800, size: titleSize, family: tk['--font-display'], stretch: true, spacing: -0.02 });
  titleLines.forEach((l, i) => ctx.fillText(l, pad, y + titleSize * 0.86 + i * titleSize * 1.04));
  if (spec.subtitle) {
    setFont(ctx, { weight: 600, size: subSize, family: tk['--font-mono'] });
    ctx.fillStyle = pal.muted;
    if (inline) {
      ctx.textAlign = 'right';
      ctx.fillText(spec.subtitle, W - pad, y + titleSize * 0.86);
      ctx.textAlign = 'left';
    } else {
      ctx.fillText(ellipsis(ctx, spec.subtitle, cw), pad, y + subBelow);
    }
  }
  y += headH;
  if (blocksH) {
    drawBlocks(ctx, spec.blocks, pad, y + W * 0.03, cw, W, pal, tk);
    y += blocksH;
  }
  y += gapTop;
  // Grille plus petite que la place (carré avec titres) : centrée entre l'en-tête et le pied.
  if (!story) y += Math.max(0, availH - needH(s)) / 2;
  const x0 = (W - gridW) / 2;
  tiles.forEach((tile, i) => {
    const tx = x0 + (i % cols) * (s + gap);
    const ty = y + Math.floor(i / cols) * (s + labelH + gap);
    drawTile(ctx, tx, ty, s, sources[i], tile, pal, W);
    if (withLabels && tile) {
      setFont(ctx, { weight: 700, size: font.label, family: tk['--font-body'] });
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const y1 = ty + s + W * 0.008 + font.label * 1.05;
      ctx.fillText(ellipsis(ctx, tile.label || '', s), tx, y1);
      if (tile.sub) {
        setFont(ctx, { weight: 600, size: font.sub, family: tk['--font-body'] });
        ctx.fillStyle = pal.muted;
        ctx.fillText(ellipsis(ctx, tile.sub, s), tx, y1 + font.sub * 1.3);
      }
    }
  });
  return usedCovers;
}

/** PNG du canvas ; rejette (SecurityError) si le canvas est sali. */
function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('export_failed'))), 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

/** Spécification nettoyée : format, thème, vignettes (25 au plus) ; lève `invalid_spec` sinon. */
function checkSpec(spec) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.tiles) || !spec.tiles.length) {
    const err = new Error('invalid_spec');
    err.code = 'invalid_spec';
    throw err;
  }
  return {
    ...spec,
    format: FORMATS[spec.format] ? spec.format : 'portrait',
    theme: THEMES.includes(spec.theme) ? spec.theme : 'ink',
    title: String(spec.title || ''),
    subtitle: spec.subtitle ? String(spec.subtitle) : '',
    tiles: spec.tiles.slice(0, MAX_TILES),
  };
}

/**
 * Compose l'image d'une spécification. `options.covers` : pochettes connues du site (useCovers()) ; `options.realCovers`
 * false : visuels générés seulement (SHARE_COVERS=off). Ne rejette que pour une spécification invalide ou un navigateur
 * sans canvas : un problème de pochette ne fait jamais échouer l'export.
 */
export async function renderImage(rawSpec, { covers = { items: {}, broken: new Set() }, realCovers = true } = {}) {
  const spec = checkSpec(rawSpec);
  // Rien n'est rendu avant une première attente : jamais pendant le rendu ou l'effet React qui l'appelle.
  await loadFonts();
  const tk = tokens();
  const tiles = await resolveTiles(spec.tiles);
  let sources = await Promise.all(tiles.map((t) => (t ? tileSource(t, { covers, realCovers }) : null)));
  const canvas = document.createElement('canvas');
  let usedCovers = compose(canvas, spec, tiles, sources, tk);
  let blob;
  try {
    blob = await toBlob(canvas);
  } catch {
    // Canvas sali malgré le contrôle (en-têtes CORS changeants) : on recompose avec les visuels générés seulement.
    sources = await Promise.all(tiles.map((t) => (t ? tileSource(t, { covers, realCovers: false }) : null)));
    usedCovers = compose(canvas, spec, tiles, sources, tk);
    blob = await toBlob(canvas);
  }
  return { blob, usedCovers, width: canvas.width, height: canvas.height };
}

export default renderImage;
