// Découvrir : hub P0 — chantier P0-D (PLAN.md 2.5 ; la version complète, personnalisée, vient en P1 avec P1-E).
// Recherche, albums populaires, chips Par genre et Par décennie (vers la collection filtrée), tuile Blind test (aussi
// dans la rangée de l'accueil) et tuile Collection. Mêmes composants que le reste du site : .page-head, .panel,
// .panel--bt, .chip, vignettes d'album (AlbumTile) en étagère comme sur l'accueil.
import { Link } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { Icon } from '../components/ui.jsx';
import { AlbumTile, AlbumTileSkeleton } from '../components/AlbumTile.jsx';
import { apiPath, useApi, useCatalogInfo } from '../state/catalog.js';
import { SearchBox } from '../components/shell/SearchBox.jsx';
import '../styles/home.css';
import '../styles/shell.css';

const SHELF_SIZES = '(max-width: 700px) 42vw, 196px';
const POPULAR = 18;

/** Nom d'un genre ; un genre absent des dictionnaires garde son identifiant. */
function useGenreLabel() {
  const { t } = useI18n();
  return (id) => {
    const label = t(`genre.${id}`);
    return label === `genre.${id}` ? id : label;
  };
}

function PopularShelf() {
  const { t } = useI18n();
  const { data, error } = useApi(apiPath('/catalog/albums', { sort: 'popular', limit: POPULAR }));
  const items = data?.items || [];
  return (
    <section className="section" aria-labelledby="hub-popular">
      <header className="section__head home-head">
        <h2 id="hub-popular">{t('hub.popular')}</h2>
        <Link to="/collection/albums?sort=popular" className="section__link">{t('hub.seeAll')}</Link>
      </header>
      {error ? (
        <p className="empty">{t('hub.error')}</p>
      ) : !data ? (
        <div className="home-shelf" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => <AlbumTileSkeleton key={i} />)}
        </div>
      ) : items.length ? (
        <div className="home-shelf">
          {items.map((a) => <AlbumTile key={a.id} album={a} discover compact sizes={SHELF_SIZES} />)}
        </div>
      ) : (
        <p className="empty">{t('hub.empty')}</p>
      )}
    </section>
  );
}

export default function Discover() {
  const { t, num } = useI18n();
  const info = useCatalogInfo();
  const genreLabel = useGenreLabel();
  const genres = (info?.genres || []).slice(0, 18);
  const decades = [...(info?.decades || [])].filter((d) => d.albums > 0).reverse();
  return (
    <div className="sh-hub">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('hub.eyebrow')}</p>
          <h1>{t('hub.title')}</h1>
          <p className="muted">
            {info?.totals ? t('hub.intro', { albums: info.totals.albums, tracks: info.totals.tracks }) : t('hub.introShort')}
          </p>
        </div>
      </header>

      <section className="panel sh-hub__search" aria-labelledby="hub-search">
        <h2 className="panel__title" id="hub-search"><Icon name="search" /> {t('hub.searchTitle')}</h2>
        <p>{t('hub.searchBody')}</p>
        <SearchBox />
      </section>

      <PopularShelf />

      {genres.length > 0 && (
        <section className="section" aria-labelledby="hub-genres">
          <header className="section__head"><h2 id="hub-genres">{t('hub.genres')}</h2></header>
          <div className="sh-hub__chips">
            {genres.map((g) => (
              <Link key={g.id} to={`/collection/albums?genre=${encodeURIComponent(g.id)}`} className="chip chip--toggle">
                {genreLabel(g.id)}
                <span className="chip__n">{num(g.albums)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {decades.length > 0 && (
        <section className="section" aria-labelledby="hub-decades">
          <header className="section__head"><h2 id="hub-decades">{t('hub.decades')}</h2></header>
          <div className="sh-hub__chips">
            {decades.map((d) => (
              <Link key={d.decade} to={`/collection/albums?decade=${d.decade}`} className="chip chip--toggle">
                {t('decade', { d: d.decade })}
                <span className="chip__n">{num(d.albums)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section sh-hub__tiles">
        <Link to="/blindtest" className="panel panel--bt">
          <span className="panel--bt__eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          <h2 className="panel__title"><Icon name="headphones" /> {t('nav.blindtest')}</h2>
          <p>{t('hub.blindtest')}</p>
          <span className="btn btn--primary btn--sm">{t('hub.blindtestCta')}</span>
        </Link>
        <Link to="/collection/albums" className="panel">
          <h2 className="panel__title"><Icon name="grid" /> {t('hub.collectionTitle')}</h2>
          <p>{t('hub.collectionBody')}</p>
          <span className="btn btn--ghost btn--sm">{t('hub.collectionCta')}</span>
        </Link>
      </section>
    </div>
  );
}
