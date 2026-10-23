// Graphiques du passeport et du Rétro — chantier P2-A (PLAN.md 9.5) : barres et colonnes en SVG simple, sans
// bibliothèque, dessinées avec les jetons de app.css (couleurs passées en var(--…), textes en couleurs de texte).
//   <HBars items label />          barres horizontales : libellé | barre | valeur (chaque valeur est écrite) ;
//   <Columns points label color /> colonnes (mois, décennies, notes) : graduations discrètes, valeur du maximum écrite,
//                                  infobulle au survol et au clavier (← →), tableau pour les lecteurs d'écran ;
//   <StackedBars rows legend />    barres empilées à 100 % (évolution des goûts) : légende, parts écrites dans les
//                                  segments assez larges, infobulle au survol et au clavier, tableau caché.
// Règles de dessin (méthode « dataviz ») : barres de 24 px au plus, bout arrondi de 4 px côté valeur et carré côté
// base, espace de 2 px entre deux segments, grille en filet de 1 px, texte jamais dans la couleur d'une série.
// La largeur vient du conteneur (ResizeObserver) : les dessins restent nets du téléphone à l'ordinateur.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import '../../styles/passport.css';

const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Largeur (px) d'un élément, suivie au redimensionnement. Renvoie [ref, width]. */
export function useWidth(fallback = 320) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useIsoLayout(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    read();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Graduation « propre » au-dessus de `max` (1, 2, 2,5, 5 × 10ⁿ). */
export function niceMax(max) {
  if (!(max > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * exp >= max) return step * exp;
  return 10 * exp;
}

/** Chemin d'une barre horizontale de [x, x + w] : bout droit arrondi (r), base gauche carrée. */
function hPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

/** Chemin d'une colonne posée sur `base` : haut arrondi (r), base carrée. */
function vPath(x, base, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const top = base - h;
  return `M${x},${base}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${base}Z`;
}

/** Segment d'une barre empilée : coins arrondis seulement aux extrémités de la barre. */
function segPath(x, y, w, h, { left, right }, r = 4) {
  const rl = left ? Math.min(r, w / 2, h / 2) : 0;
  const rr = right ? Math.min(r, w / 2, h / 2) : 0;
  return `M${x + rl},${y}H${x + w - rr}${rr ? `Q${x + w},${y} ${x + w},${y + rr}` : ''}V${y + h - rr}${rr ? `Q${x + w},${y + h} ${x + w - rr},${y + h}` : ''}`
    + `H${x + rl}${rl ? `Q${x},${y + h} ${x},${y + h - rl}` : ''}V${y + rl}${rl ? `Q${x},${y} ${x + rl},${y}` : ''}Z`;
}

/** Infobulle d'un graphique, placée au-dessus du point (x, y) du conteneur, sans déborder sur les côtés. */
function Tip({ x, y, width, children }) {
  if (x == null) return null;
  const left = Math.max(70, Math.min(width - 70, x));
  return (
    <div className="pp-tip" style={{ left, top: y }} aria-hidden="true">{children}</div>
  );
}

// ----- barres horizontales -----------------------------------------------------------------------------------

/**
 * Barres horizontales. `items` : [{ key, label, value, display?, color?, href? }] ; `max` : valeur de la barre pleine
 * (défaut : la plus grande) ; `color` : couleur commune. Chaque valeur est écrite au bout de sa ligne.
 */
export function HBars({ items, max, color = 'var(--r-rare)', label, className = '' }) {
  const [ref, width] = useWidth(160);
  const top = max ?? Math.max(1, ...items.map((i) => i.value || 0));
  const h = 10;
  return (
    <figure className={`pp-chart pp-hbars ${className}`} aria-label={label}>
      <ul className="pp-hbars__list">
        {items.map((it, i) => {
          const w = Math.max(0, width);
          const len = it.value > 0 ? Math.max(3, (w * Math.min(it.value, top)) / top) : 0;
          return (
            <li key={it.key} className="pp-hbars__row">
              <span className="pp-hbars__label" title={it.label}>{it.label}</span>
              <span className="pp-hbars__bar" ref={i === 0 ? ref : undefined}>
                <svg width={w} height={h} aria-hidden="true" focusable="false">
                  <rect className="pp-track" x="0" y="0" width={w} height={h} rx={h / 2} />
                  {len > 0 && <path d={hPath(0, 0, len, h, 4)} style={{ fill: it.color || color }} />}
                </svg>
              </span>
              <span className="pp-hbars__value mono">{it.display ?? it.value}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

// ----- colonnes ----------------------------------------------------------------------------------------------

/**
 * Colonnes. `points` : [{ key, label, short?, value, tip? }] (`short` : libellé sous la colonne) ; `format(v)` : valeur
 * écrite ; `empty` : texte affiché quand tout vaut 0. Survol et flèches du clavier : infobulle de la colonne.
 */
export function Columns({ points, color = 'var(--cue)', label, format = (v) => String(v), height = 168, empty, className = '' }) {
  const [ref, width] = useWidth(320);
  const [active, setActive] = useState(null);
  const id = useId();
  const n = points.length;
  const max = Math.max(0, ...points.map((p) => p.value || 0));
  const top = niceMax(max);
  const pad = { l: 34, r: 6, t: 22, b: 24 };
  const plotW = Math.max(40, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const band = plotW / Math.max(1, n);
  const barW = Math.max(4, Math.min(24, band * 0.62));
  const base = pad.t + plotH;
  const every = band >= 30 ? 1 : band >= 16 ? 2 : 3;
  const maxIndex = max > 0 ? points.findIndex((p) => p.value === max) : -1;
  const xOf = (i) => pad.l + band * i + band / 2;
  // Graduations : 0, la moitié quand elle tombe juste, le haut.
  const ticks = Number.isInteger(top / 2) && top >= 4 ? [0, top / 2, top] : [0, top];

  const pick = useCallback((clientX) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const i = Math.floor((clientX - box.left - pad.l) / band);
    setActive(i >= 0 && i < n ? i : null);
  }, [band, n, pad.l, ref]);
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      setActive((a) => (a == null ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, a + d))));
    } else if (e.key === 'Escape') setActive(null);
  };
  const cur = active != null ? points[active] : null;
  const tipY = cur ? base - (plotH * (cur.value || 0)) / top - 8 : 0;

  return (
    <figure className={`pp-chart pp-cols ${className}`}>
      <div ref={ref} className="pp-cols__plot" tabIndex={0} role="group" aria-label={label} aria-describedby={`${id}-table`}
        onPointerMove={(e) => pick(e.clientX)} onPointerLeave={() => setActive(null)} onKeyDown={onKey}
        onFocus={() => setActive((a) => (a == null ? Math.max(0, maxIndex) : a))} onBlur={() => setActive(null)}>
        <svg width={width} height={height} aria-hidden="true" focusable="false">
          {ticks.map((v) => {
            const y = base - (plotH * v) / top;
            return (
              <g key={v}>
                <line className="pp-grid" x1={pad.l} x2={width - pad.r} y1={y} y2={y} />
                <text className="pp-axis" x={pad.l - 6} y={y + 4} textAnchor="end">{format(v)}</text>
              </g>
            );
          })}
          {active != null && <rect className="pp-hover" x={pad.l + band * active} y={pad.t - 6} width={band} height={plotH + 6} rx="6" />}
          {points.map((p, i) => {
            const h = (plotH * (p.value || 0)) / top;
            return h > 0 ? <path key={p.key} d={vPath(xOf(i) - barW / 2, base, barW, Math.max(2, h), 4)} style={{ fill: color }} /> : null;
          })}
          {maxIndex >= 0 && active == null && (
            <text className="pp-value" x={xOf(maxIndex)} y={base - (plotH * max) / top - 6} textAnchor="middle">{format(max)}</text>
          )}
          {points.map((p, i) => ((i % every === 0 || i === n - 1) && (n - 1 - i >= every || i === n - 1)
            ? <text key={p.key} className="pp-axis" x={xOf(i)} y={height - 6} textAnchor="middle">{p.short ?? p.label}</text>
            : null))}
        </svg>
        {max === 0 && empty && <p className="pp-cols__empty small muted">{empty}</p>}
        {cur && (
          <Tip x={xOf(active)} y={tipY} width={width}>
            <strong>{cur.label}</strong>
            <span>{cur.tip ?? format(cur.value || 0)}</span>
          </Tip>
        )}
      </div>
      <table className="sr-only" id={`${id}-table`}>
        <caption>{label}</caption>
        <tbody>
          {points.map((p) => <tr key={p.key}><th scope="row">{p.label}</th><td>{p.tip ?? format(p.value || 0)}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}

// ----- barres empilées à 100 % -------------------------------------------------------------------------------

/**
 * Barres empilées à 100 %. `rows` : [{ key, label, total, totalLabel, segments: [{ key, label, value, color }] }] ;
 * `legend` : [{ key, label, color }] ; `percent(share)` : part écrite ; `emptyLabel` : ligne sans donnée.
 */
export function StackedBars({ rows, legend, label, percent, emptyLabel, className = '' }) {
  const [ref, width] = useWidth(240);
  const [active, setActive] = useState(null); // { row, seg }
  const id = useId();
  const h = 22;
  const gap = 2;
  const layout = rows.map((row) => {
    const total = row.segments.reduce((s, x) => s + x.value, 0);
    const shown = row.segments.filter((s) => s.value > 0);
    const usable = Math.max(0, width - gap * Math.max(0, shown.length - 1));
    let x = 0;
    const segs = shown.map((s, i) => {
      const w = total ? (usable * s.value) / total : 0;
      const out = { ...s, x, w, share: total ? s.value / total : 0, left: i === 0, right: i === shown.length - 1 };
      x += w + gap;
      return out;
    });
    return { ...row, total, segs };
  });
  const flat = layout.flatMap((row, r) => row.segs.map((s, k) => ({ r, k })));
  const onKey = (e) => {
    if (!flat.length || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Escape') return setActive(null);
    const at = active ? flat.findIndex((f) => f.r === active.row && f.k === active.seg) : -1;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = flat[Math.max(0, Math.min(flat.length - 1, at < 0 ? (d > 0 ? 0 : flat.length - 1) : at + d))];
    return setActive({ row: next.r, seg: next.k });
  };
  const cur = active ? layout[active.row]?.segs[active.seg] : null;
  return (
    <figure className={`pp-chart pp-stack ${className}`}>
      <ul className="pp-legend" aria-hidden="true">
        {legend.map((l) => <li key={l.key}><span className="pp-swatch" style={{ background: l.color }} />{l.label}</li>)}
      </ul>
      <div className="pp-stack__rows" tabIndex={flat.length ? 0 : -1} role="group" aria-label={label} aria-describedby={`${id}-table`}
        onKeyDown={onKey} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)}>
        {layout.map((row, r) => (
          <div key={row.key} className="pp-stack__row">
            <span className="pp-stack__label mono">{row.label}</span>
            <span className="pp-stack__bar" ref={r === 0 ? ref : undefined}>
              <svg width={width} height={h} aria-hidden="true" focusable="false">
                {!row.total && <rect className="pp-track pp-track--empty" x="0.5" y="0.5" width={Math.max(0, width - 1)} height={h - 1} rx="6" />}
                {row.segs.map((s, k) => (
                  <g key={s.key} onPointerEnter={() => setActive({ row: r, seg: k })}>
                    <path d={segPath(s.x, 0, Math.max(1, s.w), h, s)} style={{ fill: s.color }}
                      className={active && (active.row !== r || active.seg !== k) ? 'pp-dim' : undefined} />
                    {s.w >= 42 && <text className="pp-seg-label" x={s.x + s.w / 2} y={h / 2 + 4} textAnchor="middle">{percent(s.share)}</text>}
                  </g>
                ))}
                {!row.total && <text className="pp-axis" x={10} y={h / 2 + 4}>{emptyLabel}</text>}
              </svg>
              {cur && active.row === r && (
                <Tip x={cur.x + cur.w / 2} y={-6} width={width}>
                  <strong>{cur.label}</strong>
                  <span>{percent(cur.share)} · {cur.tip ?? cur.value}</span>
                </Tip>
              )}
            </span>
            <span className="pp-stack__total small muted">{row.totalLabel}</span>
          </div>
        ))}
      </div>
      <table className="sr-only" id={`${id}-table`}>
        <caption>{label}</caption>
        <tbody>
          {layout.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.segs.length ? row.segs.map((s) => `${s.label} ${percent(s.share)}`).join(', ') : emptyLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
