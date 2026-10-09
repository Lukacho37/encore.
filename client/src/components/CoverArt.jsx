import { memo, useId } from 'react';
import { useCovers, realCover } from '../state/CoversContext.jsx';

// Pochette d'un album ou d'un single.
// - Vraie pochette quand le serveur en a trouvé une (Deezer, ou Spotify si les clés sont configurées) : l'image reste
//   hébergée par la plateforme, affichée telle quelle, sans recadrage ni filtre. Décision du propriétaire
//   (DECISION-DESIGN.md, point 5) : vraies pochettes partout, photo de profil « album complété » comprise.
// - Sinon, visuel original généré à partir d'une palette et d'un motif propres à chaque album : repli (pochette
//   indisponible ou retirée) et cartes pas encore obtenues (`generated`), dont la vraie pochette se révèle à l'obtention.
//
// Règles des pochettes (PLAN.md 7.1, à respecter partout où une vraie pochette s'affiche) :
// - l'image est liée depuis le CDN de la plateforme, jamais téléchargée, mise en cache, relayée ni réhébergée par
//   le serveur ;
// - redimensionnement seulement : pas de recadrage au-delà d'une source carrée, pas de filtre, pas de fondu, rien posé
//   sur l'image (reflet holo, pastilles de rareté, « Nouveau », ruban PROMO vont sur le cadre de la carte) ;
// - pochette retirée par l'admin (`art.coverBlocked`, demande de retrait) : visuel généré partout à la fois.

function seededRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

