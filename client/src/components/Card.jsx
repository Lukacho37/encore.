import { memo, useRef } from 'react';
import CoverArt from './CoverArt.jsx';
import { TRACK_BY_ID, ARTIST_BY_ID, artFor, catalogCode } from '@shared/catalog.js';
import { RARITY } from '@shared/rules.js';
import { useI18n } from '../i18n/index.jsx';

const pad = (n) => String(n).padStart(2, '0');

export function Pips({ rarity }) {
  if (rarity === 'promo') return <span className="pips pips--promo">P</span>;
  if (rarity === 'legendary') return <span className="pips pips--legend">★</span>;
  return <span className="pips">{'◆'.repeat(RARITY[rarity].pips)}</span>;
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

function Card({ trackId, variant = 'std', count = 0, ghost = false, badge, badgeTone, onClick, className = '', tilt = false, children }) {
  const { t } = useI18n();
  const track = TRACK_BY_ID[trackId];
  const tiltProps = useTilt();
  if (!track) return null;
  const artist = ARTIST_BY_ID[track.artistId];
  const holo = variant === 'holo' && !ghost;
  const Tag = onClick ? 'button' : 'div';
  const number = track.kind === 'promo' ? `P${pad(track.n)}` : `${pad(track.n)}/${pad(track.total)}`;

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`card card--${track.rarity}${holo ? ' card--holo' : ''}${ghost ? ' card--ghost' : ''}${tilt ? ' card--tilt' : ''} ${className}`}
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
          <CoverArt art={artFor(track)} />
          {ghost && <span className="card__ghost-mark">?</span>}
        </span>
        <span className="card__body">
          <span className="card__title">{track.title}</span>
          <span className="card__artist">
            {artist.name}
            {track.feat ? <span className="card__feat"> · feat. {track.feat}</span> : null}
          </span>
        </span>
        <span className="card__foot">
          <span className="card__rarity">{t(`rarity.${track.rarity}`)}</span>
          <span className="card__code">{catalogCode(track)}</span>
        </span>
      </span>
      {holo && <span className="card__holo" aria-hidden="true" />}
      {track.kind === 'promo' && !ghost && <span className="card__ribbon" aria-hidden="true">PROMO</span>}
      {badge && <span className={`card__badge${badgeTone ? ` card__badge--${badgeTone}` : ''}`}>{badge}</span>}
      {count > 1 && <span className="card__count">×{count}</span>}
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
        <span className="card-back__logo">
          encore<span>.</span>
        </span>
      </span>
    </span>
  );
}
