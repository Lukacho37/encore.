import { useMemo, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { AlbumTile } from './Home.jsx';
import Card from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Icon, Progress } from '../components/ui.jsx';
import { ALBUMS, ARTISTS, ALBUMS_BY_ARTIST, PROMO_TRACKS, GENRES, DECADES, COUNTRIES } from '@shared/catalog.js';
import { RARITIES, RARITY } from '@shared/rules.js';
import { RarityGem } from '../components/Card.jsx';
import { RarityGuideButton } from '../components/RarityGuide.jsx';

const TABS = ['albums', 'artists', 'promos', 'genres', 'decades', 'countries'];
const pct = (x) => `${Math.round(x * 100)} %`;

export function ArtistBadge({ artist, size = 44 }) {
  const album = ALBUMS_BY_ARTIST[artist.id]?.[0];
  return (
    <span className="artist-badge" style={{ width: size, height: size }}>
      {album && <CoverArt art={{ ...album.art, seed: album.id }} />}
      <span className="artist-badge__initial" style={{ fontSize: size * 0.42 }}>{artist.name[0]}</span>
    </span>
  );
}

function RarityBar({ byRarity }) {
  const { t } = useI18n();
  return (
    <div className="rarity-bar" aria-label={t('collection.byRarity')}>
      {RARITIES.map((r) => (
        <div key={r} className="rarity-bar__item" style={{ '--rc': RARITY[r].color }}>
          <span className="rarity-bar__label"><RarityGem rarity={r} size={11} /> {t(`rarity.${r}`)}</span>
          <Progress value={byRarity[r].owned} max={byRarity[r].total} color={RARITY[r].color} size="sm" />
          <span className="mono small">{byRarity[r].owned}/{byRarity[r].total}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressRows({ rows }) {
  return (
    <ul className="rows">
      {rows.map((r) => (
        <li key={r.key} className={`row${r.p.pct === 1 ? ' row--done' : ''}`}>
          <span className="row__label">{r.label}</span>
          <Progress value={r.p.owned} max={r.p.total} color={r.color} />
          <span className="row__nums mono">{r.p.owned}/{r.p.total}</span>
          <span className="row__pct mono">{pct(r.p.pct)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Collection() {
  const { tab = 'albums' } = useParams();
  const { t, country } = useI18n();
  const { stats, owned, achievements } = useGame();
  const openCard = useCardModal();
  const [genre, setGenre] = useState('all');
  const [sort, setSort] = useState('progress');

  const albums = useMemo(() => {
    const list = ALBUMS.filter((a) => genre === 'all' || a.genre === genre);
    const sorters = {
      progress: (a, b) => stats.albums[b.id].pct - stats.albums[a.id].pct || a.title.localeCompare(b.title),
      year: (a, b) => b.year - a.year,
      az: (a, b) => a.title.localeCompare(b.title),
    };
    return [...list].sort(sorters[sort]);
  }, [genre, sort, stats]);

  const artists = useMemo(
    () => [...ARTISTS].sort((a, b) => stats.artists[b.id].pct - stats.artists[a.id].pct || a.name.localeCompare(b.name)),
    [stats],
  );

  return (
    <div className="collection">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('collection.title')}</span>
          <h1>{t('collection.overall', { owned: stats.total.owned, total: stats.total.total })}</h1>
        </div>
        <div className="page-head__progress">
          <Progress value={stats.total.owned} max={stats.total.total} color="var(--paper)" size="lg" />
          <span className="mono">{pct(stats.total.pct)}</span>
        </div>
      </header>

      <RarityBar byRarity={stats.byRarity} />
      <div className="rarity-help"><RarityGuideButton /></div>

      <nav className="tabs" aria-label={t('collection.title')}>
        {TABS.map((id) => (
          <NavLink key={id} to={id === 'albums' ? '/collection' : `/collection/${id}`} end className="tabs__tab">
            {t(`collection.tabs.${id}`)}
          </NavLink>
        ))}
      </nav>

      {tab === 'albums' && (
        <>
          <div className="toolbar">
            <div className="chips" role="group" aria-label={t('bt.genre')}>
              {['all', ...GENRES].map((g) => (
                <button key={g} type="button" className={`chip-btn${genre === g ? ' is-on' : ''}`} aria-pressed={genre === g} onClick={() => setGenre(g)}>
                  {g === 'all' ? t('collection.all') : t(`genre.${g}`)}
                </button>
              ))}
            </div>
            <label className="select">
              <span className="sr-only">{t('collection.sort.label')}</span>
              <select id="collection-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                {['progress', 'year', 'az'].map((s) => <option key={s} value={s}>{t(`collection.sort.${s}`)}</option>)}
              </select>
            </label>
          </div>
          <div className="album-grid">
            {albums.map((a) => <AlbumTile key={a.id} album={a} progress={stats.albums[a.id]} />)}
          </div>
        </>
      )}

      {tab === 'artists' && (
        <ul className="artist-list">
          {artists.map((a) => {
            const p = stats.artists[a.id];
            const mastered = achievements.has(`artist:${a.id}`);
            return (
              <li key={a.id}>
                <Link to={`/artist/${a.id}`} className={`artist-row${mastered ? ' artist-row--master' : ''}`}>
                  <ArtistBadge artist={a} />
                  <span className="artist-row__text">
                    <span className="artist-row__name">{a.name}{mastered && <span className="master-tag"><Icon name="star" size={12} /> {t('collection.mastered')}</span>}</span>
                    <span className="muted small">{t('collection.albums', { n: ALBUMS_BY_ARTIST[a.id]?.length || 0 })} · {t(`genre.${a.genre}`)} · {country(a.country)}</span>
                  </span>
                  <span className="artist-row__progress">
                    <Progress value={p.owned} max={p.total} color={ALBUMS_BY_ARTIST[a.id]?.[0].art.palette[1]} />
                    <span className="mono small">{pct(p.pct)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {tab === 'promos' && (
        <>
          <p className="intro">{t('collection.promoIntro')}</p>
          <div className="card-grid">
            {PROMO_TRACKS.map((tr) => {
              const mine = owned.get(tr.id);
              return (
                <Card key={tr.id} trackId={tr.id} variant={mine?.holo ? 'holo' : 'std'} ghost={!mine}
                  count={mine ? mine.std + mine.holo : 0} onClick={() => openCard(tr.id)} />
              );
            })}
          </div>
        </>
      )}

      {tab === 'genres' && (
        <ProgressRows rows={GENRES.map((g) => ({ key: g, label: t(`genre.${g}`), p: stats.genres[g], color: 'var(--cue)' }))} />
      )}
      {tab === 'decades' && (
        <ProgressRows rows={DECADES.map((d) => ({ key: d, label: t('decade', { d }), p: stats.decades[d], color: 'var(--r-legendary)' }))} />
      )}
      {tab === 'countries' && (
        <ProgressRows rows={COUNTRIES.map((c) => ({ key: c, label: country(c), p: stats.countries[c], color: 'var(--r-rare)' }))} />
      )}
    </div>
  );
}
