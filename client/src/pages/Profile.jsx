import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { get, post, del } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { apiPath, registerCatalog, useAlbums, useArtists } from '../state/catalog.js';
import Card, { RarityGem } from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Avatar, ConfirmButton, Icon, Modal, Progress, Spinner, useToast } from '../components/ui.jsx';
import { AVATAR_COLORS, RARITIES, SHOWCASE_SLOTS } from '@shared/rules.js';
import { VinylShelf, isHoloComplete } from '../components/Vinyl.jsx';
import { RatedItemLink, RatingHistogram, RatingValue, ReviewList } from '../components/Rating.jsx';
import '../styles/profile.css';

// Le catalogue compte des dizaines de milliers d'albums : le profil ne parcourt jamais tout le catalogue.
// Les choix (cartes du Studio, pochettes) se font par pages, avec une recherche envoyée au serveur.

const VINYLS_MAX = 120; // vinyles exposés sur l'étagère (les plus récents), comme le profil public
const SHELF_PREVIEW = 13; // vinyles visibles avant « Voir N vinyles de plus » (avec 2 prochains : 3 étagères de 5)
const MASTERS_SHOWN = 6; // maîtrises affichées avant « +N autres »
const CARDS_PAGE = 36; // cartes par page dans le choix du Studio
const COVERS_PAGE = 36; // pochettes par page dans le choix de la photo
const SOON_MAX = 8; // albums presque complets proposés (verrouillés) dans le choix de la photo

const registerTracks = (list) => registerCatalog({ tracks: list });
const registerAlbums = (list) => registerCatalog({ albums: list });

