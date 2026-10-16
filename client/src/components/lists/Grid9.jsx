// « Mes 9 albums » : grille, bloc du Studio, carte épinglée, aperçu en direct — chantier P1-C (PLAN.md 2.5, 9.2 ;
// design-system-current §4.6, classes canoniques .nine*). Props (contrat, ne pas les renommer) : Grid9Block { username, editable }.
// Grid9 { slots: [albumId | null] × 9, editable?, showTitles?, onSlot(i), onRemove(i), onSwap(a, b), compact? } :
// - lecture : chaque case mène à la page de l'album ;
// - édition (comme my9games) : une case vide ou pleine ouvre la recherche (onSlot), la croix retire, on glisse une
//   pochette sur une autre pour les échanger (souris : tout de suite ; doigt : appui de 250 ms, puis glisser), et au
//   clavier Alt + flèches (ou les boutons « ← → » qui apparaissent au focus) déplacent la case.
// Les vraies pochettes s'affichent (CoverArt) ; le visuel généré n'est qu'un repli.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import CoverArt from '../CoverArt.jsx';
import { Icon, Logo } from '../ui.jsx';
import UgcText from '../UgcText.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbum, useAlbums, useApi } from '../../state/catalog.js';
import { CoverStack } from './ListCard.jsx';
import { ListIcon } from './icons.jsx';
import '../../styles/lists.css';

// Feuille de partage chargée seulement quand on partage.
const ShareSheet = lazy(() => import('../../share/ShareSheet.jsx'));

export const GRID_SIZE = 9;
const COLS = 3;
const enc = encodeURIComponent;
const HOLD_MS = 250;
const MOVE_PX = 8;

/** Spécification de l'image « Mes 9 albums » (renderImage) : titre, @pseudo, 9 pochettes, titres facultatifs. */
export function nineSpec({ title, username, slots, albums, showTitles, format = 'portrait', theme = 'ink' }) {
  return {
    format,
    theme,
    title,
    subtitle: username ? `@${username}` : '',
    tiles: slots.map((id, i) => {
      if (!id) return null;
      const a = albums?.[i];
      return showTitles && a ? { albumId: id, label: a.title, sub: a.artist } : { albumId: id };
    }),
    footer: 'AlbumMania',
  };
}

/** Une case de la grille. */
function Slot({ index, albumId, editable, showTitles, compact, drag, onSlot, onRemove, onMove, onPointerDown }) {
  const { t } = useI18n();
  const album = useAlbum(albumId || null);
  const n = index + 1;
  const caption = showTitles && album && (
    <span className="ls-nine__caption">
      <span className="ls-nine__caption-title">{album.title}</span>
      <span className="ls-nine__caption-artist">{album.artist}</span>
    </span>
  );
  const target = drag && drag.over === index && drag.from !== index;
  const lifted = drag && drag.from === index;

  if (!albumId) {
    if (!editable) return <span className="ls-nine__cell" role="listitem"><span className="nine__slot nine__slot--empty ls-nine__slot--blank" aria-hidden="true" /></span>;
    return (
      <span className="ls-nine__cell" role="listitem">
        <button type="button" className={`nine__slot nine__slot--empty${target ? ' is-target' : ''}`} data-slot={index}
          onClick={() => onSlot?.(index)} aria-label={t('nine.addAt', { n })}>
          <Icon name="plus" size={compact ? 18 : 22} />
          {!compact && <span>{t('nine.add')}</span>}
        </button>
      </span>
    );
  }

  const cover = album
    ? <CoverArt art={{ ...album.art, seed: album.art?.seed || album.id }} title={`${album.title} · ${album.artist}`} sizes="(max-width: 640px) 30vw, 200px" />
    : <span className="ls-nine__loading" />;

  if (!editable) {
    return (
      <span className="ls-nine__cell" role="listitem">
        <Link to={`/album/${enc(albumId)}`} className="nine__slot ls-nine__slot--read" aria-label={album ? `${n}. ${album.title} · ${album.artist}` : String(n)}>
          {!compact && <span className="nine__num">{n}</span>}
          {cover}
        </Link>
        {caption}
      </span>
    );
  }

  const keys = (e) => {
    if (!e.altKey) return;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    onMove?.(index, index + delta);
  };
  return (
    <span className="ls-nine__cell" role="listitem">
      <span className={`nine__slot ls-nine__slot${target ? ' is-target' : ''}${lifted ? ' ls-nine__slot--lifted' : ''}`} data-slot={index}
        onPointerDown={(e) => onPointerDown?.(e, index)}>
        <span className="nine__num">{n}</span>
        {cover}
        <button type="button" className="ls-nine__hit" onClick={() => onSlot?.(index)} onKeyDown={keys}
          aria-label={album ? t('nine.replace', { n, title: album.title }) : t('nine.replace', { n, title: '' })}
          aria-describedby="ls-nine-keys" />
        <button type="button" className="nine__remove" onClick={() => onRemove?.(index)} aria-label={t('nine.remove', { n })}>
          <Icon name="close" size={14} />
        </button>
        <span className="ls-nine__move">
          {index % COLS > 0 && (
            <button type="button" className="ls-nine__arrow" onClick={() => onMove?.(index, index - 1)} aria-label={t('nine.moveLeft', { n })}>
              <ListIcon name="left" size={14} />
            </button>
          )}
          {index % COLS < COLS - 1 && (
            <button type="button" className="ls-nine__arrow" onClick={() => onMove?.(index, index + 1)} aria-label={t('nine.moveRight', { n })}>
              <ListIcon name="right" size={14} />
            </button>
          )}
        </span>
      </span>
      {caption}
    </span>
  );
}

