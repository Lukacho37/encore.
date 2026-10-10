// Onglet « Modération » de l'espace admin — chantier P0-F (PLAN.md 4.1.6, 7.1 : DSA art. 16, 17, 20). Cinq vues
// (paramètre ?view=, pour pouvoir y renvoyer par un lien) :
//   Signalements       file des signalements (ouverts : les plus anciens d'abord ; traités ; classés), filtres motif et type,
//                      contexte (copie au moment du signalement, contenu actuel, auteur et ses décisions récentes, auteur
//                      du signalement), décision avec motif et exposé des motifs prérempli (DecisionForm) ;
//   Contestations      décisions contestées par leur auteur : maintenir ou annuler (le contenu masqué revient, la
//                      suspension est levée) ;
//   Critiques récentes l'ancienne liste de l'espace admin, pour agir sans signalement ;
//   Suspensions        comptes suspendus, « Lever la suspension » ;
//   Journal            journal des actions de l'admin (admin_audit).
// Props : { counts, onCounts(counts), onChanged() } — compteurs de la file (pastille de l'onglet, tenue par Admin.jsx).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, get, post } from '../../api.js';
import { useCursorList } from '../../state/paged.js';
import { apiPath, useAlbum, useTrack } from '../../state/catalog.js';
import { useI18n } from '../../i18n/index.jsx';
import { pageExists } from '../../routes.jsx';
import UgcText from '../UgcText.jsx';
import { Avatar, ConfirmButton, Icon, Spinner, useToast } from '../ui.jsx';
import { EmptyState, ErrorBox, LoadMore, Skeleton } from '../feedback.jsx';
import { timeAgo, useItemTitle } from '../safety/NotificationRow.jsx';
import { REPORT_REASONS } from '../safety/ReportDialog.jsx';
import { DecisionDialog, DecisionForm, actionsFor } from './DecisionForm.jsx';
import '../../styles/safety.css';

const VIEWS = ['reports', 'appeals', 'reviews', 'suspensions', 'audit'];
const STATUSES = ['open', 'actioned', 'dismissed'];
const TYPES = ['review', 'post', 'comment', 'list', 'user', 'url'];
const enc = encodeURIComponent;

/** Adresse du contenu signalé (page de l'album avec l'ancre de la critique, profil…), ou null. */
function contentHref(snap) {
  if (!snap) return null;
  if (snap.type === 'review' && snap.itemId) return `/${snap.itemType === 'track' ? 'track' : 'album'}/${enc(snap.itemId)}#review-${snap.id}`;
  if (snap.type === 'user' && snap.username) return `/u/${enc(snap.username)}`;
  if (snap.type === 'post' && pageExists('PostPage')) return `/post/${snap.id}`;
  if (snap.type === 'list' && pageExists('ListPage')) return `/list/${snap.id}`;
  return null;
}

/** « ta critique de Discovery », « ton profil »… (objet des textes adressés à l'auteur). */
function itemLabelOf(t, type, title) {
  if (type === 'review') return title ? t('notify.item.review', { title }) : t('notify.item.reviewNoTitle');
  if (['post', 'comment', 'list', 'user'].includes(type)) return t(`notify.item.${type}`);
  return t('notify.item.content');
}

/** Date et heure courtes (« 09/10/2026 14:05 »). */
function useDateTime() {
  const { lang } = useI18n();
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' });
    return (ms) => fmt.format(new Date(ms));
  }, [lang]);
}

// ---------- éléments communs ----------