function motif(kind, [c0, c1, c2], rand, id) {
  const els = [];
  switch (kind) {
    case 'bars': {
      for (let i = 0; i < 9; i++) {
        const h = 18 + rand() * 62;
        const x = 6 + i * 10;
        els.push(<rect key={i} x={x} y={88 - h} width="7" height={h} rx="1" fill={c1} opacity={0.75 + rand() * 0.25} />);
        els.push(<rect key={`c${i}`} x={x} y={84 - h} width="7" height="2.4" rx="1" fill={c2} />);
      }
      els.push(<rect key="base" x="4" y="90" width="92" height="1.2" fill={c2} opacity="0.6" />);
      break;
    }
    case 'rings': {
      for (let r = 47; r > 15; r -= 2.6) {
        els.push(<circle key={r} cx="50" cy="50" r={r} fill="none" stroke={c1} strokeWidth="0.7" opacity={0.25 + rand() * 0.5} />);
      }
      els.push(<circle key="label" cx="50" cy="50" r="14" fill={c2} />);
      els.push(<circle key="label2" cx="50" cy="50" r="9" fill="none" stroke={c1} strokeWidth="0.8" opacity="0.6" />);
      els.push(<circle key="hole" cx="50" cy="50" r="1.6" fill={c0} />);
      break;
    }
    case 'sun': {
      els.push(<rect key="ground" x="0" y="74" width="100" height="26" fill={c2} opacity="0.9" />);
      els.push(<circle key="sun" cx="50" cy="60" r="30" fill={c1} />);
      for (let i = 0; i < 6; i++) {
        const y = 58 + i * 4.2;
        els.push(<rect key={i} x="10" y={y} width="80" height={0.6 + i * 0.55} fill={c0} />);
      }
      els.push(<rect key="ground2" x="0" y="80" width="100" height="20" fill={c2} />);
      break;
    }
    case 'grid': {
      const fills = [c1, c2, c1, 'none'];
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const f = fills[Math.floor(rand() * fills.length)];
          if (f === 'none') continue;
          els.push(<rect key={`${x}-${y}`} x={5 + x * 18.4} y={5 + y * 18.4} width="15.6" height="15.6" rx="1.5" fill={f} opacity={0.55 + rand() * 0.45} />);
        }
      }
      break;
    }
    case 'shards': {
      for (let i = 0; i < 8; i++) {
        const pts = Array.from({ length: 3 }, () => `${r1(rand() * 110 - 5)},${r1(rand() * 110 - 5)}`).join(' ');
        els.push(<polygon key={i} points={pts} fill={i % 2 ? c1 : c2} opacity={0.55 + rand() * 0.4} />);
      }
      break;
    }
    case 'split': {
      els.push(<polygon key="half" points="0,0 100,0 0,100" fill={c1} />);
      els.push(<line key="cut" x1="100" y1="0" x2="0" y2="100" stroke={c2} strokeWidth="1.4" />);
      els.push(<circle key="dot" cx={r1(55 + rand() * 25)} cy={r1(55 + rand() * 25)} r={r1(8 + rand() * 8)} fill={c2} />);
      els.push(<rect key="tag" x="8" y="10" width={r1(20 + rand() * 20)} height="3" fill={c0} />);
      break;
    }
    case 'curtain': {
      for (let i = 0; i < 10; i++) {
        els.push(<rect key={i} x={i * 10} y="0" width="10" height="82" fill={`url(#${id}-fold)`} />);
      }
      els.push(<path key="valance" d="M0 0 H100 V10 Q75 18 50 10 Q25 18 0 10 Z" fill={c1} />);
      els.push(<rect key="floor" x="0" y="82" width="100" height="18" fill={c2} />);
      els.push(<ellipse key="spot" cx="50" cy="86" rx="22" ry="5" fill="#fff" opacity="0.25" />);
      break;
    }
    case 'halftone': {
      const fx = 30 + rand() * 40;
      const fy = 30 + rand() * 40;
      for (let y = 0; y < 11; y++) {
        for (let x = 0; x < 11; x++) {
          const cx = 5 + x * 9;
          const cy = 5 + y * 9;
          const d = Math.hypot(cx - fx, cy - fy);
          const r = Math.max(0.4, 4.2 - d / 14);
          els.push(<circle key={`${x}-${y}`} cx={cx} cy={cy} r={r1(r)} fill={c1} />);
        }
      }
      els.push(<rect key="frame" x="3" y="3" width="94" height="94" fill="none" stroke={c2} strokeWidth="2.2" />);
      break;
    }
    case 'spotlight': {
      els.push(<polygon key="cone" points="42,0 58,0 92,100 8,100" fill={`url(#${id}-cone)`} />);
      els.push(<ellipse key="pool" cx="50" cy="90" rx="34" ry="7" fill={c2} opacity="0.55" />);
      els.push(<circle key="fig" cx="50" cy="62" r="13" fill={c1} />);
      els.push(<rect key="fig2" x="41" y="72" width="18" height="18" rx="6" fill={c1} />);
      break;
    }
    case 'waves': {
      for (let i = 0; i < 7; i++) {
        const y = 22 + i * 10;
        const a = 4 + rand() * 5;
        const ph = rand() * 20;
        els.push(
          <path key={i} d={`M-5 ${y} Q ${15 + ph} ${y - a} 30 ${y} T 65 ${y} T 105 ${y}`} fill="none"
            stroke={i % 3 === 0 ? c2 : c1} strokeWidth="2.6" strokeLinecap="round" opacity={0.5 + rand() * 0.5} />,
        );
      }
      break;
    }
    case 'dots': {
      for (let i = 0; i < 22; i++) {
        els.push(<circle key={i} cx={r1(rand() * 100)} cy={r1(rand() * 100)} r={r1(1.5 + rand() * 9)} fill={i % 4 ? c1 : c2} opacity={0.6 + rand() * 0.4} />);
      }
      break;
    }
    case 'stripes': {
      els.push(<rect key="road" x="0" y="45" width="100" height="55" fill={c0} />);
      for (let i = 0; i < 6; i++) {
        const x = 6 + i * 16;
        els.push(<polygon key={i} points={`${x},52 ${x + 8},52 ${x + 11},96 ${x - 3},96`} fill={c1} />);
      }
      els.push(<rect key="sky" x="0" y="0" width="100" height="45" fill={c2} opacity="0.85" />);
      els.push(<rect key="hz" x="0" y="44" width="100" height="1.4" fill={c1} opacity="0.7" />);
      break;
    }
    case 'orbit': {
      for (let i = 0; i < 3; i++) {
        const rx = 18 + i * 13;
        const rot = rand() * 180;
        els.push(<ellipse key={`o${i}`} cx="50" cy="50" rx={rx} ry={rx * 0.42} fill="none" stroke={c1} strokeWidth="0.8" opacity="0.7" transform={`rotate(${r1(rot)} 50 50)`} />);
        const ang = rand() * Math.PI * 2;
        const px = 50 + Math.cos(ang) * rx;
        const py = 50 + Math.sin(ang) * rx * 0.42;
        els.push(<circle key={`p${i}`} cx={r1(px)} cy={r1(py)} r={r1(2 + rand() * 2.5)} fill={c2} transform={`rotate(${r1(rot)} 50 50)`} />);
      }
      els.push(<circle key="core" cx="50" cy="50" r="10" fill={c1} />);
      break;
    }
    case 'arcs': {
      for (let i = 0; i < 9; i++) {
        const r = 16 + i * 13;
        els.push(<path key={i} d={`M0 ${100 - r} A ${r} ${r} 0 0 1 ${r} 100`} fill="none" stroke={i % 2 ? c2 : c1} strokeWidth="4.2" opacity={0.6 + rand() * 0.4} />);
      }
      break;
    }
    case 'burst': {
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 0.5) / n) * Math.PI * 2;
        els.push(
          <polygon key={i} points={`50,50 ${r1(50 + Math.cos(a0) * 80)},${r1(50 + Math.sin(a0) * 80)} ${r1(50 + Math.cos(a1) * 80)},${r1(50 + Math.sin(a1) * 80)}`}
            fill={i % 2 ? c1 : c2} opacity="0.9" />,
        );
      }
      els.push(<circle key="core" cx="50" cy="50" r="13" fill={c0} />);
      els.push(<circle key="core2" cx="50" cy="50" r="6" fill={c2} />);
      break;
    }
    case 'diamond': {
      for (let i = 0; i < 6; i++) {
        const s = 46 - i * 7.5;
        els.push(<polygon key={i} points={`50,${50 - s} ${50 + s},50 50,${50 + s} ${50 - s},50`} fill={[c1, c0, c2][i % 3]} />);
      }
      break;
    }
    case 'checker': {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if ((x + y) % 2) els.push(<rect key={`${x}-${y}`} x={x * 12.5} y={y * 12.5} width="12.5" height="12.5" fill={c1} opacity={0.75 + rand() * 0.25} />);
        }
      }
      els.push(<circle key="c" cx="50" cy="50" r="18" fill={c2} />);
      els.push(<circle key="c2" cx="50" cy="50" r="18" fill="none" stroke={c0} strokeWidth="3" />);
      break;
    }
    default:
      break;
  }
  return els;
}

