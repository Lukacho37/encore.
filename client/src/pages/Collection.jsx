// Page « Ma collection » : progression globale, puis un onglet par façon de parcourir la collection.
// Avec 20 000 albums au catalogue, rien n'est chargé d'un bloc : chaque liste interroge l'API page par page,
// avec recherche et filtres gardés dans l'adresse (le bouton précédent les retrouve).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigationType, useParams, useSearchParams } from 'react-router';
import { get } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { apiPath, registerCatalog, useApi, useArtists, useCatalogInfo } from '../state/catalog.js';
import { realCover, useCovers } from '../state/CoversContext.jsx';
import Card, { RarityGem } from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Icon, Progress, Spinner } from '../components/ui.jsx';
import { RarityGuideButton } from '../components/RarityGuide.jsx';
import { ECONOMY, FOCUS_CHANCE, RARITIES, RARITY } from '@shared/rules.js';
import { generatedArt } from '@shared/art.js';
import '../styles/collection.css';

const TABS = ['albums', 'cards', 'artists', 'promos', 'genres', 'decades'];
const SORTS = ['progress', 'popular', 'title', 'year', 'recent'];
const PAGE = { albums: 48, cards: 60, promos: 60, artists: 48 };
// Le serveur ne pagine pas au-delà de 10 000 résultats : il faut alors affiner la recherche.
const MAX_OFFSET = 10_000;
const SKELETONS = Array.from({ length: 12 }, (_, i) => i);

// Les listes de l'API apportent les données complètes : on les range dans le catalogue du site
// (cartes et fiches album s'affichent ensuite sans nouvelle requête).
const registerAlbums = (list) => registerCatalog({ albums: list });
const registerTracks = (list) => registerCatalog({ tracks: list });

// ----- petits outils ------------------------------------------------------------------------

/** Pourcentage lisible même pour une toute petite progression (0,04 % d'un catalogue de 240 000 cartes). */
function usePct() {
  const { lang } = useI18n();
  return useMemo(() => {
    const fmt = [0, 1, 2].map((d) => new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: d }));
    return (x) => {
      if (!x || x <= 0) return fmt[0].format(0);
      if (x >= 1) return fmt[0].format(1);
      if (x < 0.0001) return `< ${fmt[2].format(0.0001)}`;
      if (x < 0.01) return fmt[2].format(x);
      if (x < 0.1) return fmt[1].format(x);
      return fmt[0].format(Math.min(x, 0.99)); // jamais « 100 % » avant d'avoir tout
    };
  }, [lang]);
}

/** Couleur de barre lisible sur le fond sombre : la teinte vive de la palette, ou la claire si elle est trop sombre. */
function accent(palette = []) {
  const light = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return !Number.isNaN(n) && (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 >= 0.35;
  };
  return [palette[1], palette[2]].find((c) => c && light(c)) || 'var(--paper)';
}

/** Nom d'un genre ; un genre absent des dictionnaires garde son identifiant. */
function useGenreLabel() {
  const { t } = useI18n();
  return useCallback((id) => {
    const label = t(`genre.${id}`);
    return label === `genre.${id}` ? id : label;
  }, [t]);
}

/** Change quand la collection change : les listes gardées en mémoire sont alors rechargées. */
function useSignature() {
  const { user, stats, cards } = useGame();
  return `${user?.id}|${stats.total.owned}|${cards.length}`;
}

/** Filtres de l'onglet gardés dans l'adresse (?q=…&genre=…), remplacés sur place sans empiler l'historique. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const setRef = useRef(setParams);
  useEffect(() => {
    setRef.current = setParams;
  }, [setParams]);
  const update = useCallback((changes) => {
    setRef.current((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v == null || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      return next;
    }, { replace: true });
  }, []);
  return [params, update];
}

/** Champ de recherche relié au paramètre `q` de l'adresse : la requête part 250 ms après la dernière frappe. */
function useSearchText(params, update) {
  const urlQ = params.get('q') || '';
  const [text, setText] = useState(urlQ);
  const sent = useRef(urlQ);
  // Précédent / suivant : le champ reprend la recherche de l'adresse.
  useEffect(() => {
    if (urlQ !== sent.current) {
      sent.current = urlQ;
      setText(urlQ);
    }
  }, [urlQ]);
  useEffect(() => {
    const value = text.trim() ? text : '';
    if (value === sent.current) return undefined;
    const id = setTimeout(() => {
      sent.current = value;
      update({ q: value });
    }, 250);
    return () => clearTimeout(id);
  }, [text, update]);
  return [text, setText];
}

