// Espace admin, onglet « Catalogue » — chantier P2-C (PLAN.md 4.3, 7.1, 8.3 P2.6). Trois panneaux sous l'import :
//   - Provenance et enrichissement : passe MusicBrainz / Wikidata (état, progression, ce qui a été trouvé, identité
//     envoyée, dernière erreur), « Lancer » / « Reprendre » et « Mettre en pause » (la pause tient après un
//     redémarrage) ; GET /api/admin/enrich, POST /api/admin/enrich/start | pause ;
//   - Albums proches : dernier calcul de album_similar, « Recalculer maintenant » (POST /api/admin/enrich/similar) ;
//   - Se détacher d'un fournisseur : simulation (rien ne change), puis confirmation en tapant son nom
//     (POST /api/admin/providers/:source/detach { dryRun, purgeFacts, confirm }) ; les joueurs gardent tout.
// Props : { onDetached? } (l'onglet relit l'état de l'import après un détachement).
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { get, post } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { ConfirmButton, Icon, Progress, Spinner, useToast } from '../ui.jsx';
import { ErrorBox } from '../feedback.jsx';
import { PROVIDER_NAMES } from '@shared/ids.js';
import '../../styles/enrich.css';

const POLL_MS = 4000;

/** Pastille d'état de la passe (mêmes couleurs que celle de l'import). */
function Phase({ status }) {
  const { t } = useI18n();
  const phase = status.blocked ? 'blocked' : status.running ? 'running' : status.phase || 'idle';
  const tone = { blocked: 'paused', running: 'running', paused: 'paused', done: 'done', error: 'error' }[phase] || 'idle';
  return (
    <span className={`adm-phase adm-phase--${tone}`} role="status">
      {phase === 'running' && <span className="adm-phase__dot" aria-hidden="true" />}
      {t(`enrich.phase.${phase}`)}
    </span>
  );
}

function EnrichStatus({ status, busy, onStart, onPause }) {
  const { t, num, lang } = useI18n();
  const when = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }), [lang]);
  const c = status.counts || {};
  const by = c.countriesBy || {};
  const { done = 0, total = 0 } = status.progress || {};
  const label = t('enrich.progress', { n: num(done), m: num(total), pass: status.pass || 1 });
  return (
    <section className="panel en-panel" aria-labelledby="en-enrich-title">
      <div className="adm-catalog__head">
        <h2 className="panel__title" id="en-enrich-title"><Icon name="globe" /> {t('enrich.title')}</h2>
        <Phase status={status} />
      </div>
      <p className="small muted">{t('enrich.intro')}</p>
      {status.blocked && <p className="small en-note">{t(`enrich.blocked.${status.blocked}`)}</p>}
      <div className="adm-catalog__progress">
        <Progress value={Math.min(done, total)} max={total || 1} size="lg" color="var(--cue)" label={label} />
        <span className="mono small">{label}</span>
      </div>
      <ul className="adm-facts mono small en-facts">
        <li>
          {t('enrich.countries', { n: num(c.artistsWithCountry || 0), m: num(c.artists || 0) })}
          <span className="muted"> · {t('enrich.countriesBy', { mb: num(by.musicbrainz || 0), wd: num(by.wikidata || 0), seed: num(by.seed || 0) })}</span>
        </li>
        <li>{t('enrich.musicbrainz', { artists: num(c.musicbrainz?.artist || 0), albums: num(c.musicbrainz?.album || 0), tracks: num(c.musicbrainz?.track || 0) })}</li>
        <li>{t('enrich.spotify', { artists: num(c.spotify?.artist || 0), albums: num(c.spotify?.album || 0) })}</li>
        <li>{t('enrich.apple', { artists: num(c.apple?.artist || 0), albums: num(c.apple?.album || 0) })}</li>
        <li>{t('enrich.codes', { upc: num(c.upc || 0), isrc: num(c.isrc || 0), wikidata: num(c.wikidata || 0) })}</li>
        <li>{t('enrich.requests', { mb: num(status.requests?.musicbrainz || 0), wd: num(status.requests?.wikidata || 0) })}</li>
        {status.passFinishedAt && <li>{t('enrich.finished', { d: when.format(new Date(status.passFinishedAt)) })}</li>}
        {status.retryAt && <li>{t('enrich.retry', { d: when.format(new Date(status.retryAt)) })}</li>}
      </ul>
      <p className="small muted en-ua">{t('enrich.userAgent', { ua: status.userAgent })}</p>
      {status.lastError && <p className="small muted mono adm-error">{t('enrich.error', { e: status.lastError })}</p>}
      <div className="admin-tools">
        <button type="button" className="btn btn--primary btn--sm" onClick={onStart} disabled={busy || status.running || !!status.blocked}>
          {status.paused || status.phase === 'error' ? t('enrich.resume') : t('enrich.start')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onPause} disabled={busy || !status.running}>
          {t('enrich.pause')}
        </button>
      </div>
      <p className="small muted en-attribution">{t('enrich.attribution')}</p>
    </section>
  );
}

