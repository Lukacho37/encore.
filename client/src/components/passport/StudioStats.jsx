// Bloc statistiques du Studio (mini passeport) — chantier P2-A (PLAN.md 2.5, 9.2). Props (contrat, ne pas les
// renommer) : { username }. Monté par le Studio (P1-B) dans son bloc « Statistiques », sous les barres de progression
// de la collection : trois repères du passeport (artiste favori, genre n° 1, note moyenne), les trois premiers genres
// en barres, et les liens « Voir le passeport » (et le dernier Rétro pour soi). Mêmes règles que la page : un
// passeport privé, réservé aux amis ou bloqué ne s'affiche pas (le bloc ne montre alors que la collection).
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useGame } from '../../state/GameContext.jsx';
import { useApi, useArtist } from '../../state/catalog.js';
import { Icon } from '../ui.jsx';
import { genreColors, genreName, pct, scoreLabel } from './format.js';
import '../../styles/passport.css';

const enc = encodeURIComponent;

export function StudioStats({ username }) {
  const { t, lang } = useI18n();
  const { user, ratingScale } = useGame();
  const self = !!username && user?.username?.toLowerCase() === String(username).toLowerCase();
  const path = !username ? null : self ? '/passport' : `/users/${enc(username)}/passport`;
  const { data, loading } = useApi(path, { keep: false });
  const artist = useArtist(data?.favorites?.artist?.id || null);
  if (!path) return null;
  if (loading) {
    return (
      <div className="pp-mini" aria-busy="true">
        <div className="pp-mini__figs">{[0, 1, 2].map((i) => <span key={i} className="pp-mini__fig skeleton" />)}</div>
      </div>
    );
  }
  if (!data) return null;
  const genres = (data.distributions?.genres || []).slice(0, 3);
  const colors = genreColors(data);
  const top = genres[0]?.share || 1;
  const href = self ? '/passport' : `/u/${enc(username)}/passport`;
  const retroYear = self ? data.retro?.years?.[0] : null;
  const none = t('passport.studio.none');
  return (
    <div className="pp-mini" data-studio-stats="">
      <dl className="pp-mini__figs">
        <div className="pp-mini__fig">
          <dt>{t('passport.studio.artist')}</dt>
          <dd title={artist?.name || undefined}>{data.favorites?.artist ? (artist?.name || '…') : none}</dd>
        </div>
        <div className="pp-mini__fig">
          <dt>{t('passport.studio.genre')}</dt>
          <dd>
            {genres[0] ? genreName(t, genres[0].id) : none}
            {genres[0] && <small>{pct(lang, genres[0].share)}</small>}
          </dd>
        </div>
        <div className="pp-mini__fig">
          <dt>{t('passport.studio.average')}</dt>
          <dd>
            {data.totals?.average != null ? scoreLabel(t, lang, data.totals.average, ratingScale) : none}
            {data.totals?.ratings > 0 && <small>{t('passport.studio.averageOf', { n: data.totals.ratings })}</small>}
          </dd>
        </div>
      </dl>
      {genres.length > 0 && (
        <ul className="stat-bars" aria-label={t('passport.totals.genres')}>
          {genres.map((g) => (
            <li key={g.id}>
              <span>{genreName(t, g.id)}</span>
              <span className="progress progress--sm" style={{ '--pc': colors.get(g.id) }} aria-hidden="true">
                <span className="progress__fill" style={{ width: `${(g.share / top) * 100}%` }} />
              </span>
              <span className="mono">{pct(lang, g.share)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="pp-mini__foot">
        <Link to={href} className="section__link" data-passport-link="">
          <Icon name="globe" size={16} /> {t('passport.studio.open')}
        </Link>
        {retroYear && (
          <Link to={`/retro/${retroYear}`} className="chip chip--sm chip--gold" data-retro-link="">{t('passport.studio.retro', { year: String(retroYear) })}</Link>
        )}
      </div>
    </div>
  );
}

export default StudioStats;