// Position de défilement de chaque entrée de l'historique (et de chaque onglet), rendue au retour par le bouton
// précédent (fiche album, artiste…).
const scrolls = new Map();

function rememberScroll(key, y) {
  scrolls.delete(key);
  scrolls.set(key, y);
  if (scrolls.size > 100) scrolls.delete(scrolls.keys().next().value);
}

/**
 * Garde la position de défilement de l'onglet `id` pour l'entrée d'historique en cours, et la rend au retour.
 * `restorable` : les éléments affichés au départ sont ceux d'avant (liste retrouvée en mémoire) ; sinon on ne
 * touche pas à la position.
 */
function useScrollMemory(id, restorable) {
  const location = useLocation();
  const navType = useNavigationType();
  const key = `${id}|${location.key}`;
  // Lue au premier affichage, avant que les effets n'enregistrent quoi que ce soit.
  const [saved] = useState(() => (navType === 'POP' && restorable ? scrolls.get(key) : undefined));
  const pending = useRef(saved != null); // position à rendre : on n'enregistre rien avant

  // Enregistrement pendant le défilement (une fois par image au plus) et au moment de quitter l'entrée.
  // Le nettoyage d'un effet de mise en page passe avant que la page suivante ne remplace celle-ci dans le DOM :
  // window.scrollY est encore celui de la collection (un effet ordinaire lirait celui de la page suivante).
  useLayoutEffect(() => {
    let raf = 0;
    const save = () => {
      raf = 0;
      if (!pending.current) rememberScroll(key, window.scrollY);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(save);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
      if (!pending.current) rememberScroll(key, window.scrollY);
    };
  }, [key]);

  // Retour : la liste est déjà affichée, le navigateur remet souvent lui-même la bonne position juste après.
  // On attend l'image suivante et on ne corrige que si elle diffère (retour en haut de page de l'application,
  // navigateur qui l'a appliquée avant que la liste ne soit là).
  useEffect(() => {
    if (!pending.current) return undefined;
    const raf = requestAnimationFrame(() => {
      pending.current = false;
      if (Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    });
    return () => cancelAnimationFrame(raf);
  }, [saved]);
}

// ----- listes paginées ----------------------------------------------------------------------

// Dernier état de chaque liste : en revenant sur l'onglet, les pages déjà chargées réapparaissent sans requête,
// tant que la collection n'a pas changé entre-temps (signature). Si elle a changé (booster ouvert sur une fiche
// album…), la liste d'avant reste affichée le temps de recharger d'un coup ses pages (jusqu'à RELOAD_PAGES) :
// la page garde sa hauteur et le bouton précédent retrouve la position de défilement.
const snapshots = new Map();
const RELOAD_PAGES = 5;
const EMPTY_LIST = { key: null, items: [], total: null, end: false, sig: null, loading: true, error: null };

const pageUrl = (key, offset, limit) => `${key}${key.includes('?') ? '&' : '?'}offset=${offset}&limit=${limit}`;

/**
 * Liste paginée d'une adresse de l'API (`key`, filtres compris) : { items, total, more, … }.
 * Les pages suivantes s'ajoutent aux précédentes ; une réponse arrivée après un changement de filtres est ignorée.
 */
function usePagedList(id, key, pageSize, register, signature) {
  const [initial] = useState(() => {
    const snap = snapshots.get(id);
    if (!snap || snap.key !== key) return null;
    if (snap.sig === signature) return { ...snap, loading: false, error: null };
    return snap.items.length <= pageSize * RELOAD_PAGES ? { ...snap, loading: true, error: null } : null;
  });
  const [state, setState] = useState(initial || EMPTY_LIST);
  const req = useRef(0);
  const latest = useRef(state);
  const sig = useRef(signature);
  useEffect(() => {
    latest.current = state;
    sig.current = signature;
  });

  const load = useCallback((offset) => {
    const ticket = ++req.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    get(pageUrl(key, offset, pageSize))
      .then((res) => {
        if (ticket !== req.current) return; // réponse d'une recherche dépassée
        const list = Array.isArray(res?.items) ? res.items : [];
        register(list);
        setState((s) => {
          const kept = offset > 0 && s.key === key ? s.items : [];
          const seen = new Set(kept.map((x) => x.id));
          const items = [...kept, ...list.filter((x) => !seen.has(x.id))];
          return {
            key,
            items,
            total: Number.isFinite(res.total) ? res.total : items.length,
            end: list.length < pageSize,
            sig: sig.current,
            loading: false,
            error: null,
          };
        });
      })
      .catch((error) => {
        if (ticket === req.current) setState((s) => ({ ...s, loading: false, error }));
      });
  }, [key, pageSize, register]);

  // Recharge les `count` premiers éléments en une fois ; la liste affichée reste en place jusqu'à la réponse.
  const reloadAll = useCallback((count) => {
    const ticket = ++req.current;
    const offsets = [];
    for (let offset = 0; offset < count; offset += pageSize) offsets.push(offset);
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all(offsets.map((offset) => get(pageUrl(key, offset, pageSize))))
      .then((pages) => {
        if (ticket !== req.current) return;
        const seen = new Set();
        const items = [];
        for (const res of pages) {
          const list = Array.isArray(res?.items) ? res.items : [];
          register(list);
          for (const x of list) {
            if (seen.has(x.id)) continue;
            seen.add(x.id);
            items.push(x);
          }
        }
        const last = pages[pages.length - 1];
        const lastCount = Array.isArray(last?.items) ? last.items.length : 0;
        setState({
          key,
          items,
          total: Number.isFinite(last?.total) ? last.total : items.length,
          end: lastCount < pageSize,
          sig: sig.current,
          loading: false,
          error: null,
        });
      })
      .catch(() => {
        // La liste d'avant reste affichée ; elle sera rechargée à la prochaine visite.
        if (ticket === req.current) setState((s) => ({ ...s, loading: false }));
      });
  }, [key, pageSize, register]);

  useEffect(() => {
    const s = latest.current;
    if (s.key === key && s.items.length && !s.error) {
      if (s.sig !== sig.current) {
        reloadAll(s.items.length);
        return;
      }
      // Liste déjà là : une réponse encore en route pour d'autres filtres ne doit plus s'afficher.
      req.current += 1;
      if (s.loading) setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    load(0);
  }, [key, load, reloadAll]);

  useEffect(() => () => {
    const s = latest.current;
    if (s.key && s.items.length) snapshots.set(id, { key: s.key, items: s.items, total: s.total, end: s.end, sig: s.sig });
  }, [id]);

  const fresh = state.key === key;
  const count = fresh ? state.items.length : 0;
  const more = fresh && !state.end && count < state.total;
  return {
    items: state.items,
    total: fresh ? state.total : null,
    loading: state.loading,
    error: state.error,
    initial: state.key === null,
    stale: !fresh && state.items.length > 0,
    restored: !!initial,
    hasMore: more && count < MAX_OFFSET,
    capped: more && count >= MAX_OFFSET,
    remaining: fresh ? Math.max(0, state.total - count) : 0,
    more: () => load(count),
    retry: () => load(count),
  };
}

function ErrorBox({ onRetry }) {
  const { t } = useI18n();
  return (
    <div className="empty coll-empty" role="alert">
      <p>{t('collection.loadError')}</p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>{t('collection.retry')}</button>
    </div>
  );
}

function Empty({ children, action = false }) {
  const { t } = useI18n();
  return (
    <div className="empty coll-empty">
      <p>{children}</p>
      {action && <Link to="/" className="btn btn--primary btn--sm"><Icon name="pack" size={16} /> {t('collection.openPack')}</Link>}
    </div>
  );
}

function LoadMore({ list }) {
  const { t } = useI18n();
  if (list.error && list.items.length) {
    return (
      <div className="coll-more" role="alert">
        <span className="muted small">{t('collection.loadError')}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={list.retry}>{t('collection.retry')}</button>
      </div>
    );
  }
  if (list.capped) return <p className="coll-more muted small">{t('collection.refine')}</p>;
  if (!list.hasMore) return null;
  return (
    <div className="coll-more">
      <button type="button" className="btn btn--ghost" onClick={list.more} disabled={list.loading}>
        {list.loading ? <Spinner /> : <Icon name="plus" size={16} />}
        {t('collection.loadMore')}
        <span className="coll-more__n">· {t('collection.remaining', { n: list.remaining })}</span>
      </button>
    </div>
  );
}

/** Corps d'une liste : emplacements vides au premier chargement, liste estompée pendant un changement de filtres. */
function ListBody({ list, className, skeleton, empty, children }) {
  if (list.error && !list.items.length) return <ErrorBox onRetry={list.retry} />;
  if (list.initial) return <div className={className} aria-busy="true">{skeleton}</div>;
  if (!list.stale && list.total === 0) return empty;
  return (
    <>
      <div className={`${className}${list.stale ? ' is-stale' : ''}`} aria-busy={list.loading || undefined}>{children}</div>
      <LoadMore list={list} />
    </>
  );
}

function SearchBox({ id, value, onChange, placeholder }) {
  const { t } = useI18n();
  return (
    <div className="search coll-search" role="search">
      <Icon name="search" />
      <label htmlFor={id} className="sr-only">{t('collection.search.label')}</label>
      <input id={id} type="search" className="input" value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} enterKeyHint="search"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }} />
      {value && (
        <button type="button" className="icon-btn coll-search__clear" onClick={() => onChange('')} aria-label={t('collection.search.clear')}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

// ----- éléments partagés --------------------------------------------------------------------

/** Pastille d'artiste : son initiale sur un visuel généré (palette tirée de son identifiant, ou `art` d'un album). */
export function ArtistBadge({ artist, size = 44, art }) {
  const seed = art?.seed || artist?.id || 'artist';
  const visual = art?.palette ? { ...art, seed } : { ...generatedArt(seed), seed };
  return (
    <span className="artist-badge" style={{ width: size, height: size }}>
      <CoverArt art={visual} generated />
      <span className="artist-badge__initial" style={{ fontSize: size * 0.42 }}>{artist?.name?.[0] || '?'}</span>
    </span>
  );
}

function RarityBar({ byRarity = {} }) {
  const { t, num } = useI18n();
  return (
    <div className="rarity-bar" aria-label={t('collection.byRarity')}>
      {RARITIES.map((r) => {
        const { owned = 0, total = 0 } = byRarity[r] || {};
        return (
          <div key={r} className="rarity-bar__item" style={{ '--rc': RARITY[r].color }}>
            <span className="rarity-bar__label"><RarityGem rarity={r} size={11} /> {t(`rarity.${r}`)}</span>
            <Progress value={owned} max={total} color={RARITY[r].color} size="sm" />
            <span className="mono small">{num(owned)}/{num(total)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Albums complétés, artistes maîtrisés et promos, rapportés à tout le catalogue. */
function Summary() {
  const { t, num } = useI18n();
  const { stats } = useGame();
  const items = [
    { key: 'albums', icon: 'disc', to: '/collection?mine=1', value: stats.albumsCompleted, total: stats.catalog?.albums },
    { key: 'artists', icon: 'star', to: '/collection/artists', value: stats.artistsMastered, total: stats.catalog?.artists },
    { key: 'promos', icon: 'pack', to: '/collection/promos', value: stats.promos?.owned, total: stats.promos?.total },
  ];
  return (
    <ul className="coll-summary">
      {items.map((s) => (
        <li key={s.key}>
          <Link to={s.to} className={`coll-summary__item${s.value > 0 ? ' is-on' : ''}`}>
            <span className="coll-summary__label"><Icon name={s.icon} size={15} /> {t(`collection.summary.${s.key}`)}</span>
            <span className="coll-summary__value mono">{num(s.value || 0)}<small> / {num(s.total || 0)}</small></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ProgressRows({ rows }) {
  const { t, num } = useI18n();
  const pct = usePct();
  return (
    <ul className="rows">
      {rows.map((r) => (
        <li key={r.key} className={`row${r.p.pct >= 1 ? ' row--done' : ''}`}>
          <span className="row__label">
            {r.to ? <Link to={r.to} className="coll-row-link" title={t('collection.seeAlbums', { label: r.label })}>{r.label}</Link> : r.label}
          </span>
          <Progress value={r.p.owned} max={r.p.total} color={r.color} label={r.label} />
          <span className="row__nums mono">{num(r.p.owned)}/{num(r.p.total)}</span>
          <span className="row__pct mono">{pct(r.p.pct)}</span>
        </li>
      ))}
    </ul>
  );
}

const CardCell = memo(function CardCell({ trackId, variant, count, ghost = false, onOpen }) {
  const open = useCallback(() => onOpen(trackId), [onOpen, trackId]);
  return (
    <div className="card-cell">
      <Card trackId={trackId} variant={variant} count={count} ghost={ghost} onClick={open} />
    </div>
  );
});

const CardSkeletons = SKELETONS.map((i) => <div key={i} className="card-cell"><span className="card card--loading" aria-hidden="true" /></div>);

// ----- onglet Albums ------------------------------------------------------------------------

const AlbumTile = memo(function AlbumTile({ album, owned }) {
  const { t } = useI18n();
  const covers = useCovers();
  const total = album.trackCount || 0;
  const done = total > 0 && owned >= total;
  // Le badge « Vinyle » ne se pose pas sur une vraie pochette : il passe sous l'image.
  const real = !!realCover(album.art, covers);
  const badge = done && <span className="album-tile__badge"><Icon name="disc" size={14} /> {t('collection.completed')}</span>;
  return (
    <Link to={`/album/${album.id}`} className={`album-tile${done ? ' album-tile--done' : ''}`}>
      <span className="album-tile__cover">
        <CoverArt art={album.art} sizes="(max-width: 700px) 45vw, 270px" />
        {!real && badge}
      </span>
      <span className="album-tile__meta">
        <span className="album-tile__title">{album.title}</span>
        <span className="album-tile__artist">{album.artist}{album.year ? <> · <span className="mono">{album.year}</span></> : null}</span>
        <span className="album-tile__progress">
          <Progress value={owned} max={total} color={accent(album.art?.palette)} size="sm" label={`${album.title} · ${owned}/${total}`} />
          <span className="mono small">{owned}/{total}</span>
          {real && badge}
        </span>
      </span>
    </Link>
  );
});

function AlbumSkeleton() {
  return (
    <span className="album-tile coll-skel" aria-hidden="true">
      <span className="album-tile__cover coll-skel__block" />
      <span className="coll-skel__line" />
      <span className="coll-skel__line coll-skel__line--short" />
    </span>
  );
}

const AlbumSkeletons = SKELETONS.map((i) => <AlbumSkeleton key={i} />);

function AlbumsTab() {
  const { t, num } = useI18n();
  const { stats } = useGame();
  const info = useCatalogInfo();
  const pct = usePct();
  const genreLabel = useGenreLabel();
  const signature = useSignature();
  const [params, update] = useFilters();
  const [text, setText] = useSearchText(params, update);
  const q = (params.get('q') || '').trim();
  const genre = params.get('genre') || '';
  const decade = /^\d{4}$/.test(params.get('decade') || '') ? params.get('decade') : '';
  const sort = SORTS.includes(params.get('sort')) ? params.get('sort') : 'progress';
  const mine = params.get('mine') === '1';
  const key = apiPath('/catalog/albums', { q, genre, decade, sort, mine: mine ? 1 : null });
  const list = usePagedList('albums', key, PAGE.albums, registerAlbums, signature);
  useScrollMemory('albums', list.restored);
  const filtered = !!(q || genre || decade || mine);
  const genres = [{ id: '', albums: info?.totals?.albums }, ...(info?.genres || [])];

  const reset = () => {
    setText('');
    update({ q: null, genre: null, decade: null, mine: null });
  };

  return (
    <>
      <p className="coll-hint">
        <Icon name="pack" size={16} />
        <span>{t('collection.howTo', { p: pct(FOCUS_CHANCE), n: ECONOMY.albumPackPrice })}</span>
      </p>
      <div className="coll-toolbar">
        <SearchBox id="collection-album-search" value={text} onChange={setText} placeholder={t('collection.search.albums')} />
        <label className="select">
          <span className="sr-only">{t('collection.decade')}</span>
          <select id="collection-decade" value={decade} onChange={(e) => update({ decade: e.target.value })}>
            <option value="">{t('collection.allDecades')}</option>
            {(info?.decades || []).map((d) => (
              <option key={d.decade} value={d.decade}>{t('decade', { d: d.decade })}</option>
            ))}
          </select>
        </label>
        <label className="select">
          <span className="sr-only">{t('collection.sort.label')}</span>
          <select id="collection-sort" value={sort} onChange={(e) => update({ sort: e.target.value === 'progress' ? null : e.target.value })}>
            {SORTS.map((s) => <option key={s} value={s}>{t(`collection.sort.${s}`)}</option>)}
          </select>
        </label>
        <button type="button" role="switch" aria-checked={mine} className={`coll-toggle${mine ? ' is-on' : ''}`} onClick={() => update({ mine: mine ? null : '1' })}>
          <span className={`switch${mine ? ' is-on' : ''}`} aria-hidden="true" />
          {t('collection.mine')}
        </button>
      </div>
      <div className="chips coll-chips" role="group" aria-label={t('collection.genre')}>
        {genres.map((g) => (
          <button key={g.id || 'all'} type="button" className={`chip-btn${genre === g.id ? ' is-on' : ''}`} aria-pressed={genre === g.id} onClick={() => update({ genre: g.id })}>
            {g.id ? genreLabel(g.id) : t('collection.all')}
            {g.albums != null && <span className="coll-chip__n">{num(g.albums)}</span>}
          </button>
        ))}
      </div>
      <div className="coll-count">
        <span aria-live="polite">{list.total != null ? t('collection.albums', { n: list.total }) : (list.loading ? <Spinner /> : null)}</span>
        {filtered && <button type="button" className="btn btn--quiet btn--xs" onClick={reset}>{t('collection.resetFilters')}</button>}
      </div>
      <ListBody list={list} className="album-grid" skeleton={AlbumSkeletons}
        empty={<Empty action={mine && !q && !genre && !decade}>{mine && !q && !genre && !decade ? t('collection.empty.mine') : t('collection.empty.albums')}</Empty>}>
        {list.items.map((a) => <AlbumTile key={a.id} album={a} owned={stats.albums[a.id]?.owned ?? a.owned ?? 0} />)}
      </ListBody>
    </>
  );
}

// ----- onglet Mes cartes --------------------------------------------------------------------

function CardsTab() {
  const { t, num } = useI18n();
  const { stats, owned } = useGame();
  const openCard = useCardModal();
  const signature = useSignature();
  const [params, update] = useFilters();
  const [text, setText] = useSearchText(params, update);
  const q = (params.get('q') || '').trim();
  const rarity = RARITIES.includes(params.get('rarity')) ? params.get('rarity') : '';
  const list = usePagedList('cards', apiPath('/catalog/mine', { q, rarity }), PAGE.cards, registerTracks, signature);
  useScrollMemory('cards', list.restored);

  return (
    <>
      <div className="coll-toolbar">
        <SearchBox id="collection-card-search" value={text} onChange={setText} placeholder={t('collection.search.cards')} />
      </div>
      <div className="chips coll-chips" role="group" aria-label={t('collection.rarityFilter')}>
        <button type="button" className={`chip-btn${!rarity ? ' is-on' : ''}`} aria-pressed={!rarity} onClick={() => update({ rarity: null })}>
          {t('collection.all')}<span className="coll-chip__n">{num(stats.total.owned)}</span>
        </button>
        {RARITIES.map((r) => {
          const n = stats.byRarity?.[r]?.owned ?? 0;
          return (
            <button key={r} type="button" className={`chip-btn coll-chip--rarity${rarity === r ? ' is-on' : ''}`} aria-pressed={rarity === r}
              disabled={!n && rarity !== r} onClick={() => update({ rarity: rarity === r ? null : r })}>
              <RarityGem rarity={r} size={11} /> {t(`rarity.${r}`)}<span className="coll-chip__n">{num(n)}</span>
            </button>
          );
        })}
      </div>
      <div className="coll-count">
        <span aria-live="polite">{list.total != null ? t('collection.cards', { n: list.total }) : (list.loading ? <Spinner /> : null)}</span>
      </div>
      <ListBody list={list} className="card-grid" skeleton={CardSkeletons}
        empty={q || rarity ? <Empty>{t('collection.empty.cards')}</Empty> : <Empty action>{t('collection.empty.cardsStart')}</Empty>}>
        {list.items.map((tr) => {
          const mine = owned.get(tr.id);
          return (
            <CardCell key={tr.id} trackId={tr.id} variant={tr.holo || mine?.holo > 0 ? 'holo' : 'std'}
              count={mine ? mine.std + mine.holo : 1} onOpen={openCard} />
          );
        })}
      </ListBody>
    </>
  );
}

// ----- onglet Artistes ----------------------------------------------------------------------

let artistsShown = PAGE.artists; // nombre d'artistes affichés, retrouvé au retour sur l'onglet

const ArtistRow = memo(function ArtistRow({ id, artist, p, mastered }) {
  const { t, country } = useI18n();
  const genreLabel = useGenreLabel();
  if (!artist) {
    return (
      <li aria-hidden="true">
        <span className="artist-row coll-skel-row">
          <span className="artist-badge coll-skel__block" style={{ width: 44, height: 44 }} />
          <span className="coll-skel__line coll-skel__line--short" />
        </span>
      </li>
    );
  }
  const meta = [
    t('collection.albums', { n: artist.albumCount || 0 }),
    artist.genre && genreLabel(artist.genre),
    artist.country && country(artist.country),
  ].filter(Boolean).join(' · ');
  return (
    <li>
      <Link to={`/artist/${id}`} className={`artist-row${mastered ? ' artist-row--master' : ''}`}>
        <ArtistBadge artist={artist} />
        <span className="artist-row__text">
          <span className="artist-row__name">
            {artist.name}
            {mastered && <span className="master-tag"><Icon name="star" size={12} /> {t('collection.mastered')}</span>}
          </span>
          <span className="muted small">{meta}</span>
        </span>
        <span className="artist-row__progress">
          <Progress value={p.owned} max={p.total} color={mastered ? 'var(--gold)' : 'var(--cue)'} label={`${artist.name} · ${p.owned}/${p.total}`} />
          <span className="mono small">{p.owned}/{p.total}</span>
        </span>
      </Link>
    </li>
  );
});

function ArtistsTab() {
  const { t } = useI18n();
  const { stats, achievements } = useGame();
  const [shown, setShown] = useState(() => artistsShown);
  useEffect(() => {
    artistsShown = shown;
  }, [shown]);
  useScrollMemory('artists', true);
  // Seuls les artistes commencés figurent dans les statistiques : les plus avancés d'abord.
  const ids = useMemo(() => Object.entries(stats.artists || {})
    .sort(([a, pa], [b, pb]) => pb.pct - pa.pct || pb.owned - pa.owned || (a < b ? -1 : a > b ? 1 : 0))
    .map(([id]) => id), [stats.artists]);
  const visible = useMemo(() => ids.slice(0, shown), [ids, shown]);
  const artists = useArtists(visible);
  const mastered = stats.artistsMastered || 0;

  if (!ids.length) return <Empty action>{t('collection.empty.artists')}</Empty>;
  return (
    <>
      <div className="coll-count">
        <span>{t('collection.artistsStarted', { n: ids.length })}{mastered > 0 ? ` · ${t('collection.artistsMastered', { n: mastered })}` : ''}</span>
      </div>
      <ul className="artist-list">
        {visible.map((id, i) => (
          <ArtistRow key={id} id={id} artist={artists[i]} p={stats.artists[id]} mastered={achievements.has(`artist:${id}`)} />
        ))}
      </ul>
      {shown < ids.length && (
        <div className="coll-more">
          <button type="button" className="btn btn--ghost" onClick={() => setShown((n) => n + PAGE.artists)}>
            <Icon name="plus" size={16} />
            {t('collection.loadMore')}
            <span className="coll-more__n">· {t('collection.remaining', { n: ids.length - shown })}</span>
          </button>
        </div>
      )}
    </>
  );
}

// ----- onglet Promos ------------------------------------------------------------------------

function PromosTab() {
  const { t } = useI18n();
  const { stats, owned } = useGame();
  const openCard = useCardModal();
  // La liste des promos ne dépend pas du joueur : ce qu'il possède vient de useGame(), toujours à jour.
  const list = usePagedList('promos', '/catalog/promos', PAGE.promos, registerTracks, 'catalog');
  useScrollMemory('promos', list.restored);
  return (
    <>
      <p className="intro">{t('collection.promoIntro')}</p>
      <div className="coll-count">
        <span>{t('collection.promoCount', { owned: stats.promos?.owned || 0, total: stats.promos?.total || 0 })}</span>
      </div>
      <ListBody list={list} className="card-grid" skeleton={CardSkeletons} empty={<Empty>{t('collection.empty.promos')}</Empty>}>
        {list.items.map((tr) => {
          const mine = owned.get(tr.id);
          return (
            <CardCell key={tr.id} trackId={tr.id} variant={mine?.holo ? 'holo' : 'std'} ghost={!mine}
              count={mine ? mine.std + mine.holo : 0} onOpen={openCard} />
          );
        })}
      </ListBody>
    </>
  );
}

// ----- onglets Genres et Décennies ----------------------------------------------------------

function GroupsTab({ by }) {
  const { t } = useI18n();
  const genreLabel = useGenreLabel();
  const { data, error, reload } = useApi(`/catalog/groups?by=${by}`);
  if (error && !data) return <ErrorBox onRetry={reload} />;
  if (!data) {
    return <ul className="rows" aria-busy="true">{SKELETONS.slice(0, 8).map((i) => <li key={i} className="row coll-skel-row" />)}</ul>;
  }
  const groups = Array.isArray(data.groups) ? data.groups : [];
  if (!groups.length) return <Empty>{t('collection.empty.groups')}</Empty>;
  const rows = groups.map((g) => ({
    key: g.key,
    label: by === 'genre' ? genreLabel(g.key) : t('decade', { d: g.key }),
    to: `/collection?${by}=${encodeURIComponent(g.key)}`,
    p: g,
    color: by === 'genre' ? 'var(--cue)' : 'var(--r-legendary)',
  }));
  return <ProgressRows rows={rows} />;
}

// ----- page ---------------------------------------------------------------------------------

// Changement d'onglet : la barre d'onglets reste à la même hauteur à l'écran (sinon le retour en haut
// de page fait à chaque changement d'adresse cache le contenu sous le résumé, surtout sur téléphone).
let tabsOffset = null;

export default function Collection() {
  const { tab: pathTab } = useParams();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const { stats } = useGame();
  const pct = usePct();
  const navRef = useRef(null);
  // L'onglet est dans le chemin (/collection/cards) ; ?tab=… est aussi accepté.
  const queryTab = params.get('tab');
  const tab = TABS.includes(pathTab) ? pathTab : TABS.includes(queryTab) ? queryTab : 'albums';

  useEffect(() => {
    // Onglet actif hors de la barre (étroite sur téléphone) : la barre défile jusqu'à lui.
    const nav = navRef.current;
    const active = nav?.querySelector('.tabs__tab.active');
    if (active) {
      const left = active.getBoundingClientRect().left - nav.getBoundingClientRect().left;
      if (left < 0 || left + active.offsetWidth > nav.clientWidth) nav.scrollLeft += left - 16;
    }
    if (tabsOffset == null) return undefined;
    const raf = requestAnimationFrame(() => {
      const bar = navRef.current;
      if (bar) {
        const margin = parseFloat(getComputedStyle(bar).scrollMarginTop) || 0; // hauteur de la barre du haut
        const top = bar.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, Math.max(0, top - Math.max(tabsOffset, margin)));
      }
      tabsOffset = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [tab]);
  const onTabClick = () => {
    tabsOffset = navRef.current ? navRef.current.getBoundingClientRect().top : null;
  };

  return (
    <div className="collection">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('collection.title')}</span>
          <h1>{t('collection.overall', { owned: stats.total.owned, total: stats.total.total })}</h1>
        </div>
        <div className="page-head__progress">
          <Progress value={stats.total.owned} max={stats.total.total} color="var(--paper)" size="lg" label={t('collection.title')} />
          <span className="mono">{pct(stats.total.pct)}</span>
        </div>
      </header>

      <Summary />
      <RarityBar byRarity={stats.byRarity} />
      <div className="rarity-help"><RarityGuideButton /></div>

      <nav className="tabs coll-tabs" aria-label={t('collection.title')} ref={navRef}>
        {TABS.map((id) => (
          <Link key={id} to={id === 'albums' ? '/collection' : `/collection/${id}`} className={`tabs__tab${tab === id ? ' active' : ''}`}
            aria-current={tab === id ? 'page' : undefined} onClick={onTabClick}>
            {t(`collection.tabs.${id}`)}
          </Link>
        ))}
      </nav>

      {tab === 'albums' && <AlbumsTab />}
      {tab === 'cards' && <CardsTab />}
      {tab === 'artists' && <ArtistsTab />}
      {tab === 'promos' && <PromosTab />}
      {tab === 'genres' && <GroupsTab key="genre" by="genre" />}
      {tab === 'decades' && <GroupsTab key="decade" by="decade" />}
    </div>
  );
}