function SimilarPanel({ status, busy, onRun }) {
  const { t, num, date } = useI18n();
  const s = status.similar;
  return (
    <section className="panel en-panel" aria-labelledby="en-similar-title">
      <h2 className="panel__title" id="en-similar-title"><Icon name="disc" /> {t('enrich.similar.title')}</h2>
      <p className="small muted">{t('enrich.similar.body')}</p>
      <p className="mono small">{s ? t('enrich.similar.line', { rows: num(s.rows || 0), n: s.albums || 0, d: date(s.at) }) : t('enrich.similar.none')}</p>
      <div className="admin-tools">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRun} disabled={busy}>{t('enrich.similar.run')}</button>
      </div>
    </section>
  );
}

/** Compte rendu d'un détachement (simulé ou fait) : gardés / archivés, et ce que les joueurs conservent. */
function DetachReport({ report }) {
  const { t, num } = useI18n();
  const p = PROVIDER_NAMES[report.source] || report.source;
  return (
    <div className="en-report">
      <h3 className="eyebrow">{report.dryRun ? t('enrich.detach.reportTitle') : t('enrich.detach.reportDone')}</h3>
      <div className="table-wrap">
        <table className="table en-report__table">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">{p}</span></th>
              <th scope="col" className="num">{t('enrich.detach.kept')}</th>
              <th scope="col" className="num">{t('enrich.detach.withdrawn')}</th>
            </tr>
          </thead>
          <tbody>
            {['albums', 'tracks', 'promos', 'artists'].map((k) => (
              <tr key={k}>
                <th scope="row">{t(`enrich.detach.rows.${k}`)}</th>
                <td className="num mono">{num(report[k]?.kept || 0)}</td>
                <td className="num mono">{num(report[k]?.withdrawn || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="adm-facts small en-facts">
        <li>{report.players?.cards ? t('enrich.detach.players', { n: report.players.withCards, cards: num(report.players.cards) }) : t('enrich.detach.playersNone')}</li>
        <li>{t('enrich.detach.ratingsKept', { n: report.players?.ratings || 0 })}</li>
        <li>{t('enrich.detach.itemsKept', { n: report.players?.listItems || 0 })}</li>
        <li>{t('enrich.detach.covers', { n: report.covers || 0 })}</li>
        {report.purgeFacts && <li>{t('enrich.detach.facts', { n: num(report.facts?.externalIds || 0), p })}</li>}
      </ul>
    </div>
  );
}

function DetachPanel({ source, status, onDone }) {
  const { t, error, lang } = useI18n();
  const toast = useToast();
  const uid = useId().replace(/:/g, '');
  const when = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }), [lang]);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(null); // 'simulate' | 'detach'
  const [purgeFacts, setPurgeFacts] = useState(false);
  const [confirm, setConfirm] = useState('');
  const p = PROVIDER_NAMES[source] || source;
  const detached = status.providers?.[source]?.detached ? status.providers[source] : null;

  const call = async (dryRun) => {
    setBusy(dryRun ? 'simulate' : 'detach');
    try {
      const res = await post(`/admin/providers/${source}/detach`, dryRun ? { dryRun: true, purgeFacts } : { dryRun: false, purgeFacts, confirm });
      setReport(res.report);
      if (!dryRun) {
        toast(t('enrich.detach.done'), 'success');
        setConfirm('');
        onDone?.(res.status);
      }
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel en-panel en-detach" aria-labelledby={`en-detach-${uid}`}>
      <h2 className="panel__title" id={`en-detach-${uid}`}><Icon name="shield" /> {t('enrich.detach.title', { p })}</h2>
      <p className="small muted">{t('enrich.detach.body', { p })}</p>
      {detached ? (
        <>
          <p className="small en-note en-note--done">
            <span className="chip chip--sm chip--gold">{t('enrich.detach.badge')}</span>{' '}
            {t('enrich.detach.detachedOn', { p, d: detached.at ? when.format(new Date(detached.at)) : '—' })}
          </p>
          <p className="small muted">{t('enrich.detach.env')}</p>
        </>
      ) : (
        <>
          <label className="en-check small">
            <input type="checkbox" checked={purgeFacts} onChange={(e) => setPurgeFacts(e.target.checked)} disabled={!!busy || status.demo} />
            <span>{t('enrich.detach.purgeFacts', { p })}</span>
          </label>
          <div className="admin-tools">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => call(true)} disabled={!!busy}>
              {busy === 'simulate' ? t('enrich.detach.simulating') : t('enrich.detach.simulate')}
            </button>
          </div>
        </>
      )}
      {report && <DetachReport report={report} />}
      {!detached && report?.dryRun && !status.demo && (
        <div className="en-confirm">
          <label htmlFor={`en-confirm-${uid}`} className="small">{t('enrich.detach.confirmLabel', { p: source })}</label>
          <div className="en-confirm__row">
            <input id={`en-confirm-${uid}`} className="input en-confirm__input" value={confirm} autoComplete="off" spellCheck="false"
              onChange={(e) => setConfirm(e.target.value)} disabled={!!busy} />
            <ConfirmButton className="btn btn--danger btn--sm" confirmLabel={t('enrich.detach.confirmAsk')}
              onConfirm={() => call(false)} disabled={confirm.trim() !== source || !!busy}>
              {busy === 'detach' ? t('enrich.detach.running') : t('enrich.detach.confirmButton', { p })}
            </ConfirmButton>
          </div>
          {busy === 'detach' && <Spinner />}
        </div>
      )}
    </section>
  );
}

export function EnrichPanel({ onDetached }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [failed, setFailed] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    get('/admin/enrich')
      .then((s) => {
        setStatus(s);
        setFailed(null);
      })
      .catch((err) => setFailed(err));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // Pendant la passe, l'état est relu toutes les 4 s.
  useEffect(() => {
    if (!status?.running) return undefined;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [status?.running, load]);

  const act = async (path, message) => {
    setBusy(true);
    try {
      const s = await post(path);
      setStatus(s);
      if (typeof message === 'function') toast(message(s), 'success');
      else toast(message, 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (failed && !status) return <ErrorBox error={failed} onRetry={load} />;
  if (!status) return <section className="panel en-panel" aria-busy="true"><h2 className="panel__title"><Icon name="globe" /> {t('enrich.title')}</h2><Spinner /></section>;
  return (
    <>
      <EnrichStatus status={status} busy={busy}
        onStart={() => act('/admin/enrich/start', t('enrich.started'))}
        onPause={() => act('/admin/enrich/pause', t('enrich.pauseAsked'))} />
      <SimilarPanel status={status} busy={busy}
        onRun={() => act('/admin/enrich/similar', (s) => t('enrich.similar.done', { n: s.result?.albums || 0 }))} />
      <DetachPanel source="deezer" status={status} onDone={(s) => {
        if (s) setStatus(s);
        onDetached?.();
      }} />
    </>
  );
}

export default EnrichPanel;
