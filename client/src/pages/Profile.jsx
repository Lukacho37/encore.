// Studio d'un joueur (/studio, /u/:pseudo, /u/:pseudo/:onglet) — P0 restylé, refait par P1-B (PLAN.md 2.5, 4.2.3).
// En-tête (StudioHeader : avatar et son cadre, bio, niveau, amis, actions), onglets Vue d'ensemble · Critiques ·
// Listes · Vinyles · Badges · Posts, et la vue d'ensemble en blocs (StudioBlocks) que le joueur masque et réordonne
// dans l'éditeur (StudioEditor : bio, confidentialité, favoris, vinyle mis en avant, listes épinglées, cosmétiques).
// Données : GET /api/users/:pseudo (le serveur applique la confidentialité : `access: 'header'` = en-tête seulement).
// Pour son propre Studio, la collection (vitrine, vinylthèque, chiffres, maîtrises) vient de l'état du jeu, à jour
// sans attendre ; les réglages (bio, blocs, favoris…) viennent du serveur. La photo de profil (pochette d'un album
// complété, vraie pochette : DESIGN-OVERRIDE point 5) et le choix des cartes exposées restent ceux d'avant.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router';
import { get, post } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { apiPath, registerCatalog, useAlbums, useApi } from '../state/catalog.js';
import Card, { RarityGem } from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { Avatar, Icon, Modal, Spinner, useToast } from '../components/ui.jsx';
import { EmptyState, ErrorBox as LoadError } from '../components/feedback.jsx';
import { AVATAR_COLORS, RARITIES, SHOWCASE_SLOTS } from '@shared/rules.js';
import { isHoloComplete } from '../components/Vinyl.jsx';
import { StudioHeader } from '../components/studio/StudioHeader.jsx';
import { StudioBlocks, tabPath } from '../components/studio/StudioBlocks.jsx';
import { StudioEditor } from '../components/studio/StudioEditor.jsx';
import { ReviewsTab, VinylsTab } from '../components/studio/StudioTabs.jsx';
import { STUDIO_TABS, blocksOf } from '../components/studio/blocks.js';
import { UserLists } from '../components/lists/UserLists.jsx';
import { UserPosts } from '../components/social/UserPosts.jsx';
import { BadgeGrid } from '../components/play/slots.jsx';
import '../styles/profile.css';
import '../styles/studio.css';

// Le catalogue compte des dizaines de milliers d'albums : le profil ne parcourt jamais tout le catalogue.
// Les choix (cartes du Studio, pochettes) se font par pages, avec une recherche envoyée au serveur.

const VINYLS_MAX = 120; // vinyles de son étagère pris dans l'état du jeu (les plus récents), comme le Studio d'un autre
const CARDS_PAGE = 36; // cartes par page dans le choix du Studio
const COVERS_PAGE = 36; // pochettes par page dans le choix de la photo
const SOON_MAX = 8; // albums presque complets proposés (verrouillés) dans le choix de la photo
const enc = encodeURIComponent;

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
    const slots = Array.from({ length: user.slots?.showcase ?? SHOWCASE_SLOTS }, (_, i) => current[i] || null);
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

// ----- profil ------------------------------------------------------------------------------------

/**
 * Partie « collection » de son propre Studio, construite à partir de l'état local (statistiques calculées par le
 * serveur), sous la même forme que le Studio renvoyé par GET /users/:username : à jour dès qu'une carte arrive.
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
    const slots = user.slots?.showcase ?? SHOWCASE_SLOTS;
    return {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      avatarColor: user.avatarColor,
      level: user.level,
      createdAt: user.createdAt,
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
      showcase: Array.from({ length: slots }, (_, i) => {
        const id = user.showcase?.[i];
        const mine = id && owned.get(id);
        return mine ? { trackId: id, variant: mine.holo ? 'holo' : 'std' } : null;
      }),
      cosmetics: user.cosmetics || {},
      vinyls,
      vinylCount: done.length,
      masteredArtists,
      upcoming,
      friendship: 'self',
    };
  }, [user, stats, achievements, owned]);
}

/** Onglets du Studio (liens : l'onglet se garde dans l'adresse, retour arrière compris). */
function StudioTabsNav({ base, current }) {
  const { t } = useI18n();
  return (
    <nav className="tabs st-tabs" aria-label={t('studio.tabs.label')}>
      {STUDIO_TABS.map((id) => (
        <NavLink key={id} to={tabPath(base, id)} end className={`tabs__tab${current === id ? ' active' : ''}`}
          aria-current={current === id ? 'page' : undefined} data-studio-tab-link={id}>
          {t(`studio.tabs.${id}`)}
        </NavLink>
      ))}
    </nav>
  );
}

/** Studio « amis » ou « privé » d'un autre : l'en-tête, puis ce message (la demande d'ami est dans l'en-tête). */
function Restricted({ profile }) {
  const { t } = useI18n();
  const friendsOnly = profile.user?.visibility === 'friends';
  return (
    <div className="st-restricted" data-studio-restricted={profile.user?.visibility || 'private'}>
      <EmptyState icon="lock" title={friendsOnly ? t('studio.restricted.friendsTitle') : t('studio.restricted.privateTitle')}
        body={friendsOnly ? t('studio.restricted.friendsBody', { name: profile.username }) : t('studio.restricted.privateBody', { name: profile.username })} />
    </div>
  );
}