/** Valeur qui suit `value` après `delay` ms sans changement (recherche tapée au clavier). */
function useDebounced(value, delay = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

/**
 * Liste paginée d'une adresse de l'API (`path`, filtres compris) : les pages suivantes s'ajoutent aux précédentes,
 * et une réponse arrivée après un changement de recherche est ignorée.
 */
function usePaged(path, pageSize, register) {
  const [state, setState] = useState({ path: null, items: [], total: null, end: false, loading: false, error: null });
  const ticket = useRef(0);

  const load = useCallback((offset) => {
    const id = ++ticket.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    get(`${path}${path.includes('?') ? '&' : '?'}offset=${offset}&limit=${pageSize}`)
      .then((res) => {
        if (id !== ticket.current) return; // réponse d'une recherche dépassée
        const list = Array.isArray(res?.items) ? res.items : [];
        register(list);
        setState((s) => {
          const kept = offset > 0 && s.path === path ? s.items : [];
          const seen = new Set(kept.map((x) => x.id));
          const items = [...kept, ...list.filter((x) => !seen.has(x.id))];
          return { path, items, total: Number.isFinite(res?.total) ? res.total : items.length, end: list.length < pageSize, loading: false, error: null };
        });
      })
      .catch((error) => {
        if (id === ticket.current) setState((s) => ({ ...s, loading: false, error }));
      });
  }, [path, pageSize, register]);

  useEffect(() => {
    load(0);
  }, [load]);

  const fresh = state.path === path;
  const count = fresh ? state.items.length : 0;
  const hasMore = fresh && !state.end && count < state.total;
  return {
    items: state.items,
    total: fresh ? state.total : null,
    loading: state.loading,
    error: state.error,
    // Rien à montrer encore (premier chargement) / résultats d'une recherche précédente, estompés en attendant.
    initial: !fresh && state.items.length === 0,
    stale: !fresh && state.items.length > 0,
    hasMore,
    remaining: hasMore ? state.total - count : 0,
    more: () => load(count),
    retry: () => load(count),
  };
}

/** Champ de recherche d'une fenêtre de choix : Échap efface d'abord la saisie, puis ferme la fenêtre. */
function PickerSearch({ id, value, onChange, placeholder, clearLabel }) {
  return (
    <div className="search pf-search" role="search">
      <Icon name="search" />
      <label htmlFor={id} className="sr-only">{placeholder}</label>
      <input id={id} type="search" className="input" value={value} placeholder={placeholder} autoComplete="off" spellCheck={false}
        enterKeyHint="search"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }} />
      {value && (
        <button type="button" className="icon-btn pf-search__clear" onClick={() => onChange('')} aria-label={clearLabel}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

/** Bouton « Voir plus » d'une liste paginée (ou message d'erreur avec « Réessayer »). */
function MoreButton({ list, label, remainingKey, errorText, retryLabel }) {
  const { t } = useI18n();
  if (list.error && list.items.length) {
    return (
      <div className="pf-more" role="alert">
        <span className="small muted">{errorText}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={list.retry}>{retryLabel}</button>
      </div>
    );
  }
  if (!list.hasMore) return null;
  return (
    <div className="pf-more">
      <button type="button" className="btn btn--ghost btn--sm" onClick={list.more} disabled={list.loading}>
        {list.loading ? <Spinner /> : <Icon name="plus" size={16} />}
        {label}
        <span className="pf-more__n">· {t(remainingKey, { n: list.remaining })}</span>
      </button>
    </div>
  );
}

function ErrorBox({ text, retryLabel, onRetry }) {
  return (
    <div className="empty pf-empty" role="alert">
      <p>{text}</p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>{retryLabel}</button>
    </div>
  );
}

// ----- photo de profil ---------------------------------------------------------------------

/** Une pochette à choisir (verrouillée : album pas encore complété, avec la progression). */
function CoverPick({ album, value, selected, locked, progress, onPick }) {
  const { t } = useI18n();
  if (!album) return <span className="cover-pick pf-cover-skel" aria-hidden="true" />;
  const label = locked && progress
    ? `${album.title} · ${album.artist} · ${t('avatar.locked', { owned: progress.owned, total: progress.total })}`
    : `${album.title} · ${album.artist}`;
  return (
    <button type="button" className={`cover-pick${selected ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
      disabled={locked} onClick={() => onPick(value)} aria-pressed={selected} aria-label={label} title={label}>
      <CoverArt art={{ ...album.art, seed: album.art?.seed || album.id }} generated={locked} sizes="80px" />
      {locked && progress && <span className="cover-pick__lock"><Icon name="lock" size={16} /><span className="mono">{progress.owned}/{progress.total}</span></span>}
    </button>
  );
}

/** Pochettes débloquées (albums complétés, les plus récents d'abord), affichées par pages. */
function UnlockedCovers({ ids, avatar, onPick }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(COVERS_PAGE);
  const visible = useMemo(() => ids.slice(0, shown), [ids, shown]);
  const albums = useAlbums(visible);
  if (!ids.length) return <p className="small muted">{t('avatar.coversHint')}</p>;
  return (
    <>
      <div className="cover-picks">
        {visible.map((id, i) => (
          <CoverPick key={id} album={albums[i]} value={`album:${id}`} selected={avatar === `album:${id}`} onPick={onPick} />
        ))}
      </div>
      {ids.length > shown && (
        <div className="pf-more">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShown((n) => n + COVERS_PAGE)}>
            <Icon name="plus" size={16} /> {t('avatar.more')}
            <span className="pf-more__n">· {t('avatar.remaining', { n: ids.length - shown })}</span>
          </button>
        </div>
      )}
    </>
  );
}

/** Albums les plus avancés, pas encore complétés : leur pochette se débloquera bientôt. */
function SoonCovers({ entries }) {
  const ids = useMemo(() => entries.map(([id]) => id), [entries]);
  const albums = useAlbums(ids);
  return (
    <div className="cover-picks">
      {entries.map(([id, progress], i) => (
        <CoverPick key={id} album={albums[i]} value={`album:${id}`} locked progress={progress} onPick={() => {}} />
      ))}
    </div>
  );
}

/** Admin : n'importe quelle pochette du catalogue, avec recherche (titre d'album ou artiste). */
function AdminCovers({ avatar, onPick }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const list = usePaged(apiPath('/catalog/albums', { q, sort: 'popular' }), COVERS_PAGE, registerAlbums);
  let body;
  if (list.error && !list.items.length) body = <ErrorBox text={t('avatar.loadError')} retryLabel={t('avatar.retry')} onRetry={list.retry} />;
  else if (list.initial) {
    body = <div className="cover-picks" aria-busy="true">{Array.from({ length: 12 }, (_, i) => <span key={i} className="cover-pick pf-cover-skel" />)}</div>;
  } else if (!list.stale && list.total === 0) body = <p className="empty pf-empty">{t('avatar.noResult')}</p>;
  else {
    body = (
      <>
        <div className={`cover-picks${list.stale ? ' is-stale' : ''}`} aria-busy={list.loading || undefined}>
          {list.items.map((a) => <CoverPick key={a.id} album={a} value={`album:${a.id}`} selected={avatar === `album:${a.id}`} onPick={onPick} />)}
        </div>
        <MoreButton list={list} label={t('avatar.more')} remainingKey="avatar.remaining" errorText={t('avatar.loadError')} retryLabel={t('avatar.retry')} />
      </>
    );
  }
  return (
    <>
      <PickerSearch id="avatar-admin-search" value={text} onChange={setText} placeholder={t('avatar.adminSearch')} clearLabel={t('studio.clear')} />
      {body}
    </>
  );
}

function AvatarPicker({ onClose }) {
  const { t, error } = useI18n();
  const { user, stats, achievements, applyState, isAdmin } = useGame();
  const toast = useToast();
  const [avatar, setAvatar] = useState(user.avatar);
  const [color, setColor] = useState(user.avatarColor);
  const [busy, setBusy] = useState(false);

  // Albums complétés, du plus récent au plus ancien.
  const unlocked = useMemo(() => [...achievements.entries()].filter(([k]) => k.startsWith('album:'))
    .sort((a, b) => b[1] - a[1]).map(([k]) => k.slice(6)), [achievements]);
  // Albums commencés les plus avancés (stats.albums ne contient que les albums commencés).
  const soon = useMemo(() => Object.entries(stats.albums || {}).filter(([, p]) => p.owned > 0 && p.pct < 1)
    .sort((a, b) => b[1].pct - a[1].pct || b[1].owned - a[1].owned).slice(0, SOON_MAX), [stats.albums]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await post('/profile/avatar', { avatar, color });
      applyState(res.state);
      toast(t('avatar.saved'), 'success');
      onClose();
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('avatar.title')}>
      <div className="avatar-picker">
        <div className="avatar-picker__preview">
          <Avatar user={{ ...user, avatar, avatarColor: color }} size={112} />
        </div>
        <section>
          <h3 className="eyebrow">{t('avatar.initials')} · {t('avatar.color')}</h3>
          <div className="swatches">
            {AVATAR_COLORS.map((c) => (
              <button key={c} type="button" className={`swatch${avatar === 'initials' && color === c ? ' is-on' : ''}`} style={{ '--sw': c }}
                aria-label={c} aria-pressed={avatar === 'initials' && color === c} onClick={() => { setAvatar('initials'); setColor(c); }} />
            ))}
          </div>
        </section>
        <section>
          <h3 className="eyebrow">
            {t('avatar.covers')}
            {unlocked.length > 0 && <span className="pf-eyebrow-n"> · {t('avatar.coversCount', { n: unlocked.length })}</span>}
          </h3>
          <UnlockedCovers ids={unlocked} avatar={avatar} onPick={setAvatar} />
        </section>
        {!isAdmin && soon.length > 0 && (
          <section>
            <h3 className="eyebrow">{t('avatar.soon')}</h3>
            <p className="small muted">{t('avatar.soonHint')}</p>
            <SoonCovers entries={soon} />
          </section>
        )}
        {isAdmin && (
          <section>
            <h3 className="eyebrow">{t('avatar.admin')}</h3>
            <p className="small muted">{t('avatar.adminHint')}</p>
            <AdminCovers avatar={avatar} onPick={setAvatar} />
          </section>
        )}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>{t('common.save')}</button>
        </div>
      </div>
    </Modal>
  );
}

// ----- Studio : choix d'une carte à exposer ------------------------------------------------

function ShowcasePicker({ slot, onClose }) {
  const { t, error, num } = useI18n();
  const { user, stats, applyState } = useGame();
  const toast = useToast();
  const [text, setText] = useState('');
  const [rarity, setRarity] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useDebounced(text.trim());
  // Cartes distinctes du joueur, les plus rares d'abord, cherchées par le serveur (titre, artiste, album).
  const list = usePaged(apiPath('/catalog/mine', { q, rarity }), CARDS_PAGE, registerTracks);
  const current = useMemo(() => user.showcase || [], [user.showcase]);
  const items = list.items.filter((tr) => !current.includes(tr.id));
  const ownedCount = stats.total?.owned ?? 0;

  const pick = async (trackId) => {
    if (busy) return;
    const slots = Array.from({ length: SHOWCASE_SLOTS }, (_, i) => current[i] || null);
    slots[slot] = trackId;
    setBusy(true);
    try {
      const res = await post('/profile/showcase', { slots });
      applyState(res.state);
      onClose();
    } catch (err) {
      toast(error(err.code), 'error');
      setBusy(false);
    }
  };

  let body;
  if (ownedCount === 0) body = <p className="empty">{t('studio.noCards')}</p>;
  else if (list.error && !list.items.length) body = <ErrorBox text={t('studio.loadError')} retryLabel={t('studio.retry')} onRetry={list.retry} />;
  else if (list.initial) {
    body = (
      <div className="card-grid card-grid--picker" aria-busy="true">
        {Array.from({ length: 12 }, (_, i) => <span key={i} className="card card--loading" aria-hidden="true" />)}
      </div>
    );
  } else if (!list.stale && !items.length && !list.hasMore) body = <p className="empty">{t('studio.noResult')}</p>;
  else {
    body = (
      <>
        <div className={`card-grid card-grid--picker${list.stale ? ' is-stale' : ''}`} aria-busy={list.loading || busy || undefined}>
          {items.map((tr) => (
            <Card key={tr.id} trackId={tr.id} variant={tr.holo ? 'holo' : 'std'} onClick={() => pick(tr.id)} />
          ))}
        </div>
        <MoreButton list={list} label={t('studio.loadMore')} remainingKey="studio.remaining" errorText={t('studio.loadError')} retryLabel={t('studio.retry')} />
      </>
    );
  }

  return (
    <Modal open onClose={onClose} title={t('studio.pick')} className="modal--wide">
      <div className="picker">
        {ownedCount > 0 && (
          <>
            <PickerSearch id="showcase-search" value={text} onChange={setText} placeholder={t('studio.search')} clearLabel={t('studio.clear')} />
            <div className="chips pf-chips" role="group" aria-label={t('studio.rarityLabel')}>
              <button type="button" className={`chip-btn${!rarity ? ' is-on' : ''}`} aria-pressed={!rarity} onClick={() => setRarity('')}>
                {t('studio.rarityAll')}<span className="pf-chip__n">{num(ownedCount)}</span>
              </button>
              {RARITIES.map((r) => {
                const n = stats.byRarity?.[r]?.owned ?? 0;
                if (!n && rarity !== r) return null;
                return (
                  <button key={r} type="button" className={`chip-btn pf-chip${rarity === r ? ' is-on' : ''}`} aria-pressed={rarity === r}
                    onClick={() => setRarity(rarity === r ? '' : r)}>
                    <RarityGem rarity={r} size={11} /> {t(`rarity.${r}`)}<span className="pf-chip__n">{num(n)}</span>
                  </button>
                );
              })}
            </div>
            <p className="small muted pf-count" aria-live="polite">
              {list.total != null ? t('studio.results', { n: list.total }) : t('common.loading')}
            </p>
          </>
        )}
        {body}
      </div>
    </Modal>
  );
}

// ----- en-tête et amis ---------------------------------------------------------------------

function FriendAction({ profile, onChange }) {
  const { t, error } = useI18n();
  const { refresh } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await onChange();
      refresh(); // pastille des demandes d'amis en attente
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  switch (profile.friendship) {
    case 'none':
      return <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => post('/friends/request', { username: profile.username }))}><Icon name="plus" /> {t('profile.add')}</button>;
    case 'outgoing':
      return (
        <span className="friend-state">
          <span className="chip">{t('profile.pending')}</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => post(`/friends/${profile.requestId}/decline`))}>{t('friends.cancel')}</button>
        </span>
      );
    case 'incoming':
      return <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => post(`/friends/${profile.requestId}/accept`))}>{t('profile.accept')}</button>;
    case 'friends':
      return (
        <span className="friend-state">
          <span className="chip chip--new"><Icon name="check" size={14} /> {t('profile.friends')}</span>
          <ConfirmButton className="btn btn--ghost btn--sm" confirmLabel={t('friends.removeConfirm', { name: profile.username })}
            onConfirm={() => run(() => del(`/friends/${profile.id}`))}>{t('friends.remove')}</ConfirmButton>
        </span>
      );
    default:
      return null;
  }
}

/** Artistes maîtrisés : les premiers, puis « +N autres » pour tout voir. */
function Masters({ ids }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => (open ? ids : ids.slice(0, MASTERS_SHOWN)), [ids, open]);
  const artists = useArtists(shown);
  if (!ids.length) return null;
  return (
    <div className="masters">
      {shown.map((id, i) => (
        <Link key={id} to={`/artist/${encodeURIComponent(id)}`} className="master-tag pf-master">
          <Icon name="star" size={12} /> {artists[i] ? t('artist.master', { name: artists[i].name }) : '…'}
        </Link>
      ))}
      {ids.length > MASTERS_SHOWN && (
        <button type="button" className="link-btn small pf-masters__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t('profile.mastersLess') : t('profile.mastersMore', { n: ids.length - MASTERS_SHOWN })}
        </button>
      )}
    </div>
  );
}

// ----- notes & critiques -------------------------------------------------------------------

function RatingsSection({ username, isSelf, refreshKey }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    // Les fiches des albums et morceaux cités arrivent avec la réponse (champ catalog, enregistré par api.js).
    get(`/users/${encodeURIComponent(username)}/ratings`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
  }, [username, refreshKey]);
  if (!data?.stats) return null;
  const s = data.stats;
  const topAlbums = data.topAlbums || [];
  const topTracks = data.topTracks || [];
  const reviews = data.reviews || [];
  return (
    <section className="ratings-profile">
      <header className="studio__head"><h2>{t('ratingsProfile.title')}</h2></header>
      {s.count === 0 ? (
        <p className="empty">{isSelf ? t('ratingsProfile.emptySelf') : t('ratingsProfile.emptyOther', { name: username })}</p>
      ) : (
        <div className="ratings-profile__grid">
          <div className="panel ratings-profile__stats">
            <dl className="mini-stats">
              <div><dt>{t('ratingsProfile.statRatings')}</dt><dd className="mono">{s.count}</dd></div>
              <div><dt>{t('ratingsProfile.statAlbums')}</dt><dd className="mono">{s.albums}</dd></div>
              <div><dt>{t('ratingsProfile.statReviews')}</dt><dd className="mono">{s.reviews}</dd></div>
              <div><dt>{t('ratingsProfile.statAverage')}</dt><dd><RatingValue value={s.average} average size={13} /></dd></div>
            </dl>
            <RatingHistogram distribution={s.distribution} />
          </div>
          {(topAlbums.length > 0 || topTracks.length > 0) && (
            <div className="ratings-profile__top">
              {topAlbums.length > 0 && (
                <>
                  <h3 className="studio__label">{t('ratingsProfile.favAlbums')}</h3>
                  <div className="top-albums">
                    {topAlbums.map((r) => (
                      <RatedItemLink key={r.id} type="album" id={r.id} className="top-album" coverClassName="top-album__cover" titleClassName="top-album__title">
                        <RatingValue value={r.score} size={12} />
                      </RatedItemLink>
                    ))}
                  </div>
                </>
              )}
              {topTracks.length > 0 && (
                <>
                  <h3 className="studio__label">{t('ratingsProfile.favTracks')}</h3>
                  <ol className="top-tracks">
                    {topTracks.map((r) => (
                      <li key={r.id}>
                        <RatedItemLink type="track" id={r.id} className="top-tracks__item" coverClassName="top-tracks__cover" titleClassName="top-tracks__title">
                          <RatingValue value={r.score} size={11} />
                        </RatedItemLink>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}
          {reviews.length > 0 && (
            <div className="ratings-profile__reviews">
              <h3 className="studio__label">{t('ratingsProfile.recent')}</h3>
              <ReviewList reviews={reviews} renderItem={(r) => (
                <RatedItemLink type={r.type} id={r.id} className="review__author" coverClassName="review__cover" titleClassName="review__name" />
              )} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ----- vinylthèque -------------------------------------------------------------------------

/** Étagère du profil : les vinyles les plus récents, puis toute l'étagère (120 au plus) à la demande. */
function ProfileShelf({ profile, isSelf }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const all = profile.vinyls || [];
  // Nombre total de vinyles : le profil n'envoie que les plus récents.
  const count = Math.max(all.length, profile.vinylCount ?? profile.stats?.albumsCompleted ?? 0);
  const foldable = all.length > SHELF_PREVIEW;
  const vinyls = foldable && !open ? all.slice(-SHELF_PREVIEW) : all;
  const upcoming = (profile.upcoming || []).slice(0, all.length ? 2 : 3);
  return (
    <>
      <VinylShelf
        vinyls={vinyls}
        count={count}
        upcoming={upcoming}
        mine={isSelf}
        title={isSelf ? t('vinyl.shelf') : t('vinyl.shelfOther', { name: profile.username })}
        emptyText={isSelf ? t('vinyl.emptySelf') : t('vinyl.emptyOther')}
      />
      {(foldable || count > all.length) && (
        <div className="pf-shelf-foot">
          {foldable && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(!open)} aria-expanded={open}>
              <Icon name={open ? 'close' : 'plus'} size={16} />
              {open ? t('profile.shelfLess') : t('profile.shelfMore', { n: all.length - SHELF_PREVIEW })}
            </button>
          )}
          {count > all.length && (!foldable || open) && (
            <p className="small muted">{t('profile.shelfCapped', { shown: all.length, n: count })}</p>
          )}
        </div>
      )}
    </>
  );
}

// ----- profil ------------------------------------------------------------------------------

/**
 * Profil du joueur connecté, construit à partir de l'état local (statistiques calculées par le serveur),
 * sous la même forme que le profil public renvoyé par GET /users/:username.
 */
function useOwnProfile() {
  const { user, stats, achievements, owned } = useGame();
  return useMemo(() => {
    const albums = stats.albums || {};
    // Vinyles : albums complétés encore au catalogue ; les plus récents, rangés du plus ancien au plus récent.
    const done = [...achievements.entries()].filter(([k]) => k.startsWith('album:') && albums[k.slice(6)])
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const vinyls = done.slice(0, VINYLS_MAX).reverse().map(([k, at]) => {
      const albumId = k.slice(6);
      return { albumId, at, edition: isHoloComplete(albumId, owned, albums[albumId].total) ? 'holo' : 'black' };
    });
    const masteredArtists = [...achievements.entries()].filter(([k]) => k.startsWith('artist:'))
      .sort((a, b) => b[1] - a[1]).map(([k]) => k.slice(7));
    // Prochains vinyles : les albums commencés les plus avancés.
    const upcoming = Object.entries(albums).filter(([, p]) => p.pct < 1)
      .sort((a, b) => b[1].pct - a[1].pct || b[1].owned - a[1].owned).slice(0, 3)
      .map(([albumId, progress]) => ({ albumId, progress }));
    return {
      self: true,
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      avatarColor: user.avatarColor,
      level: user.level,
      createdAt: user.createdAt,
      role: user.role,
      stats: {
        unique: stats.total.owned,
        total: stats.total.total,
        albumsCompleted: stats.albumsCompleted,
        albumsTotal: stats.catalog?.albums,
        artistsMastered: stats.artistsMastered,
        artistsTotal: stats.catalog?.artists,
        promos: stats.promos.owned,
        promosTotal: stats.promos.total,
      },
      showcase: Array.from({ length: SHOWCASE_SLOTS }, (_, i) => {
        const id = user.showcase?.[i];
        const mine = id && owned.get(id);
        return mine ? { trackId: id, variant: mine.holo ? 'holo' : 'std' } : null;
      }),
      vinyls,
      vinylCount: done.length,
      masteredArtists,
      upcoming,
    };
  }, [user, stats, achievements, owned]);
}

/** Profil public d'un autre joueur : { profile, status: 'loading' | 'ready' | 'notFound' | 'error', reload, retry }. */
function useOtherProfile(username, skip) {
  const [state, setState] = useState({ key: null, profile: null, status: 'loading' });
  const ticket = useRef(0);
  const load = useCallback(async () => {
    if (skip) return;
    const id = ++ticket.current;
    try {
      // Vinyles, maîtrises et cartes exposées arrivent avec leurs fiches (champ catalog, enregistré par api.js).
      const profile = await get(`/users/${encodeURIComponent(username)}`);
      if (id === ticket.current) setState({ key: username, profile, status: 'ready' });
    } catch (err) {
      if (id === ticket.current) setState((s) => ({ ...s, key: username, status: err?.status === 404 ? 'notFound' : 'error' }));
    }
  }, [username, skip]);
  useEffect(() => {
    load();
  }, [load]);
  // Autre joueur demandé : on n'affiche pas le profil précédent pendant le chargement.
  const fresh = state.key === username;
  return {
    profile: fresh ? state.profile : null,
    status: fresh ? state.status : 'loading',
    reload: load,
    retry: () => {
      setState({ key: null, profile: null, status: 'loading' });
      load();
    },
  };
}

export default function Profile() {
  const { username } = useParams();
  const { user, applyState, ratings } = useGame();
  const { t, date, error, num } = useI18n();
  const navigate = useNavigate();
  const openCard = useCardModal();
  const toast = useToast();
  const own = useOwnProfile();
  // Change dès qu'une de mes notes change : la section « Notes & critiques » se recharge alors.
  const ratingsSignature = useMemo(() => [...ratings].map(([k, v]) => `${k}=${v}`).join('|'), [ratings]);
  const isSelf = !username || username.toLowerCase() === user.username.toLowerCase();
  const other = useOtherProfile(username, isSelf);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [slot, setSlot] = useState(null);
  const closeAvatar = useCallback(() => setAvatarOpen(false), []);
  const closeSlot = useCallback(() => setSlot(null), []);

  if (!isSelf && other.status === 'notFound') {
    return <div className="empty-page"><p>{error('user_not_found')}</p><Link to="/friends" className="btn btn--ghost">{t('nav.friends')}</Link></div>;
  }
  if (!isSelf && other.status === 'error') {
    return (
      <div className="empty-page" role="alert">
        <p>{t('profile.loadError')}</p>
        <button type="button" className="btn btn--ghost" onClick={other.retry}>{t('profile.retry')}</button>
      </div>
    );
  }
  const profile = isSelf ? own : other.profile;
  if (!profile) return <div className="boot boot--inline"><Spinner /></div>;

  const removeFromShowcase = async (i) => {
    const slots = Array.from({ length: SHOWCASE_SLOTS }, (_, k) => user.showcase?.[k] || null);
    slots[i] = null;
    try {
      const res = await post('/profile/showcase', { slots });
      applyState(res.state);
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  const lvl = profile.level;
  const s = profile.stats || {};
  const showcase = Array.from({ length: SHOWCASE_SLOTS }, (_, i) => profile.showcase?.[i] || null);
  const stat = (value, total) => (
    <dd className="mono">{num(value ?? 0)}{total != null && <small>/{num(total)}</small>}</dd>
  );

  return (
    <div className="profile">
      <section className="profile-head">
        <div className="profile-head__avatar">
          <Avatar user={profile} size={120} />
          {isSelf && (
            <button type="button" className="profile-head__edit" onClick={() => setAvatarOpen(true)} aria-label={t('profile.edit')} title={t('profile.edit')}>
              <Icon name="edit" size={16} />
            </button>
          )}
        </div>
        <div className="profile-head__info">
          <h1>
            {profile.username}
            {profile.role === 'admin' && <span className="role-tag">{t('profile.admin')}</span>}
          </h1>
          <div className="level-line">
            <span className="level-chip mono">{t('profile.level', { n: lvl.level })}</span>
            <Progress value={lvl.xp - lvl.floor} max={lvl.next - lvl.floor} color="var(--cue)" size="sm" />
            <span className="small muted">{t('profile.xpToNext', { n: lvl.next - lvl.xp, l: lvl.level + 1 })}</span>
          </div>
          <p className="muted small">{t('profile.memberSince', { date: date(profile.createdAt) })}</p>
          <Masters key={profile.username} ids={profile.masteredArtists || []} />
          {!isSelf && <FriendAction profile={profile} onChange={other.reload} />}
        </div>
        <dl className="profile-stats">
          <div><dt>{t('profile.stats.unique')}</dt>{stat(s.unique, s.total)}</div>
          <div><dt>{t('profile.stats.albums')}</dt>{stat(s.albumsCompleted, s.albumsTotal)}</div>
          <div><dt>{t('profile.stats.artists')}</dt>{stat(s.artistsMastered, s.artistsTotal)}</div>
          <div><dt>{t('profile.stats.promos')}</dt>{stat(s.promos, s.promosTotal)}</div>
        </dl>
      </section>

      <ProfileShelf key={profile.username} profile={profile} isSelf={isSelf} />

      <section className="studio">
        <header className="studio__head">
          <h2>{isSelf ? t('studio.title') : t('studio.titleOther', { name: profile.username })}</h2>
        </header>

        <div className="studio__desk">
          <div className="studio__desk-head">
            <h3 className="studio__label">{isSelf ? t('studio.selection') : t('studio.selectionOther')}</h3>
            {isSelf && <p className="small muted">{t('studio.selectionHint')}</p>}
          </div>
          <div className="showcase">
            {showcase.map((item, i) => (
              item ? (
                <div key={i} className="showcase__slot">
                  <Card trackId={item.trackId} variant={item.variant} onClick={() => openCard(item.trackId)} />
                  {isSelf && <button type="button" className="showcase__remove" onClick={() => removeFromShowcase(i)} aria-label={t('studio.remove')}><Icon name="close" size={14} /></button>}
                </div>
              ) : isSelf ? (
                <button key={i} type="button" className="showcase__empty" onClick={() => setSlot(i)}>
                  <Icon name="plus" size={22} />
                  <span>{t('studio.add')}</span>
                </button>
              ) : (
                <div key={i} className="showcase__empty showcase__empty--static"><span>{t('studio.empty')}</span></div>
              )
            ))}
          </div>
        </div>
      </section>

      <RatingsSection username={profile.username} isSelf={isSelf} refreshKey={isSelf ? ratingsSignature : profile.id} />

      {isSelf && (
        <>
          {avatarOpen && <AvatarPicker onClose={closeAvatar} />}
          {slot !== null && <ShowcasePicker slot={slot} onClose={closeSlot} />}
          <div className="profile-actions">
            <button type="button" className="btn btn--ghost" onClick={() => navigate('/friends')}><Icon name="users" /> {t('nav.friends')}</button>
          </div>
        </>
      )}
    </div>
  );
}
