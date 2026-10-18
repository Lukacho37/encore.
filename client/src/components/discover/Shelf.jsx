// Étagère d'albums de Découvrir — chantier P1-E (PLAN.md 2.5, 5.5). Une section : titre (Archivo h2), raison en une ligne
// (avec les avatars des amis quand il y en a), rangée de vignettes d'album qui défile à l'horizontale (AlbumTile, vraies
// pochettes), flèches de défilement sur ordinateur et, au bout, « Voir plus » qui lit la page suivante par curseur.
// Props :
//   id          identifiant de la section (data-section, ancre) ;
//   title       titre (nœud React : un titre peut contenir un lien vers l'album ou l'artiste de la section) ;
//   reason      phrase « pourquoi » ; users : avatars montrés devant la raison (UserSummary) ;
//   albumIds    premiers albums ; progress { albumId: { owned, total } } ;
//   morePath    adresse de la suite (« /discover/cult ») et moreCursor, le curseur de la deuxième page ;
//   captionOf   (albumId) → courte légende sous une vignette (albums similaires : « Du même artiste ») ;
//   headingLevel 2 (défaut) ou 3.
import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbums } from '../../state/catalog.js';
import { AlbumTile, AlbumTileSkeleton } from '../AlbumTile.jsx';
import { Avatar, Icon, Spinner } from '../ui.jsx';
import '../../styles/discover.css';

const SIZES = '(max-width: 700px) 42vw, 196px';

export function Shelf({ id, title, reason, users = [], albumIds = [], progress = {}, morePath, moreCursor = null, captionOf, headingLevel = 2 }) {
  const { t, error: errorText } = useI18n();
  const [extra, setExtra] = useState({ ids: [], progress: {}, cursor: moreCursor, busy: false, error: null });
  const trackRef = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  // Nouvelle réponse (page rechargée) : la suite repart du nouveau curseur.
  const key = albumIds.join('|');
  useEffect(() => {
    setExtra({ ids: [], progress: {}, cursor: moreCursor, busy: false, error: null });
  }, [key, moreCursor]);

  const ids = [...albumIds, ...extra.ids.filter((x) => !albumIds.includes(x))];
  const albums = useAlbums(ids);
  const prog = { ...progress, ...extra.progress };

  const updateEdges = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    updateEdges();
  }, [ids.length, updateEdges]);

  const scrollBy = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.85), behavior: reduce ? 'auto' : 'smooth' });
  };

  const more = async () => {
    if (!morePath || !extra.cursor || extra.busy) return;
    setExtra((s) => ({ ...s, busy: true, error: null }));
    try {
      const res = await get(`${morePath}?cursor=${encodeURIComponent(extra.cursor)}`);
      setExtra((s) => ({
        ids: [...s.ids, ...(res.items || []).map((x) => x.id)],
        progress: { ...s.progress, ...(res.progress || {}) },
        cursor: res.nextCursor || null,
        busy: false,
        error: null,
      }));
    } catch (err) {
      setExtra((s) => ({ ...s, busy: false, error: err }));
    }
  };

  const H = headingLevel === 3 ? 'h3' : 'h2';
  const titleId = `dc-shelf-${id}`;
  return (
    <section className="dc-shelf" data-section={id} aria-labelledby={titleId}>
      <header className="dc-shelf__head">
        <div className="dc-shelf__titles">
          <H className="dc-shelf__title" id={titleId}>{title}</H>
          {reason && (
            <p className="dc-shelf__reason">
              {users.length > 0 && (
                <span className="dc-avatars" aria-hidden="true">
                  {users.slice(0, 3).map((u) => <Avatar key={u.id} user={u} size={24} />)}
                </span>
              )}
              <span>{reason}</span>
            </p>
          )}
        </div>
        {ids.length > 3 && (
          <div className="dc-shelf__nav">
            <button type="button" className="icon-btn dc-shelf__prev" onClick={() => scrollBy(-1)} disabled={edges.start} aria-label={t('discover.scrollPrev')}>
              <Icon name="chevron" size={18} />
            </button>
            <button type="button" className="icon-btn dc-shelf__next" onClick={() => scrollBy(1)} disabled={edges.end} aria-label={t('discover.scrollNext')}>
              <Icon name="chevron" size={18} />
            </button>
          </div>
        )}
      </header>
      <div className="dc-shelf__track" ref={trackRef} onScroll={updateEdges}>
        {ids.map((albumId, i) => {
          const album = albums[i];
          if (!album) return <AlbumTileSkeleton key={albumId} />;
          const p = prog[albumId];
          const caption = captionOf?.(albumId);
          const tile = <AlbumTile album={album} progress={p} discover={!p?.owned} compact sizes={SIZES} />;
          return caption ? (
            <div key={albumId} className="dc-shelf__item">
              {tile}
              <span className="dc-similar__reason">{caption}</span>
            </div>
          ) : <div key={albumId} className="dc-shelf__item">{tile}</div>;
        })}
        {morePath && extra.cursor && (
          <button type="button" className="dc-shelf__more" onClick={more} disabled={extra.busy} data-more={id}>
            {extra.busy ? <Spinner /> : <Icon name="plus" size={22} />}
            <span>{extra.error ? errorText(extra.error.code) : t('discover.more')}</span>
          </button>
        )}
      </div>
    </section>
  );
}

export default Shelf;
