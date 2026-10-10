// Une notification (ligne de la cloche ou de la page /notifications) — chantier P0-F (PLAN.md 4.1.7, design-system-current
// §4.2). Avatar 36 px du premier acteur (ou pastille AlbumMania pour la modération) avec l'icône du type, texte avec les
// noms en gras, heure relative, vignette de l'album ou action (« Accepter »). Les types de P1 (mentions « J'aime »,
// réponses, badges) se rendent avec les textes `notify.kinds.<type>` de leur zone et la table cible → adresse ci-dessous.
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { post } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbum, useTrack } from '../../state/catalog.js';
import { pageExists } from '../../routes.jsx';
import CoverArt from '../CoverArt.jsx';
import { Avatar, Icon, Modal, useToast } from '../ui.jsx';
import '../../styles/safety.css';

const enc = encodeURIComponent;
const MINUTE = 60_000;

/** « il y a 5 min », « hier », « 12 sept. » (Intl, dans la langue du site). */
export function timeAgo(at, lang, now = Date.now()) {
  const diff = Math.max(0, now - at);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  if (diff < MINUTE) return rtf.format(0, 'second');
  if (diff < 60 * MINUTE) return rtf.format(-Math.floor(diff / MINUTE), 'minute');
  if (diff < 24 * 60 * MINUTE) return rtf.format(-Math.floor(diff / (60 * MINUTE)), 'hour');
  if (diff < 7 * 24 * 60 * MINUTE) return rtf.format(-Math.floor(diff / (24 * 60 * MINUTE)), 'day');
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', ...(diff > 300 * 24 * 60 * MINUTE ? { year: 'numeric' } : {}) }).format(new Date(at));
}

/** Page de l'élément noté (album ou morceau), avec l'ancre de la critique quand elle est connue. */
function itemHref(itemType, itemId, reviewId) {
  if (!itemId) return null;
  const anchor = reviewId ? `#review-${reviewId}` : '';
  if (itemType === 'album') return `/album/${enc(itemId)}${anchor}`;
  if (itemType === 'track') return `/track/${enc(itemId)}${anchor}`;
  return null;
}

/** Adresse où mène une notification (null : elle se lit sur place). */
export function notificationHref(n) {
  const { kind, target, data = {} } = n;
  const actor = n.actors?.[0];
  if (kind === 'friend_request') return '/friends';
  if (kind === 'friend_accept') return actor ? `/u/${enc(actor.username)}` : '/friends';
  if (kind === 'terms_updated') return pageExists('Legal') ? '/legal/terms' : null;
  if (kind === 'report_resolved') return null;
  if (!target) return null;
  if (kind === 'moderation_action' || kind === 'appeal_decided') {
    // Une critique masquée reste visible de son auteur, sur la page de l'album ou du morceau.
    if (target.type === 'review' && data.action !== 'delete') return itemHref(data.itemType, data.itemId, target.id);
    return null;
  }
  switch (target.type) {
    case 'review':
      return pageExists('ReviewPage') ? `/review/${enc(target.id)}` : itemHref(data.itemType, data.itemId, target.id);
    case 'post':
      return pageExists('PostPage') ? `/post/${enc(target.id)}` : null;
    case 'list':
      return pageExists('ListPage') ? `/list/${enc(target.id)}` : null;
    case 'user':
      return target.username ? `/u/${enc(target.username)}` : null;
    case 'album':
      return `/album/${enc(target.id)}`;
    case 'track':
      return `/track/${enc(target.id)}`;
    default:
      return null;
  }
}

/** Icône posée sur l'avatar : cœur rose (mentions), bulle turquoise (réponses), or (amis, badges), bouclier (modération). */
function iconOf(kind) {
  if (kind.startsWith('like_')) return { name: 'heart', tone: '' };
  if (kind.startsWith('comment_') || kind.startsWith('reply_')) return { name: 'comment', tone: 'notif__icon--cue' };
  if (kind.startsWith('friend_')) return { name: 'user', tone: 'notif__icon--gold' };
  if (kind.startsWith('badge_')) return { name: 'trophy', tone: 'notif__icon--gold' };
  if (kind === 'terms_updated') return { name: 'flag', tone: 'notif__icon--cue' };
  return { name: 'shield', tone: 'notif__icon--cue' };
}

/**
 * Remplace {clé} dans un texte traduit par des éléments React (noms en gras) : t() reçoit des repères, le texte est
 * ensuite découpé sur ces repères.
 */
