import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { get, post, api } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { useAlbum, useTrack } from '../state/catalog.js';
import { useCursorList } from '../state/paged.js';
import CoverArt from './CoverArt.jsx';
import { Avatar, useToast } from './ui.jsx';
import { LoadMore, Skeleton } from './feedback.jsx';
import UgcText from './UgcText.jsx';
import SafetyMenu from './safety/SafetyMenu.jsx';
import '../styles/profile.css';
import '../styles/track.css';

// Une note est toujours stockée sur 10 (entier de 0 à 10).
// Affichage au choix du joueur : 5 étoiles avec demi-étoiles (1 point = ½ étoile) ou une note sur 10.
// Notes v2 (PLAN.md 4.1.2, chantier P0-C) : chaque critique a un identifiant stable (ancre #review-<id>), les critiques
// des amis (« Vos amis ») passent avant celles de la communauté (« Communauté AlbumMania »), page par page.

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

/**
 * Affiche une note (ou une moyenne) dans l'échelle choisie par le joueur. En étoiles, une note personnelle peut
 * tomber sur une demi-étoile : le libellé garde une décimale (« 4,5 étoiles sur 5 », jamais « 5 » pour 9/10).
 */
export function RatingValue({ value, average = false, size = 15, className = '' }) {
  const { ratingScale } = useGame();
  const { t, lang } = useI18n();
  if (value == null) return null;
  if (ratingScale === 'points') {
    const fmt = new Intl.NumberFormat(lang, { maximumFractionDigits: average ? 1 : 0 });
    const label = t('rating.pointsAria', { v: fmt.format(value) });
    return (
      <span className={`rating-value rating-value--points ${className}`} role="img" aria-label={label} title={label}>
        <b className="mono">{fmt.format(value)}</b><span>/10</span>
      </span>
    );
  }
  const fmt = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const stars = average ? Math.round(value * 5) / 10 : value / 2;
  const label = t('rating.starsAria', { v: fmt.format(stars), n: stars });
  return (
    <span className={`rating-value ${className}`} role="img" aria-label={label} title={label}>
      <Stars value={value} size={size} />
      {average && <b className="mono">{fmt.format(stars)}</b>}
    </span>
  );
}

