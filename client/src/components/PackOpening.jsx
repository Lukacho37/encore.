import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import Card, { CardBack } from './Card.jsx';
import CoverArt from './CoverArt.jsx';
import { Icon, Progress, RoyaltyIcon } from './ui.jsx';
import { AchievementList } from './Achievements.jsx';
import { RarityGuideButton } from './RarityGuide.jsx';
import { TRACK_BY_ID, ALBUM_BY_ID } from '@shared/catalog.js';
import { RARITY } from '@shared/rules.js';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { sound } from '../sound.js';

const BIG = new Set(['ultra', 'legendary', 'promo']);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function PackArt({ className = '', label }) {
  const { t } = useI18n();
  return (
    <span className={`pack ${className}`} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined}>
      <span className="pack__top"><span className="pack__crimp" /></span>
      <span className="pack__body">
        <span className="pack__foil" />
        <span className="pack__vinyl" />
        <span className="pack__brand">Album<br /><span>Mania</span></span>
        <span className="pack__label">{t('home.eyebrow')}</span>
        <span className="pack__content">{t('home.content')}</span>
        <span className="pack__series">SÉRIE 01</span>
      </span>
      <span className="pack__bottom"><span className="pack__crimp" /></span>
    </span>
  );
}

/** Petites particules dessinées sur un canvas pour les grosses cartes. */
function useBurst(canvasRef) {
  return useCallback((colors, amount = 90) => {
    const canvas = canvasRef.current;
    if (!canvas || reducedMotion()) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const parts = Array.from({ length: amount }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * 9;
      return {
        x: w / 2, y: h * 0.45,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4,
        size: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: Math.random() < 0.5 ? 'rect' : 'disc',
      };
    });
    const start = performance.now();
    function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.28;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.globalAlpha = Math.max(0, 1 - t / 1800);
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      if (t < 1800) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    }
    requestAnimationFrame(frame);
  }, [canvasRef]);
}