function rich(t, key, vars) {
  const marks = {};
  for (const k of Object.keys(vars)) marks[k] = `\u0001${k}\u0001`;
  const text = t(key, { ...marks, n: vars.n });
  return text.split(/\u0001(\w+)\u0001/).map((part, i) => (i % 2 ? <Fragment key={i}>{vars[part]}</Fragment> : part));
}

/** Titre de l'élément d'une décision (« ta critique de Discovery »). */
export function useItemTitle(data) {
  const album = useAlbum(data?.itemType === 'album' ? data.itemId : null);
  const track = useTrack(data?.itemType === 'track' ? data.itemId : null);
  return data?.itemType === 'album' ? album?.title : data?.itemType === 'track' ? track?.title : null;
}

/** Texte de la notification, noms en gras. */
function NotificationText({ n, itemTitle }) {
  const { t, date } = useI18n();
  const actors = n.actors || [];
  const names = actors.map((a) => <b key={a.id}>{a.username}</b>);
  let who;
  if (!names.length) who = <b>{t('notify.someone')}</b>;
  else if (n.actorCount <= 1) who = names[0];
  else if (n.actorCount === 2 && names[1]) who = rich(t, 'notify.actorsTwo', { a: names[0], b: names[1] });
  else who = rich(t, 'notify.actorsMany', { a: names[0], n: n.actorCount - 1 });
  const data = n.data || {};
  const targetType = n.target?.type;
  let item;
  if (targetType === 'review') item = itemTitle ? rich(t, 'notify.item.review', { title: <b>{itemTitle}</b> }) : t('notify.item.reviewNoTitle');
  else if (['post', 'comment', 'list', 'user'].includes(targetType)) item = t(`notify.item.${targetType}`);
  else item = t('notify.item.content');

  const kinds = 'notify.kinds';
  switch (n.kind) {
    case 'moderation_action':
      return rich(t, `${kinds}.moderation_action.${data.action || 'warn'}`, { item: <>{item}</>, date: data.until ? date(data.until) : '' });
    case 'report_resolved':
      return t(`${kinds}.report_resolved.${data.outcome === 'dismissed' ? 'dismissed' : 'actioned'}`);
    case 'appeal_decided':
      return t(`${kinds}.appeal_decided.${data.decision === 'reversed' ? 'reversed' : 'upheld'}`);
    default: {
      // Types de P1 et suivants : « notify.kinds.<type> » avec {actors}, {item}, {title}.
      const template = t(`${kinds}.${n.kind}`);
      if (typeof template !== 'string' || template === `${kinds}.${n.kind}`) return t(`${kinds}.fallback`);
      return rich(t, `${kinds}.${n.kind}`, { actors: <>{who}</>, item: <>{item}</>, title: <b>{itemTitle || ''}</b>, n: n.actorCount });
    }
  }
}

/** Fenêtre « Contester la décision » (POST /api/moderation/:id/appeal). */
export function AppealDialog({ actionId, open, onClose, onDone }) {
  const { t, error } = useI18n();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await post(`/moderation/${actionId}/appeal`, { text: text.trim() });
      toast(t('notify.appealSent'), 'success');
      onDone?.(res.item);
      onClose();
    } catch (ex) {
      setErr(error(ex.code));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('notify.appealTitle')} className="modal--narrow sf-dialog">
      <form className="sf-dialog__form" onSubmit={submit}>
        <p className="sf-dialog__text">{t('notify.appealBody')}</p>
        <div className="field">
          <label className="field__label" htmlFor={`appeal-${actionId}`}>{t('notify.appealLabel')}</label>
          <textarea id={`appeal-${actionId}`} className="input textarea" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="modal__actions sf-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn--primary" disabled={!text.trim() || busy}>{t('notify.appealSend')}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Détail d'une décision de modération (page seulement) : motif, exposé des motifs, contenu concerné, contestation.
 * `decision` : la décision lue dans GET /api/moderation/mine (état de la contestation), ou undefined.
 */
