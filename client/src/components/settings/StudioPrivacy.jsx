// Paramètres : confidentialité du Studio — chantier P1-B (PLAN.md 2.5 « Settings », 4.2.3, 7.2). Props (contrat, ne pas
// les renommer) : aucune ; montée par la page Paramètres (P0-D). Public (tous les membres connectés) · Amis (les autres
// ne voient que l'en-tête) · Privé (l'en-tête seulement pour tous) ; le choix s'enregistre tout de suite
// (PUT /api/me/profile { visibility }) et c'est le serveur qui l'applique partout (Studio, listes, activité, badges…).
// Valeur actuelle : GET /api/me/profile (réglages seuls, sans le reste du Studio).
import { useEffect, useState } from 'react';
import { get, put } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { Icon, useToast } from '../ui.jsx';
import { ErrorBox } from '../feedback.jsx';
import { VisibilityChoice } from '../studio/VisibilityChoice.jsx';
import '../../styles/studio.css';

export function StudioPrivacy() {
  const { t, error } = useI18n();
  const toast = useToast();
  const [state, setState] = useState({ value: null, error: null });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    get('/me/profile')
      .then((data) => alive && setState({ value: data.visibility || 'public', error: null }))
      .catch((err) => alive && setState({ value: null, error: err }));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const choose = async (visibility) => {
    if (busy || visibility === state.value) return;
    const before = state.value;
    setState((s) => ({ ...s, value: visibility }));
    setBusy(true);
    try {
      await put('/me/profile', { visibility });
      toast(t('studio.privacy.saved'), 'success');
    } catch (err) {
      setState((s) => ({ ...s, value: before }));
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel sh-set st-privacy" aria-labelledby="set-studio-privacy" data-studio-privacy={state.value || ''}>
      <header className="sh-set__head">
        <h2 id="set-studio-privacy" className="panel__title"><Icon name="lock" /> {t('studio.privacy.title')}</h2>
        <p>{t('studio.privacy.hint')}</p>
      </header>
      {state.error ? (
        <ErrorBox error={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : state.value ? (
        <VisibilityChoice value={state.value} onChange={choose} name="set-studio-visibility" disabled={busy} />
      ) : (
        <div className="st-choices" aria-busy="true">
          {[0, 1, 2].map((i) => <span key={i} className="st-choice st-choice--skel" />)}
        </div>
      )}
    </section>
  );
}

export default StudioPrivacy;