/**
 * Glisser-déposer des cases (souris, stylet, doigt) : renvoie { drag, onPointerDown, gridRef, ghost }. Le doigt doit
 * d'abord rester posé HOLD_MS (sinon la page défile normalement) ; un glisser termine par un échange, jamais par un clic.
 */
function useSwapDrag(slots, onSwap) {
  const [drag, setDrag] = useState(null); // { from, over, x, y }
  const start = useRef(null);
  const suppressClick = useRef(false);
  const gridRef = useRef(null);
  const latest = useRef({ slots, onSwap, drag });
  useEffect(() => {
    latest.current = { slots, onSwap, drag };
  });

  const slotAt = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-slot]');
    return el && gridRef.current?.contains(el) ? Number(el.dataset.slot) : null;
  };

  const end = useCallback((commit) => {
    const s = start.current;
    start.current = null;
    if (s?.timer) clearTimeout(s.timer);
    const d = latest.current.drag;
    if (d) {
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      if (commit && d.over != null && d.over !== d.from) latest.current.onSwap?.(d.from, d.over);
    }
    setDrag(null);
  }, []);

  useEffect(() => {
    const move = (e) => {
      const s = start.current;
      if (!s || e.pointerId !== s.id) return;
      const far = Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_PX;
      if (!latest.current.drag) {
        if (!far) return;
        // Le doigt a bougé avant la fin de l'appui : c'est un défilement, pas un glisser.
        if (s.touch && !s.armed) {
          end(false);
          return;
        }
      }
      setDrag({ from: s.index, over: slotAt(e.clientX, e.clientY), x: e.clientX, y: e.clientY });
    };
    const up = (e) => {
      if (start.current && e.pointerId === start.current.id) end(e.type === 'pointerup');
    };
    // Pendant un glisser au doigt, la page ne défile pas.
    const touchMove = (e) => {
      if (latest.current.drag) e.preventDefault();
    };
    const click = (e) => {
      if (suppressClick.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('click', click, true);
    };
  }, [end]);

  const onPointerDown = (e, index) => {
    if (e.button !== 0 || e.target.closest('.nine__remove, .ls-nine__arrow') || !latest.current.slots[index]) return;
    const touch = e.pointerType === 'touch';
    const s = { id: e.pointerId, index, x: e.clientX, y: e.clientY, touch, armed: !touch, timer: null };
    if (touch) {
      s.timer = setTimeout(() => {
        if (start.current !== s) return;
        s.armed = true;
        setDrag({ from: index, over: index, x: s.x, y: s.y });
        navigator.vibrate?.(12);
      }, HOLD_MS);
    }
    start.current = s;
  };

  return { drag, onPointerDown, gridRef };
}

/** Grille 3 × 3 (lecture ou édition). */
export function Grid9({ slots = [], editable = false, showTitles = false, compact = false, onSlot, onRemove, onSwap, className = '' }) {
  const { t } = useI18n();
  const cells = Array.from({ length: GRID_SIZE }, (_, i) => slots[i] || null);
  const { drag, onPointerDown, gridRef } = useSwapDrag(cells, onSwap);
  const ghostAlbum = useAlbum(drag ? cells[drag.from] : null);
  const move = (from, to) => {
    if (to < 0 || to >= GRID_SIZE || from === to) return;
    onSwap?.(from, to);
    // Le focus suit la case déplacée.
    requestAnimationFrame(() => gridRef.current?.querySelector(`[data-slot="${to}"] .ls-nine__hit, [data-slot="${to}"]`)?.focus());
  };
  return (
    <div className={`nine__grid ls-nine${compact ? ' ls-nine--compact' : ''}${showTitles ? ' ls-nine--titles' : ''}${drag ? ' is-dragging' : ''} ${className}`.trim()}
      ref={gridRef} role="list" aria-label={t('nine.gridLabel')}>
      {cells.map((id, i) => (
        <Slot key={i} index={i} albumId={id} editable={editable} showTitles={showTitles} compact={compact} drag={drag}
          onSlot={onSlot} onRemove={onRemove} onMove={move} onPointerDown={editable ? onPointerDown : undefined} />
      ))}
      {editable && <span id="ls-nine-keys" className="sr-only">{t('nine.keysHelp')}</span>}
      {drag && ghostAlbum && drag.x != null && (
        <span className="ls-nine__ghost" style={{ left: `${drag.x}px`, top: `${drag.y}px` }} aria-hidden="true">
          <CoverArt art={{ ...ghostAlbum.art, seed: ghostAlbum.art?.seed || ghostAlbum.id }} sizes="120px" />
        </span>
      )}
    </div>
  );
}