function DecisionDetail({ n, decision, onAppealed }) {
  const { t, date } = useI18n();
  const [appealing, setAppealing] = useState(false);
  const data = n.data || {};
  const appeal = decision?.appeal;
  const appealable = data.appealable !== false && data.action !== 'unsuspend' && !appeal && (decision ? decision.appealable : true);
  return (
    <div className="notif__detail">
      {data.ground && <p className="small">{t('notify.ground', { g: t(`safety.grounds.${data.ground}`) })}</p>}
      {data.statement && (
        <blockquote className="sf-quote">
          <span className="label">{t('notify.statement')}</span>
          <span className="sf-quote__text">{data.statement}</span>
        </blockquote>
      )}
      {data.excerpt && (
        <p className="small muted sf-excerpt">{t('safety.excerptLine', { text: `${data.excerpt}${data.excerpt.length >= 140 ? '…' : ''}` })}</p>
      )}
      {appeal ? (
        <p className="small">
          <span className={`chip chip--sm ${appeal.decision === 'reversed' ? 'chip--ok' : appeal.decision ? 'chip--quiet' : 'chip--cue'}`}>
            {appeal.decision === 'reversed' ? t('notify.appealReversed') : appeal.decision ? t('notify.appealUpheld') : t('notify.appealPending', { d: date(appeal.at) })}
          </span>
        </p>
      ) : appealable && data.actionId ? (
        <button type="button" className="btn btn--ghost btn--xs" onClick={() => setAppealing(true)}>{t('notify.appeal')}</button>
      ) : null}
      {data.actionId && (
        <AppealDialog actionId={data.actionId} open={appealing} onClose={() => setAppealing(false)} onDone={onAppealed} />
      )}
    </div>
  );
}

/**
 * Ligne de notification. `variant` : 'panel' (cloche, une ligne) ou 'page' (détail des décisions, Accepter / Refuser).
 * `onOpen(n)` : clic sur la ligne (marque lu, puis suit le lien) ; `onFriend(n, accept)` : réponse à une demande d'ami.
 */
export function NotificationRow({ n, variant = 'panel', onOpen, onFriend, decision, onAppealed }) {
  const { lang, t } = useI18n();
  const data = n.data || {};
  const itemTitle = useItemTitle(data);
  const href = notificationHref(n);
  const icon = iconOf(n.kind);
  const actor = n.actors?.[0];
  const albumId = data.itemType === 'album' ? data.itemId : null;
  const album = useAlbum(albumId || (n.target?.type === 'album' ? n.target.id : null));
  const track = useTrack(data.itemType === 'track' ? data.itemId : null);
  const art = album?.art || track?.art || null;
  const page = variant === 'page';
  const moderation = ['moderation_action', 'appeal_decided', 'report_resolved'].includes(n.kind);

  const text = (
    <span className="notif__body">
      <span className="notif__text"><NotificationText n={n} itemTitle={itemTitle} /></span>
      {n.kind === 'appeal_decided' && data.note && page && <span className="notif__note small">{t('notify.note', { note: data.note })}</span>}
      <time className="notif__time" dateTime={new Date(n.createdAt).toISOString()}>{timeAgo(n.createdAt, lang)}</time>
    </span>
  );
  const open = (e) => {
    if (onOpen) onOpen(n, e);
  };
  const main = href
    ? <Link to={href} className="notif__link" onClick={open}>{text}</Link>
    : <button type="button" className="notif__link" onClick={open}>{text}</button>;

  let side = null;
  if (n.kind === 'friend_request' && data.pending && onFriend) {
    side = (
      <span className="notif__actions">
        <button type="button" className="btn btn--primary btn--xs" onClick={() => onFriend(n, true)}>{t('notify.accept')}</button>
        {page && <button type="button" className="btn btn--ghost btn--xs" onClick={() => onFriend(n, false)}>{t('notify.decline')}</button>}
      </span>
    );
  } else if (art) {
    side = <span className="notif__thumb" aria-hidden="true"><CoverArt art={{ ...art, seed: art.seed || albumId || data.itemId }} sizes="40px" /></span>;
  }

  return (
    <li className={`notif${n.read ? '' : ' is-unread'}${page ? ' notif--page' : ''}`} data-kind={n.kind}>
      {actor && !moderation
        ? <Avatar user={actor} size={36} className="notif__avatar" />
        : <span className="notif__avatar sf-sysavatar" aria-hidden="true"><span className="logo__mark" /></span>}
      <span className={`notif__icon ${icon.tone}`} aria-hidden="true"><Icon name={icon.name} size={11} /></span>
      <span className="notif__main">
        {main}
        {page && n.kind === 'moderation_action' && <DecisionDetail n={n} decision={decision} onAppealed={onAppealed} />}
      </span>
      {side}
    </li>
  );
}

export default NotificationRow;