/** Saisie d'une note : étoiles (demi-étoiles) ou boutons 0 à 10. `value` null = pas encore noté. */
export function RatingInput({ value, onChange, size = 30, disabled = false, compact = false, label }) {
  const { ratingScale } = useGame();
  const { t, lang } = useI18n();
  const [hover, setHover] = useState(null);
  // Valeur locale : plusieurs flèches d'affilée partent de la dernière valeur choisie, pas de celle du serveur.
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const half = (v) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(v / 2);
  const ref = useRef(null);
  const name = label || t('rating.yours');
  const change = (v) => {
    if (disabled) return;
    setDraft(v);
    onChange(v);
  };

  if (ratingScale === 'points') {
    return (
      <div className={`points-input${compact ? ' points-input--compact' : ''}`} role="radiogroup" aria-label={name}>
        {Array.from({ length: 11 }, (_, v) => (
          <button key={v} type="button" role="radio" aria-checked={draft === v} disabled={disabled}
            className={`points-input__btn${draft === v ? ' is-on' : ''}${draft != null && v < draft ? ' is-below' : ''}`}
            onClick={() => change(v)}>{v}</button>
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
    if (disabled) return;
    const cur = draft ?? 0;
    const map = { ArrowRight: cur + 1, ArrowUp: cur + 1, ArrowLeft: cur - 1, ArrowDown: cur - 1, Home: 0, End: 10 };
    if (e.key in map) {
      e.preventDefault();
      change(Math.min(10, Math.max(0, map[e.key])));
    }
  };
  const shown = hover ?? draft ?? 0;
  return (
    <div className={`star-input${compact ? ' star-input--compact' : ''}`}>
      <div
        ref={ref}
        className={`star-input__stars${draft == null && hover == null ? ' is-empty' : ''}`}
        role="slider" tabIndex={disabled ? -1 : 0}
        aria-label={name} aria-valuemin={0} aria-valuemax={10} aria-valuenow={draft ?? undefined}
        aria-valuetext={draft == null ? t('rating.none') : t('rating.starsAria', { v: half(draft), n: draft / 2 })}
        aria-disabled={disabled}
        onPointerMove={(e) => !disabled && e.pointerType === 'mouse' && setHover(fromPointer(e))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => change(fromPointer(e))}
        onKeyDown={onKeyDown}
      >
        <Stars value={shown} size={size} />
      </div>
      {!compact && (
        <button type="button" className={`star-input__zero${draft === 0 ? ' is-on' : ''}`} onClick={() => change(0)} disabled={disabled} title={t('rating.setZero')}>0</button>
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
        <span>0</span>
        <span>{ratingScale === 'points' ? '10' : '5 ★'}</span>
      </div>
    </div>
  );
}

/** Notes d'un élément quand le chargement a échoué : la page reste utilisable (sa note se saisit quand même). */
const EMPTY_RATINGS = {
  summary: { count: 0, average: null, distribution: Array(11).fill(0), reviewCount: 0 },
  mine: null,
  friends: { scores: [], reviews: [], nextCursor: null },
  community: { reviews: [], nextCursor: null },
  reviews: [],
  friendScores: [],
};

/**
 * Charge et met à jour les notes d'un album ou d'un morceau (GET/PUT/DELETE /api/ratings/:type/:id).
 * Renvoie { data, error, save(score, review?), remove(), reload() } ; l'état du joueur (state.ratings) est fusionné
 * par api.js à chaque réponse.
 */
export function useItemRatings(type, id) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const path = id ? `/ratings/${type}/${encodeURIComponent(id)}` : null;
  const lastPath = useRef(path);

  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    // Nouvel album / morceau : on n'affiche pas les notes du précédent pendant le chargement.
    if (lastPath.current !== path) {
      lastPath.current = path;
      setData(null);
    }
    get(path)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setData((prev) => prev || EMPTY_RATINGS);
      });
    return () => {
      alive = false;
    };
  }, [path, version]);

  const save = useCallback(async (score, review) => {
    const res = await api('PUT', path, review === undefined ? { score } : { score, review });
    setData(res);
    return res;
  }, [path]);

  const remove = useCallback(async () => {
    const res = await api('DELETE', path);
    setData(res);
    return res;
  }, [path]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, save, remove, reload };
}

/**
 * Éditeur de note + critique écrite. Le champ de la critique d'une page (album ou morceau : une seule par page)
 * garde l'identifiant historique « review-f » ; ceux des fiches de carte (compactes) sont uniques (useId).
 */
export function ReviewEditor({ data, save, remove, compact = false }) {
  const { t, error, date } = useI18n();
  const toast = useToast();
  const uid = useId();
  const fieldId = compact ? `review-c${uid.replace(/:/g, '')}` : 'review-f';
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

  const submit = async (nextScore = score, nextText = text, instant = false) => {
    if (nextScore == null) return toast(t('reviews.pickScore'), 'error');
    setBusy(true);
    try {
      // Note seule (fiche de carte, critique fermée) : le texte déjà écrit est gardé.
      await save(nextScore, instant && !open ? undefined : nextText);
      toast(t('rating.saved'), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
      if (instant) setScore(mine?.score ?? null);
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
    if (compact && !open) submit(v, text, true);
  };

  const dirty = score !== (mine?.score ?? null) || text.trim() !== (mine?.review || '');
  return (
    <div className={`review-editor${compact ? ' review-editor--compact' : ''}`}>
      <div className="review-editor__score">
        <RatingInput value={score} onChange={onScore} disabled={busy} size={compact ? 26 : 32} />
        {score != null && <RatingValue value={score} className="review-editor__value" />}
      </div>
      {mine?.moderated && <p className="small trk-moderated">{t('track.reviews.moderated')}</p>}
      {open ? (
        <>
          <label className="sr-only" htmlFor={fieldId}>{t('reviews.yours')}</label>
          <textarea id={fieldId} className="input textarea" rows={compact ? 3 : 5} maxLength={REVIEW_MAX}
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

/** Identifiant de la note d'une critique (ancre #review-<id>) : `id` des critiques v2, `ratingId` du journal. */
const ratingIdOf = (r) => (Number.isInteger(r.ratingId) ? r.ratingId : !r.type && Number.isInteger(r.id) ? r.id : null);

/**
 * Liste de critiques. Chaque critique porte l'ancre « review-<id> », son texte passe par UgcText et le menu
 * « Signaler / Bloquer » (SafetyMenu) accompagne celles des autres joueurs. `renderItem(r)` remplace l'auteur
 * (journal d'un profil : l'élément noté à la place).
 */
export function ReviewList({ reviews, renderItem, empty }) {
  const { t, date } = useI18n();
  if (!reviews.length) return <p className="empty">{empty || t('reviews.empty')}</p>;
  return (
    <ul className="reviews">
      {reviews.map((r) => {
        const ratingId = ratingIdOf(r);
        return (
          <li key={`${r.user?.id ?? 'me'}-${r.type ?? ''}-${r.id ?? ''}-${r.updatedAt}`} className="review" id={ratingId ? `review-${ratingId}` : undefined}>
            {renderItem ? renderItem(r) : (
              <div className="trk-review__head">
                <Link to={`/u/${r.user.username}`} className="review__author">
                  <Avatar user={r.user} size={32} />
                  <span className="review__name">{r.user.username}</span>
                  {r.friend && <span className="chip chip--new review__tag">{t('reviews.friendTag')}</span>}
                </Link>
                {ratingId && r.user?.relation !== 'self' && <SafetyMenu target={{ type: 'review', id: ratingId }} user={r.user} />}
              </div>
            )}
            <div className="review__meta">
              <RatingValue value={r.score} size={14} />
              <span className="small muted">{date(r.updatedAt)}</span>
            </div>
            {r.review && <div className="review__text trk-review__text"><UgcText text={r.review} clamp /></div>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Un groupe de critiques (« Vos amis » ou « Communauté AlbumMania ») : la première page arrive avec les notes de
 * l'élément ; « Voir plus » lit les suivantes par curseur (GET /api/ratings/:type/:id/reviews?scope=…).
 */
function ReviewGroup({ type, id, scope, title, initial, nextCursor, empty }) {
  const { t } = useI18n();
  const path = nextCursor ? `/ratings/${type}/${encodeURIComponent(id)}/reviews?scope=${scope}` : null;
  const list = useCursorList(path, { limit: 10 });
  const loaded = !!path && list.items.length > 0;
  const reviews = loaded ? list.items : initial;
  const hasMore = !!path && (loaded ? list.hasMore : true);
  return (
    <div className={`trk-group trk-group--${scope}`}>
      <h3 className="trk-group__title">{title}</h3>
      <ReviewList reviews={reviews} empty={empty} />
      {hasMore && (
        <LoadMore hasMore loading={list.loading} onClick={loaded ? list.loadMore : list.reload} label={t('track.reviews.more')} />
      )}
    </div>
  );
}

/** Notes des amis : petites pastilles (nom + note), lien vers leur Studio. */
function FriendScores({ scores }) {
  const { t } = useI18n();
  if (!scores?.length) return null;
  return (
    <div className="friend-scores">
      <h4 className="trk-subtitle">{t('rating.friends')}</h4>
      <ul>
        {scores.map((f) => (
          <li key={f.user.id}>
            <Link to={`/u/${f.user.username}`} className="friend-score">
              <span className="friend-score__name">{f.user.username}</span>
              <RatingValue value={f.score} size={11} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Bloc « Notes & critiques » d'un album ou d'un morceau : ma note et ma critique, la communauté (moyenne,
 * répartition, notes des amis), puis les critiques des amis (« Vos amis ») avant celles de la communauté.
 * `ratingsApi` : résultat de useItemRatings(type, id).
 */
export function RatingsSection({ type, id, ratingsApi, className = '' }) {
  const { t } = useI18n();
  const { data, save, remove } = ratingsApi;
  const ready = !!data;
  // Lien vers une critique (#review-<id>, notifications, fil) : la page défile jusqu'à elle une fois les notes chargées.
  useEffect(() => {
    if (!ready || !/^#review-\d+$/.test(window.location.hash)) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'center' });
  }, [ready]);
  if (!data) {
    return (
      <section className={`section album-ratings ${className}`} id="critiques" aria-busy="true">
        <header className="section__head"><h2>{t('reviews.title')}</h2></header>
        <Skeleton kind="row" count={3} />
      </section>
    );
  }
  const { summary } = data;
  const friends = data.friends || { scores: data.friendScores || [], reviews: [], nextCursor: null };
  const community = data.community || { reviews: data.reviews || [], nextCursor: null };
  return (
    <section className={`section album-ratings ${className}`} id="critiques">
      <header className="section__head"><h2>{t('reviews.title')}</h2></header>
      <div className="album-ratings__grid">
        <div className="panel" id="ma-note">
          <h3 className="panel__title">{t('reviews.yours')}</h3>
          <ReviewEditor key={`${type}:${id}`} data={data} save={save} remove={remove} />
        </div>
        <div className="panel album-ratings__community">
          <h3 className="panel__title">{t('rating.community')}</h3>
          {summary.count ? (
            <>
              <div className="community-score">
                <RatingValue value={summary.average} average size={22} />
                <span className="muted small">{t('rating.count', { n: summary.count })}</span>
              </div>
              <RatingHistogram distribution={summary.distribution} mine={data.mine?.score} />
            </>
          ) : <p className="muted">{t('rating.empty')}</p>}
          <FriendScores scores={friends.scores} />
        </div>
      </div>
      {friends.reviews.length > 0 && (
        <ReviewGroup type={type} id={id} scope="friends" title={t('track.reviews.friends')} initial={friends.reviews} nextCursor={friends.nextCursor} />
      )}
      <ReviewGroup type={type} id={id} scope="community" title={t('track.reviews.community')} initial={community.reviews}
        nextCursor={community.nextCursor} empty={t('track.reviews.communityEmpty')} />
    </section>
  );
}

// ----- éléments notés (journal de notes, fil des amis, modération) -------------------------

/** Adresse de la page d'un album ou d'un morceau. */
export const itemPath = (type, id) => `/${type === 'album' ? 'album' : 'track'}/${encodeURIComponent(id)}`;

/**
 * Album ou morceau noté : { title, artist, art, to }, lu dans le catalogue du site.
 * Les réponses de notes apportent les fiches des éléments cités ; un élément absent est chargé par lots (null en attendant).
 * Un morceau (ou un single promo) mène à sa page morceau.
 */
export function useRatedItem(type, id) {
  const album = useAlbum(type === 'album' ? id : null);
  const track = useTrack(type === 'track' ? id : null);
  const item = type === 'album' ? album : track;
  if (!item) return null;
  return { title: item.title, artist: item.artist, art: item.art, to: itemPath(type, item.id) };
}

/**
 * Lien vers un élément noté : petite pochette + titre (+ `children` après le titre).
 * Les classes viennent de l'endroit qui l'affiche (top albums, morceaux préférés, critiques…).
 */
export function RatedItemLink({ type, id, className, coverClassName, titleClassName, children }) {
  const item = useRatedItem(type, id);
  const { t } = useI18n();
  if (!item) {
    return (
      <span className={`${className} is-loading`} aria-busy="true">
        <span className={`${coverClassName} rated-skel`} />
        <span className={titleClassName}>{t('common.loading')}</span>
        {children}
      </span>
    );
  }
  return (
    <Link to={item.to} className={className} title={item.artist ? `${item.title} · ${item.artist}` : item.title}>
      <span className={coverClassName}><CoverArt art={item.art} /></span>
      <span className={titleClassName}>{item.title}</span>
      {children}
    </Link>
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
