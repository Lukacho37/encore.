// Paramètres : « Refaire mon profil musical » — chantier P1-E (PLAN.md 2.5, 9.2). Props (contrat, ne pas les renommer) :
// aucune ; montée par la page Paramètres (P0-D). Un panneau du même style que les autres réglages (.panel.sh-set de
// la page) : les genres et artistes préférés choisis aux premiers pas (GET /api/onboarding → mine), et le bouton qui
// rouvre le parcours (/welcome, prérempli avec ces choix). Un compte qui ne l'a jamais fait est invité à le faire.
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useApi, useArtists } from '../../state/catalog.js';
import { Icon } from '../ui.jsx';
import { genreName } from '../match/parts.jsx';
import '../../styles/discover.css';

export function MusicProfileSettings() {
  const { t } = useI18n();
  const { data } = useApi('/onboarding', { keep: false });
  const mine = data?.mine || { genres: [], artists: [], onboarded: false };
  const artists = useArtists(mine.artists || []);
  const has = mine.genres.length > 0 || mine.artists.length > 0;
  return (
    <section className="panel sh-set" aria-labelledby="set-music" data-settings="music-profile">
      <header className="sh-set__head">
        <h2 id="set-music" className="panel__title"><Icon name="headphones" /> {t('onboarding.settings.title')}</h2>
        <p>{t('onboarding.settings.body')}</p>
      </header>
      {has ? (
        <>
          {mine.genres.length > 0 && (
            <div className="sh-set__row">
              <div className="sh-set__label"><strong>{t('onboarding.settings.genres')}</strong></div>
              <div className="dc-profile-tags">
                {mine.genres.map((g) => <span key={g} className="chip chip--sm">{genreName(t, g)}</span>)}
              </div>
            </div>
          )}
          {mine.artists.length > 0 && (
            <div className="sh-set__row">
              <div className="sh-set__label"><strong>{t('onboarding.settings.artists')}</strong></div>
              <div className="dc-profile-tags">
                {mine.artists.map((id, i) => (
                  <Link key={id} to={`/artist/${encodeURIComponent(id)}`} className="chip chip--sm">{artists[i]?.name || '…'}</Link>
                ))}
              </div>
            </div>
          )}
        </>
      ) : data && <p className="small muted">{t('onboarding.settings.none')}</p>}
      <div>
        <Link to="/welcome" className="btn btn--ghost btn--sm" data-redo-profile="">
          <Icon name="edit" size={15} /> {mine.onboarded || has ? t('onboarding.settings.redo') : t('onboarding.settings.start')}
        </Link>
      </div>
    </section>
  );
}

export default MusicProfileSettings;
