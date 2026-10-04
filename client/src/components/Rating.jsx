import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { get, post, api } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Avatar, useToast } from './ui.jsx';

// Une note est toujours stockée sur 10 (entier de 0 à 10).
// Affichage au choix du joueur : 5 étoiles avec demi-étoiles (1 point = ½ étoile) ou une note sur 10.

const REVIEW_MAX = 2000;

function StarShape({ fill, size }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="star">
      <defs>
        <linearGradient id={`s${id}`}>
          <stop offset={`${fill * 100}%`} stopColor="currentColor" />
          <stop offset={`${fill * 100}%`} stopColor="var(--star-empty)" />
        </linearGradient>
      </defs>
      <path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5L2.6 9.4l6.5-.8z" fill={`url(#s${id})`} />
    </svg>
  );
}

/** Étoiles en lecture seule pour une valeur sur 10 (arrondie à la demi-étoile). */
export function Stars({ value, size = 16 }) {
  const halves = Math.round(value);
  return (
    <span className="stars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <StarShape key={i} size={size} fill={halves >= i * 2 + 2 ? 1 : halves === i * 2 + 1 ? 0.5 : 0} />
      ))}
    </span>
  );
}

export function useFormatScore() {
  const { t, lang } = useI18n();
  const { ratingScale } = useGame();
  return useCallback((value, { decimals = 0 } = {}) => {
    if (value == null) return '';
    const fmt = new Intl.NumberFormat(lang, { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
    if (ratingScale === 'points') return t('rating.outOf10', { v: fmt.format(value) });
    return `${fmt.format(value / 2)} ★`;
  }, [ratingScale, t, lang]);
}

/** Affiche une note (ou une moyenne) dans l'échelle choisie par le joueur. */
export function RatingValue({ value, average = false, size = 15, className = '' }) {
  const { ratingScale } = useGame();
  const { t, lang } = useI18n();
  if (value == null) return null;
  const fmt = new Intl.NumberFormat(lang, { maximumFractionDigits: average ? 1 : 0 });
  const label = ratingScale === 'points' ? t('rating.pointsAria', { v: fmt.format(value) }) : t('rating.starsAria', { v: fmt.format(value / 2), n: value / 2 });
  if (ratingScale === 'points') {
    return (
      <span className={`rating-value rating-value--points ${className}`} aria-label={label} title={label}>
        <b className="mono">{fmt.format(value)}</b><span>/10</span>
      </span>
    );
  }
  return (
    <span className={`rating-value ${className}`} aria-label={label} title={label}>
      <Stars value={value} size={size} />
      {average && <b className="mono">{fmt.format(value / 2)}</b>}
    </span>
  );
}

/** Saisie d'une note : étoiles (demi-étoiles) ou boutons 0 à 10. `value` null = pas encore noté. */
export function RatingInput({ value, onChange, size = 30, disabled = false, compact = false }) {
  const { ratingScale } = useGame();
  const { t, lang } = useI18n();
  const [hover, setHover] = useState(null);
  const half = (v) => new Intl.NumberFormat(lang).format(v / 2);
  const ref = useRef(null);

  if (ratingScale === 'points') {
    return (
      <div className={`points-input${compact ? ' points-input--compact' : ''}`} role="radiogroup" aria-label={t('rating.yours')}>
        {Array.from({ length: 11 }, (_, v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled}
            className={`points-input__btn${value === v ? ' is-on' : ''}${value != null && v < value ? ' is-below' : ''}`}
            onClick={() => onChange(v)}>{v}</button>
        ))}
      </div>
    );
  }

  const fromPointer = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    return Math.max(1, Math.ceil((x / r.width) * 10));
  };
  const onKeyDown = (e) => {
    const cur = value ?? 0;
    const map = { ArrowRight: cur + 1, ArrowUp: cur + 1, ArrowLeft: cur - 1, ArrowDown: cur - 1, Home: 0, End: 10 };
    if (e.key in map) {
      e.preventDefault();
      onChange(Math.min(10, Math.max(0, map[e.key])));
    }
  };
  const shown = hover ?? value ?? 0;
  return (
    <div className={`star-input${compact ? ' star-input--compact' : ''}`}>
      <div
        ref={ref}
        className={`star-input__stars${value == null && hover == null ? ' is-empty' : ''}`}
        role="slider" tabIndex={disabled ? -1 : 0}
        aria-label={t('rating.yours')} aria-valuemin={0} aria-valuemax={10} aria-valuenow={value ?? undefined}
        aria-valuetext={value == null ? t('rating.none') : t('rating.starsAria', { v: half(value), n: value / 2 })}
        aria-disabled={disabled}
        onPointerMove={(e) => !disabled && e.pointerType === 'mouse' && setHover(fromPointer(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => !disabled && onChange(fromPointer(e))}
        onKeyDown={onKeyDown}
      >
        <Stars value={shown} size={size} />
      </div>
      {!compact && (
        <button type="button" className={`star-input__zero${value === 0 ? ' is-on' : ''}`} onClick={() => onChange(0)} disabled={disabled} title={t('rating.setZero')}>0</button>
      )}
    </div>
  );
}

/** Répartition des notes (0 à 10), façon Letterboxd. */
export function RatingHistogram({ distribution, mine }) {
  const { ratingScale } = useGame();
  const max = Math.max(1, ...distribution);
  return (
    <div className="histogram" aria-hidden="true">
      <div className="histogram__bars">
        {distribution.map((n, v) => (
          <span key={v} className={`histogram__bar${mine === v ? ' is-mine' : ''}`} style={{ height: `${Math.max(4, (n / max) * 100)}%` }} title={`${v}: ${n}`} />
        ))}
      </div>
      <div className="histogram__axis mono">
        <span>{ratingScale === 'points' ? '0' : '0'}</span>
        <span>{ratingScale === 'points' ? '10' : '5 ★'}</span>
      </div>
    </div>
  );
}

/** Charge et met à jour les notes d'un album ou d'un morceau. */
export function useItemRatings(type, id) {
  const { applyState } = useGame();
  const [data, setData] = useState(null);
  const [version, setVersion] = useState(0);
  const path = `/ratings/${type}/${encodeURIComponent(id)}`;

  useEffect(() => {
    let alive = true;
    if (version === 0) setData(null);
    get(path).then((d) => alive && setData(d)).catch(() => alive && setData({ summary: { count: 0, average: null, distribution: Array(11).fill(0) }, mine: null, reviews: [], friendScores: [] }));
    return () => {
      alive = false;
    };
  }, [path, version]);

  const save = useCallback(async (score, review) => {
    const res = await api('PUT', path, { score, review });
    setData(res);
    applyState(res.state);
    return res;
  }, [path, applyState]);

  const remove = useCallback(async () => {
    const res = await api('DELETE', path);
    setData(res);
    applyState(res.state);
    return res;
  }, [path, applyState]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, save, remove, reload };
}

/** Éditeur de note + critique écrite. */
export function ReviewEditor({ data, save, remove, compact = false }) {
  const { t, error, date } = useI18n();
  const toast = useToast();
  const mine = data?.mine;
  const [score, setScore] = useState(mine?.score ?? null);
  const [text, setText] = useState(mine?.review || '');
  const [open, setOpen] = useState(!compact || !!mine?.review);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setScore(mine?.score ?? null);
    setText(mine?.review || '');
    if (mine?.review) setOpen(true);
  }, [mine?.score, mine?.review]);

  const submit = async (nextScore = score, nextText = text) => {
    if (nextScore == null) return toast(t('reviews.pickScore'), 'error');
    setBusy(true);
    try {
      await save(nextScore, nextText);
      toast(t('rating.saved'), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await remove();
      toast(t('rating.removed'), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  // En mode compact (modale de carte), une note seule est enregistrée immédiatement.
  const onScore = (v) => {
    setScore(v);
    if (compact && !open) submit(v, text);
  };

  const dirty = score !== (mine?.score ?? null) || text.trim() !== (mine?.review || '');
  return (
    <div className={`review-editor${compact ? ' review-editor--compact' : ''}`}>
      <div className="review-editor__score">
        <RatingInput value={score} onChange={onScore} disabled={busy} size={compact ? 26 : 32} />
        {score != null && <RatingValue value={score} className="review-editor__value" />}
      </div>
      {open ? (
        <>
          <label className="sr-only" htmlFor={`review-${compact ? 'c' : 'f'}`}>{t('reviews.yours')}</label>
          <textarea id={`review-${compact ? 'c' : 'f'}`} className="input textarea" rows={compact ? 3 : 5} maxLength={REVIEW_MAX}
            placeholder={t('reviews.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="review-editor__row">
            <span className="small muted mono">{t('reviews.counter', { n: text.length })}</span>
            <span className="review-editor__actions">
              {mine && <button type="button" className="btn btn--ghost btn--sm btn--quiet" onClick={clear} disabled={busy}>{t('rating.clear')}</button>}
              <button type="button" className="btn btn--primary btn--sm" onClick={() => submit()} disabled={busy || !dirty || score == null}>
                {mine ? t('reviews.update') : t('reviews.save')}
              </button>
            </span>
          </div>
          {mine?.updatedAt && <p className="small muted">{t('reviews.edited', { date: date(mine.updatedAt) })}</p>}
        </>
      ) : (
        <div className="review-editor__row">
          <button type="button" className="link-btn" onClick={() => setOpen(true)}>{t('reviews.addText')}</button>
          {mine && <button type="button" className="btn btn--ghost btn--sm btn--quiet" onClick={clear} disabled={busy}>{t('rating.clear')}</button>}
        </div>
      )}
    </div>
  );
}

function ReviewText({ text }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <div className="review__text">
      <p>{long && !open ? `${text.slice(0, 300).trimEnd()}…` : text}</p>
      {long && <button type="button" className="link-btn small" onClick={() => setOpen(!open)}>{open ? t('reviews.less') : t('reviews.more')}</button>}
    </div>
  );
}

export function ReviewList({ reviews, renderItem }) {
  const { t, date } = useI18n();
  if (!reviews.length) return <p className="empty">{t('reviews.empty')}</p>;
  return (
    <ul className="reviews">
      {reviews.map((r) => (
        <li key={`${r.user?.id ?? 'me'}-${r.type ?? ''}-${r.id ?? ''}-${r.updatedAt}`} className="review">
          {renderItem ? renderItem(r) : (
            <Link to={`/u/${r.user.username}`} className="review__author">
              <Avatar user={r.user} size={32} />
              <span className="review__name">{r.user.username}</span>
              {r.friend && <span className="chip chip--new review__tag">{t('reviews.friendTag')}</span>}
            </Link>
          )}
          <div className="review__meta">
            <RatingValue value={r.score} size={14} />
            <span className="small muted">{date(r.updatedAt)}</span>
          </div>
          {r.review && <ReviewText text={r.review} />}
        </li>
      ))}
    </ul>
  );
}

/** Sélecteur d'échelle de notation (★ sur 5 ou /10), enregistré dans le compte. */
export function ScaleSwitch() {
  const { ratingScale, applyState } = useGame();
  const { t, error } = useI18n();
  const toast = useToast();
  const choose = async (scale) => {
    if (scale === ratingScale) return;
    try {
      const res = await post('/profile/settings', { ratingScale: scale });
      applyState(res.state);
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };
  return (
    <div className="seg" role="group" aria-label={t('nav.scale')}>
      {[['stars', t('rating.scaleStars')], ['points', t('rating.scalePoints')]].map(([id, label]) => (
        <button key={id} type="button" className={`seg__btn${ratingScale === id ? ' is-on' : ''}`} aria-pressed={ratingScale === id} onClick={() => choose(id)}>{label}</button>
      ))}
    </div>
  );
}
