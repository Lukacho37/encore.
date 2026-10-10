// Bandeau des nouvelles CGU — chantier P0-D (PLAN.md 7.1) : un compte existant qui n'a pas accepté la version en
// vigueur (state.user.termsOk faux) voit un bandeau non bloquant sous la barre du haut : il peut jouer, mais ses
// écritures publiques (critiques, demandes d'ami…) attendent son acceptation (403 terms_required). « J'accepte »
// envoie la version lue dans GET /api/legal/info à POST /api/legal/accept ; « Plus tard » masque le bandeau jusqu'au
// prochain chargement de la page.
import { useState } from 'react';
import { Link } from 'react-router';
import { post } from '../../api.js';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useApi } from '../../state/catalog.js';
import { Icon, Spinner, useToast } from '../ui.jsx';
import '../../styles/shell.css';

export function TermsBanner() {
  const { user } = useGame();
  const { t, error, date } = useI18n();
  const toast = useToast();
  const pending = user && user.termsOk === false;
  const info = useApi(pending ? '/legal/info' : null).data;
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!pending || hidden) return null;

  const accept = async () => {
    setBusy(true);
    try {
      await post('/legal/accept', { version: info?.termsVersion });
      toast(t('shell.terms.done'), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  const updated = info?.termsUpdatedAt ? Date.parse(info.termsUpdatedAt) : NaN;
  return (
    <div className="sh-banner" role="region" aria-label={t('shell.terms.title')}>
      <div className="sh-banner__inner">
        <span className="sh-banner__icon" aria-hidden="true"><Icon name="flag" size={18} /></span>
        <p className="sh-banner__text">
          <strong>{t('shell.terms.title')}</strong>{' '}
          <span>{Number.isFinite(updated) ? t('shell.terms.bodyDated', { date: date(updated) }) : t('shell.terms.body')}</span>
        </p>
        <div className="sh-banner__actions">
          <Link to="/legal/terms" className="link-btn">{t('shell.terms.read')}</Link>
          <button type="button" className="btn btn--ghost btn--sm" onClick={accept} disabled={busy || !info?.termsVersion}>
            {busy ? <Spinner /> : t('shell.terms.accept')}
          </button>
          <button type="button" className="icon-btn" onClick={() => setHidden(true)} aria-label={t('shell.terms.later')} title={t('shell.terms.later')}>
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default TermsBanner;