/**
 * Vraie pochette affichée pour ce visuel, ou null (visuel généré) : celle de realCover(), sauf si l'admin l'a retirée
 * (`art.coverBlocked`). Les composants qui changent de mise en page selon la pochette (carte, vignette) passent par ici.
 */
export function shownCover(art, covers) {
  if (!art || art.coverBlocked) return null;
  return realCover(art, covers);
}

function CoverArt({ art, className = '', title, generated = false, sizes = '160px' }) {
  const id = useId().replace(/:/g, '');
  const covers = useCovers();
  const real = generated ? null : shownCover(art, covers);
  if (real) {
    const srcSet = real.thumb && real.thumb !== real.cover && real.thumbW && real.coverW
      ? `${real.thumb} ${real.thumbW}w, ${real.cover} ${real.coverW}w`
      : undefined;
    return (
      <img className={`cover cover--real ${className}`} src={real.thumb || real.cover} srcSet={srcSet} sizes={srcSet ? sizes : undefined}
        alt={title || ''} loading="lazy" decoding="async" draggable="false" onError={() => covers.markBroken(art.seed)} />
    );
  }
  const rand = seededRandom(art.seed || art.motif);
  const [c0, c1, c2] = art.palette;
  return (
    <svg className={`cover ${className}`} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`${id}-fold`} x1="0" x2="1">
          <stop offset="0" stopColor={c1} stopOpacity="0.55" />
          <stop offset="0.5" stopColor={c1} />
          <stop offset="1" stopColor={c1} stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id={`${id}-cone`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={c2} stopOpacity="0.85" />
          <stop offset="1" stopColor={c2} stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={c0} />
      {motif(art.motif, art.palette, rand, id)}
      <rect width="100" height="100" fill={`url(#${id}-sheen)`} />
    </svg>
  );
}

export default memo(CoverArt, (a, b) => a.art.seed === b.art.seed && a.art.cover === b.art.cover && a.art.coverBlocked === b.art.coverBlocked && a.className === b.className
  && a.generated === b.generated && a.title === b.title && a.sizes === b.sizes);