/** Contenu signalé : copie au moment du signalement, et ce qu'il est devenu (supprimé, masqué, modifié). */
function CaseContent({ targetType, targetId, snapshot, current }) {
  const { t } = useI18n();
  const snap = snapshot || current;
  const title = useItemTitle(snap);
  if (targetType === 'url') {
    const path = String(targetId || '');
    return (
      <div className="sf-case__content">
        <p className="label">{t('admin.mod.urlTarget')}</p>
        <p className="sf-case__url mono small">{path.startsWith('/') ? <Link to={path} className="adm-link">{path}</Link> : path}</p>
        <p className="small muted">{t('admin.mod.urlHint')}</p>
      </div>
    );
  }
  const href = contentHref(snap);
  let state = null;
  if (!current) state = { tone: 'danger', label: t('admin.mod.gone') };
  else if (current.hidden) state = { tone: 'quiet', label: t('admin.mod.hidden') };
  else if (snapshot && (current.text ?? null) !== (snapshot.text ?? null)) state = { tone: 'cue', label: t('admin.mod.edited') };
  return (
    <div className="sf-case__content">
      <p className="sf-case__what">
        {snap?.type === 'user' && snap.username ? (
          href ? <Link to={href} className="adm-link">@{snap.username}</Link> : <span>@{snap.username}</span>
        ) : title ? (
          href ? <Link to={href} className="adm-link">{title}</Link> : <span>{title}</span>
        ) : href ? (
          <Link to={href} className="adm-link">{t('admin.mod.open')}</Link>
        ) : null}
        {snap?.score != null && <span className="mono small">{snap.score}/10</span>}
        {state && <span className={`chip chip--sm chip--${state.tone}`}>{state.label}</span>}
      </p>
      {snap?.title && <p className="sf-case__title">{snap.title}</p>}
      {snap?.text
        ? <div className="sf-case__text"><UgcText text={snap.text} clamp /></div>
        : <p className="small muted">{t('admin.mod.noText')}</p>}
      {state?.tone === 'cue' && current?.text && (
        <>
          <p className="label">{t('admin.mod.currentText')}</p>
          <div className="sf-case__text sf-case__text--current"><UgcText text={current.text} clamp /></div>
        </>
      )}
    </div>
  );
}

