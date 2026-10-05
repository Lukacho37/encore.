import { memo, useRef } from 'react';
import CoverArt from './CoverArt.jsx';
import { TRACK_BY_ID, ARTIST_BY_ID, artFor, catalogCode } from '@shared/catalog.js';
import { RARITY } from '@shared/rules.js';
import { useI18n } from '../i18n/index.jsx';
import { useCovers } from '../state/CoversContext.jsx';

const pad = (n) => String(n).padStart(2, '0');

/** Petites barres de signal : indice de popularité du morceau. */
export function PopIcon() {
  return (
    <svg className="pop-icon" viewBox="0 0 12 10" aria-hidden="true">
      <rect x="0" y="6" width="2.4" height="4" rx="0.6" />
      <rect x="3.2" y="4" width="2.4" height="6" rx="0.6" />
      <rect x="6.4" y="2" width="2.4" height="8" rx="0.6" />
      <rect x="9.6" y="0" width="2.4" height="10" rx="0.6" />
    </svg>
  );
}

/** Pastille de rareté : rond de couleur, étoile pour les légendaires, carré rouge pour les promos. */
export function RarityGem({ rarity, size = 12 }) {
  const color = RARITY[rarity].color;
  if (rarity === 'legendary') {
    return (
      <svg className="gem" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 1.8l3.1 6.4 7 .9-5.1 4.8 1.3 7-6.3-3.4-6.3 3.4 1.3-7L1.9 9.1l7-.9z" fill={color} stroke="#7a5a12" strokeWidth="1" />
      </svg>
    );
  }
  if (rarity === 'promo') {
    return (
      <svg className="gem" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="4" fill={color} />
      </svg>
    );
  }
  return (
    <svg className="gem" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" fill={color} stroke="rgba(0,0,0,.35)" strokeWidth="1" />
      <circle cx="9" cy="8.5" r="3" fill="#fff" opacity="0.35" />
    </svg>
  );
}

export function Pips({ rarity }) {
  return (
    <span className="pips" style={{ '--rc': RARITY[rarity].color }}>
      <RarityGem rarity={rarity} size={10} />
    </span>
  );
}

/** Inclinaison 3D + reflet holo qui suit le pointeur. */
export function useTilt(strength = 14) {
  const ref = useRef(null);
  const onPointerMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--mx', `${x * 100}%`);
    el.style.setProperty('--my', `${y * 100}%`);
    el.style.setProperty('--rx', `${(0.5 - y) * strength}deg`);
    el.style.setProperty('--ry', `${(x - 0.5) * strength}deg`);
  };
  const onPointerLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };
  return { ref, onPointerMove, onPointerLeave };
}

function Card({ trackId, variant = 'std', count = 0, ghost = false, badge, badgeTone, onClick, className = '', tilt = false, artSizes, children }) {
  const { t } = useI18n();
  const covers = useCovers();
  const track = TRACK_BY_ID[trackId];
  const tiltProps = useTilt();
  if (!track) return null;
  const artist = ARTIST_BY_ID[track.artistId];
  const holo = variant === 'holo' && !ghost;
  const art = artFor(track);
  // Une carte non obtenue garde le visuel généré : la vraie pochette se révèle quand on l'obtient.
  const realCover = !ghost && !!covers.items[art.seed];
  // Sur une vraie pochette, « Nouveau » et le nombre d'exemplaires vont dans le pied de carte.
  const footTags = realCover && (!!badge || count > 1);
  const Tag = onClick ? 'button' : 'div';
  const number = track.kind === 'promo' ? `P${pad(track.n)}` : `${pad(track.n)}/${pad(track.total)}`;

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`card card--${track.rarity}${holo ? ' card--holo' : ''}${ghost ? ' card--ghost' : ''}${realCover ? ' card--cover' : ''}${tilt ? ' card--tilt' : ''} ${className}`}
      style={{ '--rc': RARITY[track.rarity].color }}
      onClick={onClick}
      aria-label={`${track.title} · ${artist.name} · ${t(`rarity.${track.rarity}`)}${holo ? ` · ${t('card.holo')}` : ''}`}
      {...(tilt ? tiltProps : {})}
    >
      <span className="card__inner">
        <span className="card__top">
          <span className="card__num">{number}</span>
          <Pips rarity={track.rarity} />
        </span>
        <span className="card__art">
          <CoverArt art={art} generated={ghost} sizes={artSizes} />
          {ghost && <span className="card__ghost-mark">?</span>}
        </span>
        <span className="card__body">
          <span className="card__title">{track.title}</span>
          <span className="card__artist">
            {artist.name}
            {track.feat ? <span className="card__feat"> · feat. {track.feat}</span> : null}
          </span>
        </span>
        <span className={`card__foot${footTags ? ' card__foot--tags' : ''}`}>
          <span className="card__rarity" title={t(`rarity.${track.rarity}`)}>
            {realCover && <RarityGem rarity={track.rarity} size={9} />}
            {t(`rarity.${track.rarity}`)}
          </span>
          {footTags && (
            <span className="card__foot-tags">
              {badge && <span className={`card__tag${badgeTone ? ` card__tag--${badgeTone}` : ''}`}>{badge}</span>}
              {count > 1 && <span className="card__tag card__tag--count">×{count}</span>}
            </span>
          )}
          {track.pop != null
            ? <span className="card__pop" title={`${t('card.popularity')} ${track.pop}/100`}><PopIcon />{track.pop}</span>
            : <span className="card__code">{catalogCode(track)}</span>}
        </span>
      </span>
      {holo && <span className="card__holo" aria-hidden="true" />}
      {track.kind === 'promo' && !ghost && !realCover && <span className="card__ribbon" aria-hidden="true">PROMO</span>}
      {badge && !realCover && <span className={`card__badge${badgeTone ? ` card__badge--${badgeTone}` : ''}`}>{badge}</span>}
      {count > 1 && !realCover && <span className="card__count">×{count}</span>}
      {children}
    </Tag>
  );
}

export default memo(Card);

export function CardBack({ rarity, className = '' }) {
  return (
    <span className={`card card-back card-back--${rarity} ${className}`} style={{ '--rc': RARITY[rarity]?.color }} aria-hidden="true">
      <span className="card-back__face">
        <span className="card-back__grooves" />
        <span className="card-back__label" />
        <span className="card-back__logo">
          Album<span>Mania</span>
        </span>
      </span>
    </span>
  );
}
