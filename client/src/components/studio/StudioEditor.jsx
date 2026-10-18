// Éditeur du Studio — chantier P1-B (PLAN.md 2.5, 4.2.3, 6.6). Une fenêtre à cinq onglets, chacun enregistré à part
// (le serveur valide tout : longueurs, liens, propriété, cosmétiques débloqués) :
//   Profil       bio (280 caractères, UgcText à l'affichage) et confidentialité (Public / Amis / Privé) → PUT /me/profile
//   Blocs        afficher / masquer et réordonner les blocs de la vue d'ensemble (boutons ↑ ↓ : clavier compris) → PUT /me/studio
//   Favoris      5 artistes et 5 morceaux (recherche globale limitée au type), 5 genres → PUT /me/favorites/:kind
//   À la une     vinyle mis en avant (ses albums complétés, ou « le plus récent »), 3 listes épinglées → PUT /me/studio
//   Cosmétiques  cadre, couleur de vinyle, thème, titre (GET /me/cosmetics ; verrouillés avec leur niveau) → PUT /me/cosmetics
// Props : { open, tab (onglet ouvert d'abord), onClose(), onSaved() (le Studio se relit) }.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { get, put } from '../../api.js';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbums, useArtists, useApi } from '../../state/catalog.js';
import { COSMETIC_KINDS, LEVEL_COSMETICS, parseCosmetic } from '@shared/cosmetics.js';
import { THEME_GENRES } from '@shared/rules.js';
import CoverArt from '../CoverArt.jsx';
import { Avatar, Icon, Modal, Spinner, useToast } from '../ui.jsx';
import { ErrorBox } from '../feedback.jsx';
import { RatedItemLink } from '../Rating.jsx';
import { Disc } from '../Vinyl.jsx';
import { ArtistBadge } from '../search/ArtistBadge.jsx';
import { SearchCombobox } from '../search/SearchCombobox.jsx';
import { BIO_MAX, BLOCK_IDS, FAVORITES_MAX, FEATURED_LISTS_MAX, blocksOf } from './blocks.js';
import { VisibilityChoice } from './VisibilityChoice.jsx';
import '../../styles/studio.css';

export const EDITOR_TABS = ['profile', 'blocks', 'favorites', 'spotlight', 'cosmetics'];
const VINYLS_PAGE = 36;