/** Aperçu en direct de l'image (.nine-share) : même mise en page que le PNG, dans le format et le thème choisis. */
export function NinePreview({ title, username, slots, showTitles, format = 'portrait', theme = 'ink' }) {
  const { t } = useI18n();
  const albums = useAlbums(slots.map((id) => id || ''));
  return (
    <div className={`nine-share ls-fmt--${format}${theme === 'ivory' ? ' nine-share--paper' : ''}`} role="img" aria-label={t('nine.previewLabel')}>
      <div className="nine-share__head">
        <span className="nine-share__title">{title}</span>
        {username && <span className="nine-share__who">@{username}</span>}
      </div>
      <div className={`nine-share__grid${showTitles ? ' ls-share-grid--titles' : ''}`}>
        {slots.map((id, i) => {
          const a = id ? albums[i] : null;
          return (
            <span key={i} className={`ls-share-cell${a ? '' : ' ls-share-cell--empty'}`}>
              <span className={a ? 'ls-share-cell__cover' : 'nine-share__empty ls-share-cell__cover'}>
                {a && <CoverArt art={{ ...a.art, seed: a.art?.seed || a.id }} sizes="120px" />}
              </span>
              {showTitles && a && <span className="ls-share-cell__title">{a.title}</span>}
            </span>
          );
        })}
      </div>
      <div className="nine-share__foot"><Logo /></div>
    </div>
  );
}

/** Carte épinglée « Mes 9 albums » (page Listes) : trois pochettes, « 7/9 », vers l'éditeur. */
export function Grid9Card() {
  const { t } = useI18n();
  const { data } = useApi('/me/grid9', { keep: false });
  const slots = data?.slots || [];
  const filled = slots.filter(Boolean);
  return (
    <Link to="/nine" className="list-card ls-card--pinned" data-grid9-card="">
      <CoverStack albumIds={filled} />
      <span className="ls-card__body">
        <span className="eyebrow">{t('nine.pinned')}</span>
        <span className="list-card__title">{data?.title || t('nine.title')}</span>
        <span className="list-card__meta">{data ? (filled.length ? t('nine.filled', { n: filled.length }) : t('nine.startHint')) : t('common.loading')}</span>
      </span>
    </Link>
  );
}

/** Bloc du Studio : la grille d'un joueur, « Modifier » et « Partager » pour lui-même, « Voir » pour les autres. */
export function Grid9Block({ username, editable = false }) {
  const { t } = useI18n();
  const { data, error } = useApi(username ? `/users/${enc(username)}/grid9` : null, { keep: false });
  const [sharing, setSharing] = useState(false);
  const slots = data?.slots || Array(GRID_SIZE).fill(null);
  const albums = useAlbums(slots.map((id) => id || ''));
  const filled = slots.filter(Boolean).length;
  if (error || !username) return null;
  if (data && !editable && (data.restricted || !filled)) return null;
  const title = data?.title || t('nine.title');
  return (
    <section className="ls-grid-block" aria-labelledby="ls-grid-block-title" data-grid9-block="">
      <header className="ls-grid-block__head">
        <h2 id="ls-grid-block-title"><UgcText text={title} /></h2>
        <span className="ls-grid-block__actions">
          {editable ? (
            <>
              <Link to="/nine" className="btn btn--ghost btn--sm"><Icon name="edit" size={15} /> {filled ? t('nine.edit') : t('nine.start')}</Link>
              {filled === GRID_SIZE && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSharing(true)}><Icon name="share" size={15} /> {t('nine.share')}</button>
              )}
            </>
          ) : (
            <Link to={`/u/${enc(username)}/nine`} className="section__link">{t('nine.see')}</Link>
          )}
        </span>
      </header>
      {editable && !filled && data ? (
        <Link to="/nine" className="ls-grid-block__empty">
          <Grid9 slots={slots} compact />
          <span className="ls-grid-block__cta">{t('nine.startHint')}</span>
        </Link>
      ) : (
        <Grid9 slots={slots} compact />
      )}
      {sharing && (
        <Suspense fallback={null}>
          <ShareSheet spec={nineSpec({ title, username, slots, albums, showTitles: false })} title={t('nine.shareTitle')} onClose={() => setSharing(false)} fileName={title} />
        </Suspense>
      )}
    </section>
  );
}

export default Grid9;