export default function PackOpening({ promise, count = 1, onClose, onAgain }) {
  const { t, num } = useI18n();
  const { owned, applyState, packs, isAdmin } = useGame();
  const [phase, setPhase] = useState('pack'); // pack | shake | tear | reveal | summary
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [leaving, setLeaving] = useState(null);
  const [flash, setFlash] = useState(null);
  const wantOpen = useRef(false);
  const canvasRef = useRef(null);
  const burst = useBurst(canvasRef);
  const multi = count > 1;

  useEffect(() => {
    let alive = true;
    promise
      .then((res) => {
        if (!alive) return;
        setResult(res);
        applyState(res.state);
      })
      .catch((err) => alive && setFailed(err));
    return () => {
      alive = false;
    };
  }, [promise, applyState]);

  const cards = useMemo(() => {
    if (!result) return [];
    const list = result.cards.map((c, i) => ({ ...c, key: i, rarity: TRACK_BY_ID[c.trackId].rarity }));
    if (multi) list.sort((a, b) => RARITY[b.rarity].rank - RARITY[a.rarity].rank || (b.variant === 'holo') - (a.variant === 'holo'));
    return list;
  }, [result, multi]);

  const startTear = useCallback(() => {
    setPhase('tear');
    sound.tear();
    setTimeout(() => {
      sound.whoosh();
      setPhase(multi ? 'summary' : 'reveal');
    }, 750);
  }, [multi]);

  // On attend la réponse du serveur si le joueur a déjà touché le booster.
  useEffect(() => {
    if (result && wantOpen.current && phase === 'shake') {
      wantOpen.current = false;
      const id = setTimeout(startTear, 380);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [result, phase, startTear]);

  useEffect(() => {
    if (failed) onClose(failed);
  }, [failed, onClose]);

  const tapPack = () => {
    if (phase !== 'pack') return;
    sound.unlock();
    sound.shake();
    setPhase('shake');
    wantOpen.current = true;
    if (result) {
      wantOpen.current = false;
      setTimeout(startTear, 380);
    }
  };

  const current = cards[index];

  // Teaser sonore quand une carte rare arrive face cachée.
  useEffect(() => {
    if (phase === 'reveal' && current && !flipped) sound.tease(current.rarity);
  }, [phase, index, current, flipped]);

  const flip = () => {
    if (!current) return;
    setFlipped(true);
    sound.flip();
    setTimeout(() => {
      sound.reveal(current.rarity, current.variant === 'holo');
      if (current.newTrack) setTimeout(() => sound.newCard(), 380);
      if (BIG.has(current.rarity)) {
        setFlash(current.rarity);
        setTimeout(() => setFlash(null), 900);
        const c = RARITY[current.rarity].color;
        burst([c, '#f4eee3', c, '#ffffff'], current.rarity === 'legendary' ? 140 : 90);
      } else if (current.variant === 'holo') {
        burst(['#ff4f7e', '#3fd6c4', '#ffd35a', '#b17dff'], 50);
      }
    }, 160);
  };

  const advance = () => {
    sound.whoosh();
    setLeaving(index);
    setTimeout(() => setLeaving(null), 420);
    if (index + 1 >= cards.length) {
      setPhase('summary');
    } else {
      setIndex(index + 1);
      setFlipped(false);
    }
  };

  const onStageTap = () => {
    if (phase !== 'reveal') return;
    if (flipped) advance();
    else flip();
  };

  const revealAll = () => {
    sound.click();
    setPhase('summary');
  };

  // Son de célébration à l'arrivée sur le résumé.
  useEffect(() => {
    if (phase !== 'summary' || !result) return;
    if (result.achievements.length) {
      setTimeout(() => sound.complete(), 250);
      burst(['#ffd35a', '#f4eee3', '#ff8b3d', '#ffe9a8'], 160);
    } else if (multi) {
      const best = cards[0];
      if (best) sound.reveal(best.rarity);
    }
  }, [phase, result, multi, cards, burst]);

  // Clavier : Espace / Entrée pour avancer, Échap pour fermer à la fin.
  useEffect(() => {
    const onKey = (e) => {
      // Une modale ouverte par-dessus (guide des raretés) garde ses touches.
      if (e.defaultPrevented || document.querySelector('.modal-backdrop')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        // Un bouton focalisé gère déjà Espace/Entrée lui-même.
        if (e.target instanceof HTMLButtonElement) return;
        if (phase === 'pack') { e.preventDefault(); tapPack(); }
        else if (phase === 'reveal') { e.preventDefault(); onStageTap(); }
      } else if (e.key === 'Escape' && phase === 'summary') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    document.body.classList.add('no-scroll');
    return () => document.body.classList.remove('no-scroll');
  }, []);

  const countOf = (c) => owned?.get(c.trackId)?.[c.variant] || 1;
  const newCount = cards.filter((c) => c.newTrack).length;
  const dupCount = cards.filter((c) => !c.newTrack && !c.newVariant).length;
  const canAgain = !!onAgain && (isAdmin || (packs?.available ?? 0) > 0);

  const hint = phase === 'pack' || phase === 'shake' ? t('open.tap')
    : phase === 'reveal' ? (flipped ? (index + 1 >= cards.length ? t('open.last') : t('open.next')) : t('open.reveal'))
      : null;

  return createPortal(
    <div className={`opening opening--${phase}${flash ? ` opening--flash-${flash}` : ''}`} role="dialog" aria-modal="true" aria-label={t('home.open')}>
      <canvas className="opening__burst" ref={canvasRef} aria-hidden="true" />
      <div className="opening__bar">
        {phase === 'reveal' && <span className="opening__counter mono">{t('open.counter', { i: index + 1, n: cards.length })}</span>}
        <span className="opening__spacer" />
        {phase === 'reveal' && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={revealAll}>{t('open.revealAll')}</button>
        )}
        {phase === 'summary' && (
          <button type="button" className="icon-btn" onClick={() => onClose()} aria-label={t('open.close')}><Icon name="close" /></button>
        )}
      </div>

      {(phase === 'pack' || phase === 'shake' || phase === 'tear') && (
        <div className="opening__stage">
          <button type="button" className="opening__pack-btn" onClick={tapPack} aria-label={t('open.tap')}>
            <PackArt className={`pack--xl pack--${phase}`} />
          </button>
          {multi && <span className="opening__multi mono">×{count}</span>}
        </div>
      )}

      {phase === 'reveal' && current && (
        <div className="opening__stage" onClick={onStageTap}>
          {BIG.has(current.rarity) && flipped && <span className="rays" style={{ '--rc': RARITY[current.rarity].color }} aria-hidden="true" />}
          <div className="reveal-stack">
            {cards.slice(index + 1, index + 3).reverse().map((c, i, arr) => (
              <span key={c.key} className="reveal-stack__under" style={{ '--depth': arr.length - i }}>
                <CardBack rarity="common" />
              </span>
            ))}
            {leaving !== null && leaving !== index && cards[leaving] && (
              <span className="reveal-card reveal-card--leaving" key={`l${leaving}`}>
                <span className="flip flip--done">
                  <span className="flip__front"><Card trackId={cards[leaving].trackId} variant={cards[leaving].variant} artSizes="300px" /></span>
                </span>
              </span>
            )}
            <button type="button" className={`reveal-card${!flipped && RARITY[current.rarity].rank >= 2 ? ` reveal-card--tease reveal-card--tease-${current.rarity}` : ''}`}
              key={current.key} style={{ '--rc': RARITY[current.rarity].color }} aria-label={flipped ? TRACK_BY_ID[current.trackId].title : t('open.reveal')}>
              <span className={`flip${flipped ? ' flip--done' : ''}`}>
                <span className="flip__back"><CardBack rarity={current.rarity} /></span>
                <span className="flip__front">
                  <Card trackId={current.trackId} variant={current.variant} tilt artSizes="300px" />
                </span>
              </span>
              {flipped && (
                <span className="reveal-card__tags">
                  {current.newTrack && <span className="tag tag--new">{t('open.new')}</span>}
                  {!current.newTrack && current.newVariant && <span className="tag tag--new">{t('open.newVariant')}</span>}
                  {current.variant === 'holo' && <span className="tag tag--holo">{t('open.holo')}</span>}
                  {!current.newTrack && !current.newVariant && <span className="tag">{t('open.dup', { n: countOf(current) })}</span>}
                </span>
              )}
            </button>
          </div>
          {flipped && (
            <p className="reveal-caption">
              <span className="reveal-caption__rarity" style={{ color: RARITY[current.rarity].color }}>{t(`rarity.${current.rarity}`)}</span>
              <span>{TRACK_BY_ID[current.trackId].albumId ? ALBUM_BY_ID[TRACK_BY_ID[current.trackId].albumId].title : t(`promoKind.${TRACK_BY_ID[current.trackId].promoKind}`)}</span>
            </p>
          )}
          <div className="reveal-tray" aria-hidden="true">
            {cards.map((c, i) => (
              <span key={c.key} className={`reveal-tray__dot${i < index || (i === index && flipped) ? ' is-on' : ''}`} style={{ '--rc': RARITY[c.rarity].color }} />
            ))}
          </div>
        </div>
      )}

      {phase === 'summary' && result && (
        <div className="summary">
          <header className="summary__head">
            <h2>{multi ? t('open.summaryN', { n: count }) : t('open.summary')}</h2>
            <div className="summary__chips">
              <span className="chip chip--new">{t('open.newCount', { n: newCount })}</span>
              <span className="chip">{t('open.dupCount', { n: dupCount })}</span>
              <span className="chip">{t('open.xp', { n: result.xp })}</span>
              {result.royalties > 0 && <span className="chip"><RoyaltyIcon size={14} /> +{num(result.royalties)}</span>}
            </div>
          </header>

          <AchievementList achievements={result.achievements} />

          <div className={`summary__grid${multi ? ' summary__grid--multi' : ''}`}>
            {cards.map((c, i) => (
              <span key={c.key} className="summary__cell" style={{ '--i': Math.min(i, 30) }}>
                <Card trackId={c.trackId} variant={c.variant}
                  badge={c.newTrack ? t('open.new') : c.newVariant ? t('open.newVariantShort') : `×${countOf(c)}`}
                  badgeTone={c.newTrack || c.newVariant ? 'new' : 'dup'} />
              </span>
            ))}
          </div>

          {result.albumDeltas.length > 0 && (
            <section className="summary__progress">
              <h3 className="eyebrow">{t('open.progress')}</h3>
              <ul>
                {result.albumDeltas.slice(0, multi ? 40 : 5).map((d) => {
                  const album = ALBUM_BY_ID[d.albumId];
                  return (
                    <li key={d.albumId}>
                      <Link to={`/album/${d.albumId}`} onClick={() => onClose()} className="delta">
                        <span className="delta__cover"><CoverArt art={{ ...album.art, seed: album.id }} /></span>
                        <span className="delta__text">
                          <span className="delta__title">{album.title}</span>
                          <DeltaBar before={d.before} after={d.after} total={d.total} color={album.art.palette[1]} />
                        </span>
                        <span className="delta__nums mono">{d.after}/{d.total}<em>+{d.after - d.before}</em></span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="summary__help"><RarityGuideButton /></div>

          <footer className="summary__actions">
            {canAgain && (
              <button type="button" className="btn btn--primary btn--lg" onClick={onAgain} data-autofocus>
                {t('open.again')}
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--lg" onClick={() => onClose()}>{t('open.close')}</button>
          </footer>
        </div>
      )}

      {hint && <p className="opening__hint">{hint}</p>}
    </div>,
    document.body,
  );
}

function DeltaBar({ before, after, total, color }) {
  const [value, setValue] = useState(before);
  useEffect(() => {
    const id = setTimeout(() => setValue(after), 300);
    return () => clearTimeout(id);
  }, [after]);
  return <Progress value={value} max={total} color={color} size="sm" />;
}
