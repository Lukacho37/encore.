// « Mes 9 albums » (/nine, et /u/:pseudo/nine en lecture) — chantier P1-C (PLAN.md 2.5, 4.2.4 ; design-system-current §4.6).
// Le parcours de my9games, adapté aux albums et dessiné dans l'identité actuelle :
// 1. un titre modifiable en haut (« Mes 9 albums » par défaut) ;
// 2. une grille 3 × 3 de cases carrées, chacune avec un « + » ; toucher une case ouvre une fenêtre de recherche (champ
//    déjà actif, albums avec pochette, titre, artiste, année : SearchCombobox scope album) ; choisir remplit la case ;
// 3. toucher une case pleine permet de la remplacer ou de la retirer (croix) ; glisser une pochette sur une autre les
//    échange (et Alt + flèches au clavier) ;
// 4. « Afficher les titres » sous les pochettes ; format 4:5 / carré / story et thème Encre / Papier ;
// 5. « Générer l'image » (9/9) → aperçu → Télécharger / Partager (ShareSheet : partage du fichier, appui long, téléchargement).
// Chaque changement est enregistré tout seul (PUT /api/me/grid9, 700 ms après le dernier). L'aperçu en direct
// (.nine-share) suit le format et le thème sur ordinateur et tablette.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { get, put } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useAlbum, useAlbums, useApi } from '../state/catalog.js';
import { storage } from '../storage.js';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import CoverArt from '../components/CoverArt.jsx';
import UgcText from '../components/UgcText.jsx';
import { Avatar, Icon, Modal, Spinner, useToast } from '../components/ui.jsx';
import { SafetyMenu } from '../components/safety/SafetyMenu.jsx';
import { SearchCombobox } from '../components/search/SearchCombobox.jsx';
import { GRID_SIZE, Grid9, NinePreview, nineSpec } from '../components/lists/Grid9.jsx';
import { ListIcon } from '../components/lists/icons.jsx';
import { useStableCallback } from '../components/lists/stable.js';
import { BackLink } from './PostPage.jsx';
import '../styles/lists.css';

const ShareSheet = lazy(() => import('../share/ShareSheet.jsx'));
const SAVE_DELAY = 700;
const TITLE_MAX = 100;
const FORMATS = ['portrait', 'square', 'story'];
const THEMES = ['ink', 'ivory'];
const PREF = 'albummania.nine';
const enc = encodeURIComponent;

/** Préférences de l'éditeur gardées dans ce navigateur (titres affichés, format, thème). */
function readPrefs() {
  const p = storage.get(PREF);
  let v = {};
  try {
    v = typeof p === 'string' ? JSON.parse(p) : p || {};
  } catch {
    v = {};
  }
  return {
    showTitles: !!v.showTitles,
    format: FORMATS.includes(v.format) ? v.format : 'portrait',
    theme: THEMES.includes(v.theme) ? v.theme : 'ink',
  };
}

/** Cases voisines d'une case de la grille 3 × 3 : [direction, case] (gauche, droite, haut, bas). */
function neighbours(index) {
  const out = [];
  if (index % 3 > 0) out.push(['left', index - 1]);
  if (index % 3 < 2) out.push(['right', index + 1]);
  if (index >= 3) out.push(['up', index - 3]);
  if (index < 6) out.push(['down', index + 3]);
  return out;
}

/**
 * Fenêtre de recherche d'un album pour une case (champ actif tout de suite). Case pleine : l'album actuel, « Retirer »
 * et « Déplacer » (échange avec une case voisine : au doigt comme au clavier, sans rien poser sur les pochettes).
 */