/** Auteur du contenu, son niveau et ses décisions des 90 derniers jours (récidive : suspension proposée). */
function AuthorBox({ author, prior }) {
  const { t, date } = useI18n();
  if (!author) return <p className="small muted">{t('admin.mod.noAuthor')}</p>;
  return (
    <div className="sf-person-box">
      <div className="sf-person">
        <Avatar user={author} size={36} />
        <span className="sf-person__main">
          <Link to={`/u/${enc(author.username)}`} className="sf-person__name">{author.username}</Link>
          <span className="small muted">{t('admin.mod.level', { n: author.level ?? 1 })}</span>
        </span>
      </div>
      {prior && (
        prior.count > 0
          ? <p className="small">{t('admin.mod.prior', { n: prior.count })}</p>
          : <p className="small muted">{t('admin.mod.priorNone')}</p>
      )}
      {prior?.items?.length > 0 && (
        <ul className="sf-prior">
          {prior.items.map((p) => (
            <li key={p.id}>
              <span className="chip chip--sm">{t(`admin.mod.done.${p.action}`)}</span>
              <span className="small muted">{date(p.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {prior?.suspendedUntil && <span className="chip chip--sm chip--danger">{t('admin.mod.suspendedUntil', { d: date(prior.suspendedUntil) })}</span>}
      {prior?.suggestSuspend && <p className="sf-banner sf-banner--gold small" role="note"><Icon name="flag" size={14} /><span>{t('admin.mod.repeat')}</span></p>}
    </div>
  );
}

/** Auteur du signalement : un joueur, ou une personne du formulaire public (nom et adresse e-mail). */
function ReporterBox({ reporter, report }) {
  const { t } = useI18n();
  if (report.public) {
    return (
      <div className="sf-person-box">
        <p className="small"><strong>{report.reporterName}</strong></p>
        {report.reporterEmail && <a className="link-btn small" href={`mailto:${report.reporterEmail}`}>{report.reporterEmail}</a>}
        {report.goodFaith && <p className="small muted">{t('admin.mod.goodFaith')}</p>}
      </div>
    );
  }
  if (!reporter?.username) return <p className="small muted">{t('admin.mod.reporterGone')}</p>;
  return (
    <div className="sf-person">
      <Avatar user={reporter} size={28} />
      <Link to={`/u/${enc(reporter.username)}`} className="sf-person__name small">{reporter.username}</Link>
    </div>
  );
}

/** Décision prise (motif, exposé des motifs, contestation). */
function DecisionSummary({ action, hideAppeal = false }) {
  const { t, date } = useI18n();
  if (!action) return null;
  const appeal = action.appeal;
  return (
    <div className="sf-case__decision">
      <p className="sf-case__decided">
        <span className={`chip chip--sm${action.action === 'dismiss' ? ' chip--quiet' : ''}`}>{t(`admin.mod.done.${action.action}`)}</span>
        <span className="small muted">
          {date(action.createdAt)}
          {action.ground && action.ground !== 'rules:none' ? ` · ${t(`safety.grounds.${action.ground}`)}` : ''}
        </span>
      </p>
      {action.statement && (
        <blockquote className="sf-quote">
          <span className="label">{t('notify.statement')}</span>
          <span className="sf-quote__text">{action.statement}</span>
        </blockquote>
      )}
      {!hideAppeal && appeal && (
        <p className="small">
          <span className={`chip chip--sm ${appeal.decision === 'reversed' ? 'chip--ok' : appeal.decision ? 'chip--quiet' : 'chip--cue'}`}>
            {appeal.decision ? t(`admin.mod.appealDone.${appeal.decision}`) : t('admin.mod.appealPending')}
          </span>
        </p>
      )}
    </div>
  );
}

/** Liste paginée : erreur, chargement, vide ou contenu, puis « Voir plus ». */
function ListState({ list, empty, children }) {
  if (list.error && !list.items.length) return <ErrorBox error={list.error} onRetry={list.reload} />;
  if (!list.items.length && list.loading) return <div className="rows"><Skeleton kind="row" count={3} /></div>;
  if (!list.items.length) return empty;
  return (
    <>
      {children}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} error={list.error} onRetry={list.loadMore} />
    </>
  );
}

// ---------- signalements ----------

function ReportCard({ item, onDecided }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { report, snapshot, current, author, reporter, priorActions: prior, action } = item;
  const title = useItemTitle(snapshot || current);
  const decide = async (body) => {
    const res = await post(`/admin/reports/${report.id}/decision`, body);
    toast(t(`admin.mod.decided.${body.action}`), 'success');
    onDecided(item, res);
  };
  return (
    <article className="panel sf-case" id={`report-${report.id}`} data-status={report.status}>
      <header className="sf-case__head">
        <div className="sf-case__tags">
          <span className="chip chip--sm chip--cue">{t(`admin.mod.types.${report.targetType}`)}</span>
          <span className="chip chip--sm">{t(`report.reasons.${report.reason}`)}</span>
          {report.sameTarget > 1 && <span className="chip chip--sm chip--danger">{t('admin.mod.sameTarget', { n: report.sameTarget })}</span>}
          {report.public && <span className="chip chip--sm chip--gold">{t('admin.mod.publicForm')}</span>}
          {report.lowTrust && <span className="chip chip--sm chip--quiet">{t('admin.mod.lowTrust')}</span>}
        </div>
        <span className="sf-case__when small muted"><span className="mono">#{report.id}</span> · {timeAgo(report.createdAt, lang)}</span>
      </header>
      <div className="sf-case__body">
        <CaseContent targetType={report.targetType} targetId={report.targetId} snapshot={snapshot} current={current} />
        <aside className="sf-case__side">
          <div>
            <p className="label">{t('admin.mod.author')}</p>
            <AuthorBox author={author} prior={prior} />
          </div>
          <div>
            <p className="label">{t('admin.mod.reporter')}</p>
            <ReporterBox reporter={reporter} report={report} />
          </div>
        </aside>
      </div>
      {report.details && (
        <blockquote className="sf-quote sf-quote--report">
          <span className="label">{t('admin.mod.details')}</span>
          <span className="sf-quote__text">{report.details}</span>
        </blockquote>
      )}
      {report.status === 'open'
        ? <DecisionForm targetType={report.targetType} reason={report.reason} itemLabel={itemLabelOf(t, report.targetType, title)}
            suggestSuspend={!!prior?.suggestSuspend} onSubmit={decide} />
        : <DecisionSummary action={action} />}
    </article>
  );
}

function ReportsView({ counts, onCounts, onChanged }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('open');
  const [reason, setReason] = useState('');
  const [type, setType] = useState('');
  const path = apiPath('/admin/reports', { status, reason, type });
  const list = useCursorList(path, { limit: 20, idOf: (x) => x.report.id, onPage: (res) => res?.counts && onCounts?.(res.counts) });

  const onDecided = (item) => {
    // La décision clôt tous les signalements ouverts du même contenu.
    for (const x of list.items) {
      if (x.report.targetType === item.report.targetType && String(x.report.targetId) === String(item.report.targetId)) list.remove(x.report.id);
    }
    onChanged?.();
    list.reload();
  };

  return (
    <div className="sf-mod__view">
      <div className="sf-mod__filters">
        <div className="seg" role="group" aria-label={t('admin.mod.status')}>
          {STATUSES.map((s) => (
            <button key={s} type="button" className={`seg__btn seg__btn--wide${status === s ? ' is-on' : ''}`} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {t(`admin.mod.statuses.${s}`)}
              {counts && <span className="sf-seg-n">{counts[s] ?? 0}</span>}
            </button>
          ))}
        </div>
        <span className="select">
          <select aria-label={t('admin.mod.reasonFilter')} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">{t('admin.mod.allReasons')}</option>
            {REPORT_REASONS.map((r) => <option key={r} value={r}>{t(`report.reasons.${r}`)}</option>)}
          </select>
        </span>
        <span className="select">
          <select aria-label={t('admin.mod.typeFilter')} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t('admin.mod.allTypes')}</option>
            {TYPES.map((x) => <option key={x} value={x}>{t(`admin.mod.types.${x}`)}</option>)}
          </select>
        </span>
      </div>
      <ListState list={list} empty={<EmptyState icon="shield" title={t(`admin.mod.empty.${status}`)} body={status === 'open' ? t('admin.mod.emptyOpenBody') : null} />}>
        <div className="sf-cases">
          {list.items.map((item) => <ReportCard key={item.report.id} item={item} onDecided={onDecided} />)}
        </div>
      </ListState>
    </div>
  );
}

// ---------- contestations ----------

function AppealCard({ item, onDone }) {
  const { t, error, lang } = useI18n();
  const toast = useToast();
  const { action, author, snapshot, current } = item;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const decide = async (decision) => {
    setBusy(decision);
    try {
      await post(`/admin/moderation/${action.id}/appeal-decision`, { decision, note: note.trim() || undefined });
      toast(t(`admin.mod.appealDone.${decision}`), 'success');
      onDone(item);
    } catch (ex) {
      toast(error(ex.code), 'error');
      setBusy(null);
    }
  };
  const appeal = action.appeal || {};
  return (
    <article className="panel sf-case" id={`appeal-${action.id}`}>
      <header className="sf-case__head">
        <div className="sf-case__tags">
          <span className="chip chip--sm chip--cue">{t(`admin.mod.types.${action.targetType}`)}</span>
        </div>
        <span className="sf-case__when small muted">{t('admin.mod.appealedAgo', { when: timeAgo(appeal.at || action.createdAt, lang) })}</span>
      </header>
      <div className="sf-case__body">
        <CaseContent targetType={action.targetType} targetId={action.targetId} snapshot={snapshot} current={current} />
        <aside className="sf-case__side">
          <div>
            <p className="label">{t('admin.mod.author')}</p>
            <AuthorBox author={author} />
          </div>
        </aside>
      </div>
      <DecisionSummary action={action} hideAppeal />
      <blockquote className="sf-quote sf-quote--appeal">
        <span className="label">{t('admin.mod.appealText')}</span>
        <span className="sf-quote__text">{appeal.text}</span>
      </blockquote>
      {appeal.decision ? (
        <p className="small">
          <span className={`chip chip--sm ${appeal.decision === 'reversed' ? 'chip--ok' : 'chip--quiet'}`}>{t(`admin.mod.appealDone.${appeal.decision}`)}</span>
        </p>
      ) : (
        <div className="sf-decide">
          <div className="field">
            <label className="field__label" htmlFor={`appeal-note-${action.id}`}>{t('admin.mod.appealNote')}</label>
            <textarea id={`appeal-note-${action.id}`} className="input textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="field__hint">{t('admin.mod.appealNoteHint')}</p>
          </div>
          <div className="sf-decide__foot">
            <button type="button" className="btn btn--ghost btn--sm" disabled={!!busy} onClick={() => decide('upheld')}>{t('admin.mod.uphold')}</button>
            <button type="button" className="btn btn--primary btn--sm" disabled={!!busy} onClick={() => decide('reversed')}>{t('admin.mod.reverse')}</button>
          </div>
        </div>
      )}
    </article>
  );
}

function AppealsView({ counts, onCounts, onChanged }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('pending');
  const list = useCursorList(`/admin/appeals?status=${status}`, { limit: 20, idOf: (x) => x.action.id, onPage: (res) => res?.counts && onCounts?.(res.counts) });
  return (
    <div className="sf-mod__view">
      <div className="sf-mod__filters">
        <div className="seg" role="group" aria-label={t('admin.mod.status')}>
          {['pending', 'decided'].map((s) => (
            <button key={s} type="button" className={`seg__btn seg__btn--wide${status === s ? ' is-on' : ''}`} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {t(`admin.mod.appealStatuses.${s}`)}
              {s === 'pending' && counts && <span className="sf-seg-n">{counts.appeals ?? 0}</span>}
            </button>
          ))}
        </div>
      </div>
      <ListState list={list} empty={<EmptyState icon="shield" title={t(`admin.mod.emptyAppeals.${status}`)} />}>
        <div className="sf-cases">
          {list.items.map((item) => (
            <AppealCard key={item.action.id} item={item} onDone={(x) => {
              list.remove(x.action.id);
              onChanged?.();
            }} />
          ))}
        </div>
      </ListState>
    </div>
  );
}

// ---------- critiques récentes (sans signalement) ----------

/**
 * Critiques à modérer. Les anciennes réponses (démo) étaient une liste nue ; les nouvelles sont { items, catalog } :
 * un album ou un morceau absent du catalogue de la réponse a été retiré du catalogue du serveur.
 */
function reviewList(res) {
  if (Array.isArray(res)) return { items: res, known: null };
  const refs = res?.catalog;
  const known = refs ? new Set([...(refs.albums || []), ...(refs.tracks || [])].map((x) => x.id)) : null;
  return { items: res?.items || [], known };
}

/** Une critique récente : auteur, élément noté, note, texte ; décider (motif, exposé) ou supprimer d'un geste. */
function ReviewRow({ review, missing, onChanged, onList }) {
  const { t, date, error } = useI18n();
  const toast = useToast();
  const [deciding, setDeciding] = useState(false);
  const isAlbum = review.type === 'album';
  const album = useAlbum(isAlbum && !missing ? review.id : null);
  const track = useTrack(isAlbum || missing ? null : review.id);
  const item = isAlbum ? album : track;
  let title = missing ? t('admin.reviewMissing') : item ? item.title : '…';
  if (item && !isAlbum && item.artist) title = `${item.title} · ${item.artist}`;
  const href = missing ? null : isAlbum ? `/album/${enc(review.id)}` : `/track/${enc(review.id)}`;
  const anchor = review.ratingId ? `#review-${review.ratingId}` : '';

  const quickDelete = async () => {
    try {
      onList(reviewList(await api('DELETE', `/admin/reviews/${review.user.id}/${review.type}/${enc(review.id)}`)));
      toast(t('admin.mod.decided.delete'), 'success');
    } catch (ex) {
      toast(error(ex.code), 'error');
    }
  };

  return (
    <li className="mod-item sf-review">
      <div className="mod-item__head">
        <Link to={`/u/${enc(review.user.username)}`} className="table__user"><Avatar user={review.user} size={24} /> {review.user.username}</Link>
        <span className="muted small">
          · {href ? <Link to={`${href}${anchor}`} className="adm-link">{title}</Link> : title}
          {' '}· <span className="mono">{review.score}/10</span> · {date(review.updatedAt)}
        </span>
        {review.hidden && <span className="chip chip--sm chip--quiet">{t('admin.mod.hidden')}</span>}
      </div>
      <div className="mod-item__text"><UgcText text={review.review} clamp /></div>
      <div className="sf-review__actions">
        {review.ratingId && (
          <button type="button" className="btn btn--ghost btn--xs" onClick={() => setDeciding(true)}>{t('admin.mod.decide')}</button>
        )}
        <ConfirmButton className="btn btn--ghost btn--xs" confirmLabel={t('admin.deleteConfirm')} onConfirm={quickDelete}>{t('admin.deleteReview')}</ConfirmButton>
      </div>
      {review.ratingId && (
        <DecisionDialog open={deciding} onClose={() => setDeciding(false)} title={t('admin.mod.decideTitle', { name: review.user.username })}
          targetType="review" itemLabel={itemLabelOf(t, 'review', item?.title)} actions={actionsFor('review', { dismiss: false })}
          onSubmit={async (body) => {
            await post('/admin/moderation/act', { targetType: 'review', targetId: review.ratingId, ...body });
            toast(t(`admin.mod.decided.${body.action}`), 'success');
            setDeciding(false);
            onChanged();
          }} />
      )}
    </li>
  );
}

function ReviewsView() {
  const { t } = useI18n();
  const [data, setData] = useState(null); // { items, known } | { error }
  const load = useCallback(() => {
    get('/admin/reviews').then((res) => setData(reviewList(res))).catch((error) => setData({ error }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (data?.error) return <ErrorBox error={data.error} onRetry={load} />;
  if (!data) return <div className="rows"><Skeleton kind="row" count={3} /></div>;
  return (
    <div className="sf-mod__view">
      <p className="small muted">{t('admin.mod.reviewsHint')}</p>
      {!data.items.length ? <EmptyState icon="star" title={t('admin.reviewsEmpty')} /> : (
        <ul className="mod-list">
          {data.items.map((r) => (
            <ReviewRow key={`${r.user.id}-${r.type}-${r.id}`} review={r} missing={!!data.known && !data.known.has(r.id)} onChanged={load} onList={setData} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- suspensions ----------

function SuspensionsView({ onChanged }) {
  const { t, date, error } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    get('/admin/suspensions').then(setData).catch((err) => setData({ error: err }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const lift = async (user) => {
    try {
      await post(`/admin/users/${user.id}/unsuspend`, {});
      toast(t('admin.mod.unsuspended', { name: user.username }), 'success');
      load();
      onChanged?.();
    } catch (ex) {
      toast(error(ex.code), 'error');
    }
  };
  if (data?.error) return <ErrorBox error={data.error} onRetry={load} />;
  if (!data) return <div className="sf-panel-state"><Spinner /></div>;
  return (
    <div className="sf-mod__view">
      <p className="small muted">{t('admin.mod.suspensionsHint')}</p>
      {!data.items?.length ? <EmptyState icon="lock" title={t('admin.mod.noSuspension')} /> : (
        <ul className="sf-rows panel sf-rows--panel">
          {data.items.map(({ user, until, reason }) => (
            <li key={user.id} className="sf-row">
              <Avatar user={user} size={36} />
              <span className="sf-row__main">
                <Link to={`/u/${enc(user.username)}`} className="sf-row__name">{user.username}</Link>
                <span className="small muted">{t('admin.mod.until', { d: date(until) })}</span>
                {reason && <span className="small sf-row__reason">{reason}</span>}
              </span>
              <ConfirmButton className="btn btn--ghost btn--xs" confirmLabel={t('admin.mod.unsuspendConfirm')} onConfirm={() => lift(user)}>
                {t('admin.mod.unsuspend')}
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- journal ----------

/** Détails d'une ligne du journal, en une ligne lisible. */
function payloadText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const text = Object.entries(payload).map(([k, v]) => `${k} : ${v && typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

function AuditView() {
  const { t } = useI18n();
  const when = useDateTime();
  const list = useCursorList('/admin/audit', { limit: 50 });
  return (
    <div className="sf-mod__view">
      <p className="small muted">{t('admin.mod.auditHint')}</p>
      <ListState list={list} empty={<EmptyState icon="list" title={t('admin.mod.auditEmpty')} />}>
        <div className="table-wrap">
          <table className="table sf-audit">
            <thead>
              <tr>
                <th>{t('admin.mod.col.when')}</th>
                <th>{t('admin.mod.col.admin')}</th>
                <th>{t('admin.mod.col.action')}</th>
                <th>{t('admin.mod.col.target')}</th>
                <th>{t('admin.mod.col.details')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => (
                <tr key={r.id}>
                  <td className="small muted sf-audit__when">{when(r.createdAt)}</td>
                  <td className="small">{r.admin?.username || t('admin.mod.system')}</td>
                  <td className="mono small">{r.action}</td>
                  <td className="mono small sf-audit__target">{r.target || '—'}</td>
                  <td className="small muted">{payloadText(r.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ListState>
    </div>
  );
}

// ---------- onglet ----------

export function ModerationTab({ counts, onCounts, onChanged }) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const view = VIEWS.includes(params.get('view')) ? params.get('view') : 'reports';
  const setView = (v) => setParams(v === 'reports' ? {} : { view: v }, { replace: true });
  const badge = { reports: counts?.open, appeals: counts?.appeals };

  return (
    <div className="sf-mod">
      <div className="sf-mod__views" role="group" aria-label={t('admin.mod.views')}>
        {VIEWS.map((v) => (
          <button key={v} type="button" className={`chip chip--toggle${view === v ? ' is-on' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>
            {t(`admin.mod.viewNames.${v}`)}
            {badge[v] > 0 && <span className="chip__n">{badge[v]}</span>}
          </button>
        ))}
      </div>
      {view === 'reports' && <ReportsView counts={counts} onCounts={onCounts} onChanged={onChanged} />}
      {view === 'appeals' && <AppealsView counts={counts} onCounts={onCounts} onChanged={onChanged} />}
      {view === 'reviews' && <ReviewsView />}
      {view === 'suspensions' && <SuspensionsView onChanged={onChanged} />}
      {view === 'audit' && <AuditView />}
    </div>
  );
}

export default ModerationTab;