/** Squelette du Studio le temps du premier chargement (même gabarit que l'en-tête et les blocs). */
function StudioSkeleton() {
  return (
    <div className="profile st-studio" aria-busy="true">
      <section className="profile-head st-head st-head--skel"><span className="st-skel st-skel--avatar" /><span className="st-skel st-skel--lines" /></section>
      <div className="st-blocks"><span className="st-skel st-skel--block" /><span className="st-skel st-skel--block" /></div>
    </div>
  );
}

export default function Profile() {
  const { username, tab: rawTab } = useParams();
  const { user, applyState } = useGame();
  const { t, error } = useI18n();
  const toast = useToast();
  const own = useOwnProfile();
  const isSelf = !username || username.toLowerCase() === user.username.toLowerCase();
  const name = isSelf ? user.username : username;
  const base = username ? `/u/${enc(username)}` : '/studio';
  const tab = STUDIO_TABS.includes(rawTab) ? rawTab : 'overview';
  const remote = useApi(`/users/${enc(name)}`, { keep: false });
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [slot, setSlot] = useState(null);
  const [editor, setEditor] = useState(null); // onglet ouvert de l'éditeur, ou null
  const closeAvatar = useCallback(() => setAvatarOpen(false), []);
  const closeSlot = useCallback(() => setSlot(null), []);
  const closeEditor = useCallback(() => setEditor(null), []);
  const { reload } = remote;
  // Studio d'un autre joueur : on ne garde pas les données du précédent pendant le chargement.
  const data = remote.data && remote.data.username?.toLowerCase() === name.toLowerCase() ? remote.data : null;

  // Un blocage depuis le menu ⋯ (en-tête) : le Studio est relu (il n'existe plus pour nous).
  useEffect(() => {
    const onBlocks = () => reload();
    window.addEventListener('albummania:blocks', onBlocks);
    return () => window.removeEventListener('albummania:blocks', onBlocks);
  }, [reload]);

  const notFound = remote.error && (remote.error.status === 404 || remote.error.code === 'user_not_found');
  if (!isSelf && notFound) {
    return (
      <div className="empty-page">
        <p>{error('user_not_found')}</p>
        <Link to="/friends" className="btn btn--ghost">{t('nav.friends')}</Link>
      </div>
    );
  }
  if (!isSelf && remote.error) {
    return <div className="empty-page"><LoadError error={remote.error} onRetry={reload} /></div>;
  }
  if (!isSelf && !data) return <StudioSkeleton />;

  // Son Studio : la collection vient de l'état du jeu, les réglages du serveur (vides le temps de les lire).
  const profile = isSelf
    ? { ...(data || {}), ...own, user: { ...(data?.user || {}), id: user.id, username: user.username }, access: 'full', relation: 'self' }
    : data;
  const blocks = blocksOf(profile.blocks);

  const removeFromShowcase = async (i) => {
    const slots = Array.from({ length: user.slots?.showcase ?? SHOWCASE_SLOTS }, (_, k) => user.showcase?.[k] || null);
    slots[i] = null;
    try {
      const res = await post('/profile/showcase', { slots });
      applyState(res.state);
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  const restricted = profile.access === 'header';
  let body;
  if (restricted) body = <Restricted profile={profile} />;
  else if (tab === 'overview') {
    body = isSelf && !data && !remote.error ? (
      <div className="st-blocks" aria-busy="true"><span className="st-skel st-skel--block" /><span className="st-skel st-skel--block" /></div>
    ) : (
      <StudioBlocks profile={profile} isSelf={isSelf} blocks={blocks} base={base} onEdit={(which) => setEditor(which || 'profile')}
        onPickSlot={setSlot} onRemoveSlot={removeFromShowcase} />
    );
  } else if (tab === 'reviews') body = <ReviewsTab username={profile.username} isSelf={isSelf} />;
  else if (tab === 'lists') body = <div className="st-tab" data-studio-tab="lists"><UserLists username={profile.username} editable={isSelf} /></div>;
  else if (tab === 'vinyls') body = <VinylsTab profile={profile} isSelf={isSelf} />;
  else if (tab === 'badges') body = <div className="st-tab" data-studio-tab="badges"><BadgeGrid username={profile.username} /></div>;
  else if (tab === 'posts') body = <div className="st-tab" data-studio-tab="posts"><UserPosts username={profile.username} /></div>;

  return (
    <div className="profile st-studio" data-studio={profile.username} data-access={profile.access}>
      <StudioHeader profile={profile} isSelf={isSelf} onEdit={() => setEditor('profile')} onEditPhoto={() => setAvatarOpen(true)} onChange={reload} />
      {!restricted && <StudioTabsNav base={base} current={tab} />}
      {body}
      {isSelf && (
        <>
          {avatarOpen && <AvatarPicker onClose={closeAvatar} />}
          {slot !== null && <ShowcasePicker slot={slot} onClose={closeSlot} />}
          <StudioEditor open={editor !== null} tab={editor || 'profile'} onClose={closeEditor} onSaved={reload} />
        </>
      )}
    </div>
  );
}