/** Enregistrement d'un onglet : { busy, save(fn) } ; un message de réussite, ou l'erreur traduite. */
function useSave(onSaved) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (fn) => {
    setBusy(true);
    try {
      await fn();
      toast(t('studio.editor.saved'), 'success');
      onSaved?.();
      return true;
    } catch (err) {
      toast(error(err.code), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}

function SaveBar({ busy, disabled, onSave }) {
  const { t } = useI18n();
  return (
    <div className="st-editor__save">
      <button type="button" className="btn btn--primary" onClick={onSave} disabled={busy || disabled} data-studio-save="">
        {busy ? <Spinner /> : <Icon name="check" size={16} />} {t('studio.editor.save')}
      </button>
    </div>
  );
}

// ----- profil ---------------------------------------------------------------------------------------------

function ProfileTab({ data, onSaved }) {
  const { t } = useI18n();
  const [bio, setBio] = useState(data.bio || '');
  const [visibility, setVisibility] = useState(data.visibility || 'public');
  const { busy, save } = useSave(onSaved);
  const length = [...bio].length;
  return (
    <div className="st-editor__tab">
      <div className="field">
        <label className="field__label" htmlFor="st-bio">{t('studio.editor.bio')}</label>
        <textarea id="st-bio" className="input textarea st-editor__bio" rows={4} value={bio} maxLength={BIO_MAX + 40}
          placeholder={t('studio.editor.bioPlaceholder')} onChange={(e) => setBio(e.target.value)} aria-describedby="st-bio-hint" />
        <span className="st-editor__count small mono" aria-live="polite" data-over={length > BIO_MAX || undefined}>
          {t('studio.editor.bioCount', { n: length, max: BIO_MAX })}
        </span>
        <span className="field__hint" id="st-bio-hint">{t('studio.editor.bioHint')}</span>
      </div>
      <div className="field">
        <span className="field__label">{t('studio.editor.visibility')}</span>
        <VisibilityChoice value={visibility} onChange={setVisibility} />
        <span className="field__hint">{t('studio.privacy.hint')}</span>
      </div>
      <SaveBar busy={busy} disabled={length > BIO_MAX} onSave={() => save(() => put('/me/profile', { bio: bio.trim() || null, visibility }))} />
    </div>
  );
}

// ----- blocs ----------------------------------------------------------------------------------------------

function BlocksTab({ data, onSaved }) {
  const { t } = useI18n();
  const [blocks, setBlocks] = useState(() => blocksOf(data.blocks));
  const { busy, save } = useSave(onSaved);
  const move = (i, d) => setBlocks((list) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const toggle = (id) => setBlocks((list) => list.map((b) => (b.id === id ? { ...b, on: !b.on } : b)));
  return (
    <div className="st-editor__tab">
      <p className="small muted">{t('studio.editor.blocksHint')}</p>
      <ol className="st-blocklist">
        {blocks.map((b, i) => {
          const name = t(`studio.blocks.${b.id}`);
          return (
            <li key={b.id} className={`st-blocklist__row${b.on ? '' : ' is-off'}`} data-block-row={b.id}>
              <span className="st-blocklist__n mono">{i + 1}</span>
              <span className="st-blocklist__name">{name}</span>
              <span className="st-blocklist__state small muted">{b.on ? t('studio.editor.shown') : t('studio.editor.hidden')}</span>
              <button type="button" className="sh-set__switch st-blocklist__switch" role="switch" aria-checked={b.on}
                aria-label={t('studio.editor.toggle', { name })} onClick={() => toggle(b.id)}>
                <span className={`switch${b.on ? ' is-on' : ''}`} aria-hidden="true" />
              </button>
              <span className="st-blocklist__moves">
                <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('studio.editor.up', { name })}>
                  <span className="st-rot-up"><Icon name="chevron" size={16} /></span>
                </button>
                <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label={t('studio.editor.down', { name })}>
                  <span className="st-rot-down"><Icon name="chevron" size={16} /></span>
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="st-editor__row">
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setBlocks(BLOCK_IDS.map((id) => ({ id, on: true })))}>{t('studio.editor.reset')}</button>
      </div>
      <SaveBar busy={busy} onSave={() => save(() => put('/me/studio', { blocks }))} />
    </div>
  );
}

// ----- favoris --------------------------------------------------------------------------------------------

function FavArtists({ ids, onChange }) {
  const { t } = useI18n();
  const artists = useArtists(ids);
  const full = ids.length >= FAVORITES_MAX;
  return (
    <section className="st-fav">
      <header className="st-fav__head">
        <h3 className="studio__label">{t('studio.editor.favArtists')}</h3>
        <span className="chip chip--sm mono">{t('studio.editor.favCount', { n: ids.length, max: FAVORITES_MAX })}</span>
      </header>
      {ids.length > 0 && (
        <ul className="st-fav__chips">
          {ids.map((id, i) => (
            <li key={id} className="st-fav__chip">
              <ArtistBadge artist={artists[i] || { id, name: '?' }} size={28} />
              <span>{artists[i]?.name || '…'}</span>
              <button type="button" className="icon-btn" onClick={() => onChange(ids.filter((x) => x !== id))} aria-label={t('studio.editor.remove', { name: artists[i]?.name || id })}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {full ? <p className="small muted">{t('studio.editor.favFull', { max: FAVORITES_MAX })}</p> : (
        <SearchCombobox scope="artist" variant="inline" recent={false} id="st-fav-artist" label={t('studio.editor.searchArtist')}
          placeholder={t('studio.editor.searchArtist')}
          onPick={(pick) => pick?.kind === 'artist' && !ids.includes(pick.id) && onChange([...ids, pick.id])} onSubmit={() => {}} />
      )}
    </section>
  );
}

function FavTracks({ ids, onChange }) {
  const { t } = useI18n();
  const full = ids.length >= FAVORITES_MAX;
  return (
    <section className="st-fav">
      <header className="st-fav__head">
        <h3 className="studio__label">{t('studio.editor.favTracks')}</h3>
        <span className="chip chip--sm mono">{t('studio.editor.favCount', { n: ids.length, max: FAVORITES_MAX })}</span>
      </header>
      {ids.length > 0 && (
        <ol className="top-tracks st-fav__tracks">
          {ids.map((id) => (
            <li key={id} className="st-fav__track">
              <RatedItemLink type="track" id={id} className="top-tracks__item" coverClassName="top-tracks__cover" titleClassName="top-tracks__title" />
              <button type="button" className="icon-btn" onClick={() => onChange(ids.filter((x) => x !== id))} aria-label={t('studio.editor.remove', { name: id })}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {full ? <p className="small muted">{t('studio.editor.favFull', { max: FAVORITES_MAX })}</p> : (
        <SearchCombobox scope="track" variant="inline" recent={false} id="st-fav-track" label={t('studio.editor.searchTrack')}
          placeholder={t('studio.editor.searchTrack')}
          onPick={(pick) => pick?.kind === 'track' && !ids.includes(pick.id) && onChange([...ids, pick.id])} onSubmit={() => {}} />
      )}
    </section>
  );
}

function FavoritesTab({ data, onSaved }) {
  const { t } = useI18n();
  const initial = data.favorites || { artists: [], tracks: [], genres: [] };
  const [artists, setArtists] = useState(initial.artists);
  const [tracks, setTracks] = useState(initial.tracks);
  const [genres, setGenres] = useState(initial.genres);
  const { busy, save } = useSave(onSaved);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const toggleGenre = (g) => setGenres((list) => (list.includes(g) ? list.filter((x) => x !== g) : list.length < FAVORITES_MAX ? [...list, g] : list));
  const changed = !same(artists, initial.artists) || !same(tracks, initial.tracks) || !same(genres, initial.genres);
  return (
    <div className="st-editor__tab">
      <FavArtists ids={artists} onChange={setArtists} />
      <FavTracks ids={tracks} onChange={setTracks} />
      <section className="st-fav">
        <header className="st-fav__head">
          <h3 className="studio__label">{t('studio.editor.favGenres')}</h3>
          <span className="chip chip--sm mono">{t('studio.editor.favCount', { n: genres.length, max: FAVORITES_MAX })}</span>
        </header>
        <div className="chips" role="group" aria-label={t('studio.editor.favGenres')}>
          {THEME_GENRES.map((g) => (
            <button key={g} type="button" className={`chip chip--toggle${genres.includes(g) ? ' is-on' : ''}`} aria-pressed={genres.includes(g)}
              disabled={!genres.includes(g) && genres.length >= FAVORITES_MAX} onClick={() => toggleGenre(g)}>
              {t(`genre.${g}`)}
            </button>
          ))}
        </div>
      </section>
      <SaveBar busy={busy} disabled={!changed} onSave={() => save(async () => {
        if (!same(artists, initial.artists)) await put('/me/favorites/artist', { ids: artists });
        if (!same(tracks, initial.tracks)) await put('/me/favorites/track', { ids: tracks });
        if (!same(genres, initial.genres)) await put('/me/favorites/genre', { ids: genres });
      })} />
    </div>
  );
}

// ----- à la une -------------------------------------------------------------------------------------------

/** Mes albums complétés (vinyles), du plus récent au plus ancien, choisis par pages. */
function VinylPicker({ value, onChange }) {
  const { t } = useI18n();
  const { achievements } = useGame();
  const [shown, setShown] = useState(VINYLS_PAGE);
  const ids = useMemo(() => [...achievements.entries()].filter(([k]) => k.startsWith('album:'))
    .sort((a, b) => b[1] - a[1]).map(([k]) => k.slice(6)), [achievements]);
  const visible = ids.slice(0, shown);
  const albums = useAlbums(visible);
  if (!ids.length) return <p className="small muted">{t('studio.editor.noVinyl')}</p>;
  return (
    <>
      <div className="st-vpicks" role="radiogroup" aria-label={t('studio.editor.featuredVinyl')}>
        <button type="button" role="radio" aria-checked={!value} className={`st-vpick st-vpick--auto${!value ? ' is-on' : ''}`} onClick={() => onChange(null)}>
          <Icon name="disc" size={22} />
          <span className="st-vpick__auto">{t('studio.editor.featuredAuto')}</span>
        </button>
        {visible.map((id, i) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={`st-vpick${value === id ? ' is-on' : ''}`}
            onClick={() => onChange(id)} title={albums[i] ? `${albums[i].title} · ${albums[i].artist}` : id} aria-label={albums[i]?.title || id}>
            {albums[i] ? <CoverArt art={{ ...albums[i].art, seed: albums[i].art?.seed || id }} sizes="88px" /> : <span className="st-vpick__skel" />}
          </button>
        ))}
      </div>
      {ids.length > shown && (
        <div className="pf-more">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShown((n) => n + VINYLS_PAGE)}>
            <Icon name="plus" size={16} /> {t('studio.editor.moreVinyls')}
          </button>
        </div>
      )}
    </>
  );
}

function ListPicker({ value, onChange }) {
  const { t } = useI18n();
  const { data, error, reload } = useApi('/lists?owner=me&limit=50', { keep: false });
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const lists = data.items || [];
  if (!lists.length) {
    return (
      <p className="small muted st-editor__row">
        {t('studio.editor.noLists')} <Link to="/lists/new" className="link-btn">{t('studio.editor.newList')}</Link>
      </p>
    );
  }
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : value.length < FEATURED_LISTS_MAX ? [...value, id] : value);
  return (
    <ul className="st-listpicks">
      {lists.map((l) => {
        const at = value.indexOf(l.id);
        return (
          <li key={l.id}>
            <button type="button" className={`st-listpick${at >= 0 ? ' is-on' : ''}`} aria-pressed={at >= 0} onClick={() => toggle(l.id)}
              disabled={at < 0 && value.length >= FEATURED_LISTS_MAX} data-list-pick={l.id}>
              <span className="st-listpick__n mono" aria-hidden="true">{at >= 0 ? at + 1 : ''}</span>
              <span className="st-listpick__title">{l.title}</span>
              <span className="small muted">{t(`lists.count.${l.itemType === 'track' ? 'tracks' : l.itemType === 'mixed' ? 'items' : 'albums'}`, { n: l.itemCount })}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SpotlightTab({ data, onSaved }) {
  const { t } = useI18n();
  const [vinyl, setVinyl] = useState(data.featuredVinyl || null);
  const [lists, setLists] = useState(data.featuredLists || []);
  const { busy, save } = useSave(onSaved);
  return (
    <div className="st-editor__tab">
      <section className="st-fav">
        <header className="st-fav__head"><h3 className="studio__label">{t('studio.editor.featuredVinyl')}</h3></header>
        <VinylPicker value={vinyl} onChange={setVinyl} />
      </section>
      <section className="st-fav">
        <header className="st-fav__head">
          <h3 className="studio__label">{t('studio.editor.pinnedLists')}</h3>
          <span className="chip chip--sm mono">{t('studio.editor.favCount', { n: lists.length, max: FEATURED_LISTS_MAX })}</span>
        </header>
        <p className="small muted">{t('studio.editor.pinnedHint')}</p>
        <ListPicker value={lists} onChange={setLists} />
      </section>
      <SaveBar busy={busy} onSave={() => save(() => put('/me/studio', { featuredVinyl: vinyl, featuredLists: lists }))} />
    </div>
  );
}

// ----- cosmétiques ----------------------------------------------------------------------------------------

/** Aperçu d'un cosmétique dans son bouton (cadre sur l'avatar, disque coloré, dégradé du thème, titre). */
function CosmeticPreview({ kind, value }) {
  const { t } = useI18n();
  const { user } = useGame();
  if (kind === 'frame') return <Avatar user={user} size={40} frame={value} />;
  if (kind === 'vinyl') return <span className="st-cos__disc"><Disc albumId={null} color={value} /></span>;
  if (kind === 'theme') return <span className={`st-cos__theme${value ? ` st-theme--${value}` : ''}`} aria-hidden="true" />;
  // Titre : l'aperçu est le titre lui-même, sous le pseudo (aucun titre : le pseudo seul).
  return (
    <span className="st-cos__who">
      <span className="st-cos__user">{user?.username}</span>
      {value ? <span className="st-cos__title">{t(`cosmetics.title.${value}`)}</span> : null}
    </span>
  );
}

function CosmeticsTab({ onSaved }) {
  const { t } = useI18n();
  const { applyState } = useGame();
  const { data, error, reload } = useApi('/me/cosmetics', { keep: false });
  const [draft, setDraft] = useState(null);
  const { busy, save } = useSave(() => {
    reload();
    onSaved?.();
  });
  useEffect(() => {
    if (data?.selected) setDraft({ ...data.selected });
  }, [data]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data || !draft) return <Spinner />;
  const unlocked = new Set((data.unlocked || []).map((c) => c.id));
  const optionsOf = (kind) => {
    const levelOnes = LEVEL_COSMETICS.filter((c) => c.kind === kind).map((c) => ({ key: c.key, level: c.level, locked: !unlocked.has(c.id) }));
    const others = [...unlocked].map(parseCosmetic).filter((c) => c && c.kind === kind && !levelOnes.some((o) => o.key === c.key))
      .map((c) => ({ key: c.key, level: null, locked: false }));
    return [...levelOnes, ...others];
  };
  const name = (kind, key) => {
    const label = t(`cosmetics.${kind}.${key}`);
    return label === `cosmetics.${kind}.${key}` ? key : label;
  };
  return (
    <div className="st-editor__tab">
      <p className="small muted">{t('studio.editor.cosmeticsHint')}</p>
      {COSMETIC_KINDS.map((kind) => (
        <section key={kind} className="st-fav" data-cosmetic-kind={kind}>
          <header className="st-fav__head"><h3 className="studio__label">{t(`studio.editor.kinds.${kind}`)}</h3></header>
          <div className="st-cos" role="radiogroup" aria-label={t(`studio.editor.kinds.${kind}`)}>
            <button type="button" role="radio" aria-checked={!draft[kind]} className={`st-cos__opt${!draft[kind] ? ' is-on' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, [kind]: null }))}>
              <CosmeticPreview kind={kind} value={null} />
              <span className="st-cos__name">{t('studio.editor.none')}</span>
            </button>
            {optionsOf(kind).map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={draft[kind] === o.key} disabled={o.locked}
                className={`st-cos__opt${draft[kind] === o.key ? ' is-on' : ''}${o.locked ? ' is-locked' : ''}`}
                onClick={() => setDraft((d) => ({ ...d, [kind]: o.key }))} data-cosmetic={`${kind}:${o.key}`}>
                <CosmeticPreview kind={kind} value={o.key} />
                {kind !== 'title' && <span className="st-cos__name">{name(kind, o.key)}</span>}
                {o.locked && <span className="st-cos__lock small mono"><Icon name="lock" size={12} /> {t('studio.editor.lockedAt', { n: o.level })}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
      <SaveBar busy={busy} onSave={() => save(async () => {
        const res = await put('/me/cosmetics', draft);
        if (res?.state) applyState(res.state);
      })} />
    </div>
  );
}

// ----- fenêtre --------------------------------------------------------------------------------------------

export function StudioEditor({ open, tab: initialTab = 'profile', onClose, onSaved }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(EDITOR_TABS.includes(initialTab) ? initialTab : 'profile');
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    if (open && EDITOR_TABS.includes(initialTab)) setTab(initialTab);
  }, [open, initialTab]);
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setState((s) => ({ data: s.data, error: null }));
    get('/me/profile').then((data) => alive && setState({ data, error: null })).catch((error) => alive && setState({ data: null, error }));
    return () => {
      alive = false;
    };
  }, [open, version]);
  const saved = () => {
    setVersion((v) => v + 1);
    onSaved?.();
  };
  const { data, error } = state;
  return (
    <Modal open={open} onClose={onClose} title={t('studio.editor.title')} className="modal--wide st-editor">
      <div className="chips st-editor__tabs" role="tablist" aria-label={t('studio.editor.title')}>
        {EDITOR_TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`chip chip--toggle${tab === id ? ' is-on' : ''}`}
            onClick={() => setTab(id)} data-editor-tab={id}>
            {t(`studio.editor.tabs.${id}`)}
          </button>
        ))}
      </div>
      {error ? <ErrorBox error={error} onRetry={() => setVersion((v) => v + 1)} /> : !data ? <div className="st-editor__wait"><Spinner /></div> : (
        <div role="tabpanel" key={`${tab}:${version}`}>
          {tab === 'profile' && <ProfileTab data={data} onSaved={saved} />}
          {tab === 'blocks' && <BlocksTab data={data} onSaved={saved} />}
          {tab === 'favorites' && <FavoritesTab data={data} onSaved={saved} />}
          {tab === 'spotlight' && <SpotlightTab data={data} onSaved={saved} />}
          {tab === 'cosmetics' && <CosmeticsTab onSaved={saved} />}
        </div>
      )}
    </Modal>
  );
}

export default StudioEditor;