function PickerDialog({ index, current, onPick, onRemove, onMove, onClose }) {
  const { t } = useI18n();
  const album = useAlbum(current || null);
  const inputRef = useRef(null);
  const close = useStableCallback(onClose);
  // La fenêtre (Modal) donne le focus à son premier bouton une image après son ouverture : le champ le reprend
  // juste après, pour qu'on puisse taper tout de suite (comme my9games).
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <Modal open onClose={close} title={current ? t('nine.picker.replaceTitle', { n: index + 1 }) : t('nine.picker.title', { n: index + 1 })}
      className="modal--narrow ls-picker-modal">
      <div className="ls-picker" data-nine-picker="">
        <SearchCombobox scope="album" variant="inline" autoFocus inputRef={inputRef} recent={false} label={t('nine.picker.label')}
          placeholder={t('nine.picker.placeholder')} onSubmit={() => {}}
          onPick={(pick) => pick?.kind === 'album' && onPick(String(pick.id))} />
        <p className="small muted ls-picker__hint">{t('nine.picker.hint')}</p>
      </div>
      {current && (
        <div className="ls-picker__current">
          <span className="ls-picker__cover">{album && <CoverArt art={{ ...album.art, seed: album.art?.seed || album.id }} sizes="48px" />}</span>
          <span className="ls-picker__text">
            <span className="ls-picker__title">{album?.title || t('common.loading')}</span>
            <span className="small muted">{album?.artist}</span>
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onRemove}><Icon name="close" size={14} /> {t('nine.picker.remove')}</button>
        </div>
      )}
      {current && (
        <div className="ls-picker__move" role="group" aria-label={t('nine.picker.move')}>
          <span className="label">{t('nine.picker.move')}</span>
          {neighbours(index).map(([dir, to]) => (
            <button key={dir} type="button" className="icon-btn ls-picker__dir" onClick={() => onMove(to)} data-move={dir}
              aria-label={t('nine.picker.swapWith', { n: to + 1 })} title={t('nine.picker.swapWith', { n: to + 1 })}>
              <ListIcon name={dir} size={16} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Pastille d'état de la sauvegarde automatique. */
function SaveStatus({ status, onRetry }) {
  const { t } = useI18n();
  if (status === 'idle') return null;
  if (status === 'error') {
    return (
      <span className="ls-save ls-save--error" role="status">
        {t('nine.save.error')} <button type="button" className="link-btn" onClick={onRetry}>{t('nine.save.retry')}</button>
      </span>
    );
  }
  return (
    <span className={`ls-save${status === 'saved' ? ' ls-save--ok' : ''}`} role="status" data-save-status={status}>
      {status === 'saving' ? <><Spinner /> {t('nine.save.saving')}</> : <><Icon name="check" size={14} /> {t('nine.save.saved')}</>}
    </span>
  );
}

/** Éditeur de ma grille. */
function Editor() {
  const { t, error } = useI18n();
  const toast = useToast();
  const { user } = useGame();
  const [load, setLoad] = useState({ ready: false, error: null });
  const [title, setTitle] = useState('');
  const [slots, setSlots] = useState(() => Array(GRID_SIZE).fill(null));
  const [prefs, setPrefs] = useState(readPrefs);
  const [picker, setPicker] = useState(null); // index de la case
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | pending | saving | saved | error
  const [attempt, setAttempt] = useState(0);
  const dirty = useRef(false);
  const latest = useRef({ title, slots });
  useEffect(() => {
    latest.current = { title, slots };
  });

  useEffect(() => {
    let alive = true;
    get('/me/grid9')
      .then((g) => {
        if (!alive) return;
        setTitle(g.title || t('nine.title'));
        setSlots(Array.from({ length: GRID_SIZE }, (_, i) => g.slots?.[i] || null));
        setLoad({ ready: true, error: null });
      })
      .catch((err) => alive && setLoad({ ready: false, error: err }));
    return () => {
      alive = false;
    };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setStatus('saving');
    const { title: tt, slots: ss } = latest.current;
    try {
      await put('/me/grid9', { title: tt.trim() || null, slots: ss });
      setStatus(dirty.current ? 'pending' : 'saved');
    } catch (err) {
      dirty.current = true;
      setStatus('error');
      if (err.code && err.code !== 'network') toast(error(err.code), 'error');
    }
  }, [error, toast]);

  // Sauvegarde automatique : 700 ms après le dernier changement ; en quittant la page, tout de suite.
  useEffect(() => {
    if (status !== 'pending') return undefined;
    const id = setTimeout(save, SAVE_DELAY);
    return () => clearTimeout(id);
  }, [status, title, slots, save]);
  useEffect(() => () => {
    if (dirty.current) {
      const { title: tt, slots: ss } = latest.current;
      put('/me/grid9', { title: tt.trim() || null, slots: ss }).catch(() => {});
    }
  }, []);

  const touch = () => {
    dirty.current = true;
    setStatus('pending');
  };
  const setPref = (patch) => setPrefs((p) => {
    const next = { ...p, ...patch };
    storage.set(PREF, JSON.stringify(next));
    return next;
  });

  const pick = (albumId) => {
    const i = picker;
    setPicker(null);
    setSlots((prev) => {
      const next = prev.slice();
      const j = next.indexOf(albumId);
      // Déjà dans la grille : il change de case (échange avec ce qu'il y avait), jamais de doublon.
      if (j >= 0 && j !== i) {
        next[j] = next[i];
        toast(t('nine.moved'));
      }
      next[i] = albumId;
      return next;
    });
    touch();
  };
  const removeAt = (i) => {
    setSlots((prev) => prev.map((x, j) => (j === i ? null : x)));
    setPicker(null);
    touch();
  };
  const swap = (a, b) => {
    setSlots((prev) => {
      const next = prev.slice();
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    touch();
  };

  const albums = useAlbums(slots.map((id) => id || ''));
  const filled = slots.filter(Boolean).length;
  const missing = GRID_SIZE - filled;
  const shownTitle = title.trim() || t('nine.title');

  if (load.error) return <div className="page ls-page"><ErrorBox error={load.error} onRetry={() => setAttempt((n) => n + 1)} /></div>;

  const seg = (keys, value, key, prefix, label) => (
    <span className="nine__tool">
      <span className="label">{label}</span>
      <span className="seg" role="group" aria-label={label}>
        {keys.map((k) => (
          <button key={k} type="button" className={`seg__btn seg__btn--wide${value === k ? ' is-on' : ''}`} aria-pressed={value === k} onClick={() => setPref({ [key]: k })}>
            {t(`${prefix}.${k}`)}
          </button>
        ))}
      </span>
    </span>
  );

  return (
    <div className="page ls-page ls-nine-page" data-nine-editor="">
      <header className="page-head ls-nine-head">
        <div className="ls-nine-head__main">
          <span className="eyebrow">{t('nine.eyebrow')}</span>
          <label className="ls-nine-title">
            <span className="sr-only">{t('nine.titleLabel')}</span>
            <input className="ls-nine-title__input" value={title} maxLength={TITLE_MAX} disabled={!load.ready} data-nine-title=""
              size={Math.max(8, [...title].length + 1)}
              onChange={(e) => {
                setTitle(e.target.value);
                touch();
              }}
              onBlur={() => !title.trim() && setTitle(t('nine.title'))} />
            <Icon name="edit" size={18} />
          </label>
          <p className="muted ls-nine-head__lead">{t('nine.lead')}</p>
        </div>
        <div className="ls-nine-head__side">
          <SaveStatus status={status} onRetry={() => { dirty.current = true; save(); }} />
          <Link to="/studio" className="section__link">{t('nine.seeStudio')}</Link>
        </div>
      </header>

      <div className="nine">
        <div className="nine__desk">
          <div className="nine__head">
            <h3>{t('nine.deskTitle')}</h3>
            <span className="label">{t('nine.deskHint', { n: filled })}</span>
          </div>
          {load.ready ? (
            <Grid9 slots={slots} editable showTitles={prefs.showTitles} onSlot={setPicker} onRemove={removeAt} onSwap={swap} />
          ) : (
            <div className="nine__grid">{Array.from({ length: GRID_SIZE }, (_, i) => <span key={i} className="nine__slot ls-nine__loading" />)}</div>
          )}
          <div className="nine__tools">
            <button type="button" className="nine__tool ls-nine-titles" role="switch" aria-checked={prefs.showTitles} onClick={() => setPref({ showTitles: !prefs.showTitles })}>
              <span className={`switch${prefs.showTitles ? ' is-on' : ''}`} aria-hidden="true" />
              <span className="label">{t('nine.showTitles')}</span>
            </button>
            {seg(FORMATS, prefs.format, 'format', 'share.formats', t('share.format'))}
            {seg(THEMES, prefs.theme, 'theme', 'share.themes', t('share.theme'))}
          </div>
          <div className="panel__row ls-nine-go">
            <button type="button" className="btn btn--primary" disabled={missing > 0 || !load.ready} onClick={() => setSharing(true)} data-generate="">
              <ListIcon name="image" size={18} /> {t('nine.generate')}
            </button>
            <span className="muted small">{missing > 0 ? t('nine.missing', { n: missing }) : t('nine.ready')}</span>
          </div>
        </div>
        <div className="ls-nine-preview">
          <NinePreview title={shownTitle} username={user?.username} slots={slots} showTitles={prefs.showTitles} format={prefs.format} theme={prefs.theme} />
        </div>
      </div>

      {picker != null && (
        <PickerDialog index={picker} current={slots[picker]} onPick={pick} onRemove={() => removeAt(picker)} onClose={() => setPicker(null)}
          onMove={(to) => {
            swap(picker, to);
            setPicker(null);
          }} />
      )}
      {sharing && (
        <Suspense fallback={null}>
          <ShareSheet controls={false} title={t('nine.shareTitle')} fileName={shownTitle} onClose={() => setSharing(false)}
            spec={nineSpec({ title: shownTitle, username: user?.username, slots, albums, showTitles: prefs.showTitles, format: prefs.format, theme: prefs.theme })} />
        </Suspense>
      )}
    </div>
  );
}

/** Lecture de la grille d'un joueur (/u/:pseudo/nine). */
function Reader({ username }) {
  const { t } = useI18n();
  const { user: me } = useGame();
  const { data, error, reload } = useApi(`/users/${enc(username)}/grid9`, { keep: false });
  const [showTitles, setShowTitles] = useState(false);
  const [sharing, setSharing] = useState(false);
  const slots = data?.slots || Array(GRID_SIZE).fill(null);
  const albums = useAlbums(slots.map((id) => id || ''));
  const self = !!me && me.username?.toLowerCase() === String(username).toLowerCase();
  const filled = slots.filter(Boolean).length;
  const back = `/u/${enc(username)}`;

  if (error) {
    return (
      <div className="page ls-page">
        <BackLink to="/" label={t('common.back')} />
        {error.status === 404
          ? <EmptyState icon="user" title={t('nine.read.goneTitle')} body={t('nine.read.goneBody')} action={{ label: t('nine.makeYours'), to: '/nine' }} />
          : <ErrorBox error={error} onRetry={reload} />}
      </div>
    );
  }
  const user = data?.user;
  const title = data?.title || t('nine.title');
  return (
    <div className="page ls-page ls-nine-page ls-nine-read" data-nine-read="">
      <BackLink to={back} label={t('nine.read.backStudio', { name: username })} />
      <header className="page-head ls-nine-head">
        <div className="ls-nine-head__main">
          <span className="eyebrow">{t('nine.read.eyebrow')}</span>
          <h1 className="ls-nine-read__title"><UgcText text={title} /></h1>
          {user && (
            <p className="ls-head__by">
              <Link to={back} className="ls-head__user"><Avatar user={user} size={28} /> <span>@{user.username}</span></Link>
            </p>
          )}
        </div>
        <div className="ls-nine-head__side">
          {self ? (
            <>
              <Link to="/nine" className="btn btn--ghost btn--sm"><Icon name="edit" size={15} /> {t('nine.edit')}</Link>
              {filled === GRID_SIZE && (
                <button type="button" className="btn btn--primary btn--sm" onClick={() => setSharing(true)}><ListIcon name="image" size={16} /> {t('nine.generate')}</button>
              )}
            </>
          ) : (
            <>
              <Link to="/nine" className="btn btn--primary btn--sm">{t('nine.makeYours')}</Link>
              {data?.list && <SafetyMenu target={{ type: 'list', id: data.list.id }} user={user} />}
            </>
          )}
        </div>
      </header>
      {!data ? (
        <div className="nine__grid ls-nine-read__grid">{Array.from({ length: GRID_SIZE }, (_, i) => <span key={i} className="nine__slot ls-nine__loading" />)}</div>
      ) : data.restricted ? (
        <EmptyState icon="lock" title={t('nine.read.restrictedTitle')} body={t('nine.read.restrictedBody', { name: username })} />
      ) : !filled ? (
        <EmptyState icon="grid" title={t('nine.read.emptyTitle', { name: username })} body={self ? t('nine.startHint') : null}
          action={{ label: self ? t('nine.start') : t('nine.makeYours'), to: '/nine' }} />
      ) : (
        <div className="ls-nine-read__body">
          <Grid9 slots={slots} showTitles={showTitles} className="ls-nine-read__grid" />
          <button type="button" className="nine__tool ls-nine-titles" role="switch" aria-checked={showTitles} onClick={() => setShowTitles((v) => !v)}>
            <span className={`switch${showTitles ? ' is-on' : ''}`} aria-hidden="true" />
            <span className="label">{t('nine.showTitles')}</span>
          </button>
        </div>
      )}
      {sharing && (
        <Suspense fallback={null}>
          <ShareSheet title={t('nine.shareTitle')} fileName={title} onClose={() => setSharing(false)}
            spec={nineSpec({ title, username, slots, albums, showTitles })} />
        </Suspense>
      )}
    </div>
  );
}

export default function GridEditor() {
  const { username } = useParams();
  return username ? <Reader username={username} /> : <Editor />;
}
