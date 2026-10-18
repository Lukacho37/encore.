// En-tête du Studio — chantier P1-B (PLAN.md 2.5 « Studio », 6.6). Le `.profile-head` actuel, prolongé :
// avatar avec son cadre cosmétique (et « Modifier la photo » pour soi), pseudo en Archivo, titre cosmétique, bio (UgcText),
// barre de niveau, « Membre depuis », « N amis », maîtrises, puis les actions : « Modifier le Studio » pour soi ;
// Ajouter / Ami ✓ / Demande envoyée / Accepter, « Comparer nos goûts » (page Taste Match, dès qu'elle existe), et le
// menu ⋯ Signaler / Bloquer (SafetyMenu) pour un autre ; à droite, le Taste Match (MatchFigure, P1-E) et les chiffres.
// Thème cosmétique (« Turquoise », « Minuit ») : teinte du dégradé de l'en-tête (studio.css, jetons seulement).
// Props : { profile (réponse de GET /api/users/:username, ou le profil construit depuis l'état pour soi), isSelf,
//           onEdit(), onEditPhoto(), onChange() (relire le Studio après une action d'amitié) }.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { del, post } from '../../api.js';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useArtists } from '../../state/catalog.js';
import { pageExists } from '../../routes.jsx';
import { Avatar, ConfirmButton, Icon, Progress, useToast } from '../ui.jsx';
import { UgcText } from '../UgcText.jsx';
import { SafetyMenu } from '../safety/SafetyMenu.jsx';
import { MatchFigure } from '../match/MatchFigure.jsx';
import '../../styles/studio.css';

const MASTERS_SHOWN = 6; // maîtrises affichées avant « +N autres »

/** Ajouter / Demande envoyée (Annuler) / Accepter (Refuser) / Ami ✓ (Retirer). */
function FriendAction({ profile, onChange }) {
  const { t, error } = useI18n();
  const { refresh } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await onChange?.();
      refresh(); // pastille des demandes d'amis en attente
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };
  switch (profile.friendship) {
    case 'none':
      return (
        <button type="button" className="btn btn--primary btn--sm" disabled={busy} data-friend="add"
          onClick={() => run(() => post('/friends/request', { username: profile.username }))}>
          <Icon name="plus" size={16} /> {t('profile.add')}
        </button>
      );
    case 'outgoing':
      return (
        <span className="friend-state">
          <span className="chip">{t('profile.pending')}</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => post(`/friends/${profile.requestId}/decline`))}>
            {t('studio.cancelRequest')}
          </button>
        </span>
      );
    case 'incoming':
      return (
        <span className="friend-state">
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => run(() => post(`/friends/${profile.requestId}/accept`))}>
            {t('profile.accept')}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => run(() => post(`/friends/${profile.requestId}/decline`))}>
            {t('studio.decline')}
          </button>
        </span>
      );
    case 'friends':
      return (
        <span className="friend-state">
          <span className="chip chip--cue" data-friend="friends"><Icon name="check" size={14} /> {t('profile.friends')}</span>
          <ConfirmButton className="btn btn--ghost btn--sm" confirmLabel={t('friends.removeConfirm', { name: profile.username })}
            onConfirm={() => run(() => del(`/friends/${profile.id}`))}>{t('friends.remove')}</ConfirmButton>
        </span>
      );
    default:
      return null;
  }
}

/** Artistes maîtrisés : les premiers, puis « +N autres » pour tout voir. */
function Masters({ ids }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => (open ? ids : ids.slice(0, MASTERS_SHOWN)), [ids, open]);
  const artists = useArtists(shown);
  if (!ids.length) return null;
  return (
    <div className="masters">
      {shown.map((id, i) => (
        <Link key={id} to={`/artist/${encodeURIComponent(id)}`} className="master-tag pf-master">
          <Icon name="star" size={12} /> {artists[i] ? t('artist.master', { name: artists[i].name }) : '…'}
        </Link>
      ))}
      {ids.length > MASTERS_SHOWN && (
        <button type="button" className="link-btn small pf-masters__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t('profile.mastersLess') : t('profile.mastersMore', { n: ids.length - MASTERS_SHOWN })}
        </button>
      )}
    </div>
  );
}

export function StudioHeader({ profile, isSelf, onEdit, onEditPhoto, onChange }) {
  const { t, date, num } = useI18n();
  const { user: me } = useGame();
  const summary = profile.user || {};
  // Pour soi, l'avatar et les cosmétiques suivent l'état du jeu (à jour dès qu'on les change).
  const who = isSelf ? { ...summary, ...me, frame: me?.cosmetics?.frame ?? null, title: me?.cosmetics?.title ?? null } : { ...summary, ...profile, frame: summary.frame };
  const cosmetics = isSelf ? me?.cosmetics || {} : profile.cosmetics || {};
  const theme = cosmetics.theme || null;
  const title = isSelf ? cosmetics.title : summary.title;
  const lvl = profile.level || me?.level;
  const s = profile.stats || {};
  const friendsCount = summary.friendsCount ?? 0;
  const visibility = summary.visibility || 'public';
  const canCompare = !isSelf && pageExists('TasteMatch') && profile.access === 'full';
  const stat = (value, total) => (
    <dd className="mono">{num(value ?? 0)}{total != null && <small>/{num(total)}</small>}</dd>
  );

  return (
    <section className={`profile-head st-head${theme ? ` st-theme--${theme}` : ''}`} data-studio-head="">
      <div className="profile-head__avatar">
        <Avatar user={who} size={120} />
        {isSelf && (
          <button type="button" className="profile-head__edit" onClick={onEditPhoto} aria-label={t('studio.editPhoto')} title={t('studio.editPhoto')}>
            <Icon name="edit" size={16} />
          </button>
        )}
      </div>
      <div className="profile-head__info">
        <div className="st-head__name">
          <h1>
            {profile.username}
            {isSelf && me?.role === 'admin' && <span className="role-tag">{t('profile.admin')}</span>}
          </h1>
          {title && <span className="chip chip--sm chip--gold st-head__title">{t(`cosmetics.title.${title}`)}</span>}
        </div>
        {summary.bio && <div className="st-head__bio"><UgcText text={summary.bio} /></div>}
        {lvl && (
          <div className="level-line">
            <span className="level-chip mono">{t('profile.level', { n: lvl.level })}</span>
            <Progress value={lvl.xp - lvl.floor} max={lvl.next - lvl.floor} color="var(--cue)" size="sm" label={t('profile.level', { n: lvl.level })} />
            <span className="small muted">{t('profile.xpToNext', { n: lvl.next - lvl.xp, l: lvl.level + 1 })}</span>
          </div>
        )}
        <p className="st-head__meta small muted">
          <span>{t('profile.memberSince', { date: date(profile.createdAt ?? summary.createdAt) })}</span>
          {isSelf
            ? <Link to="/friends" className="st-head__friends">{t('studio.friendsCount', { n: friendsCount })}</Link>
            : <span>{t('studio.friendsCount', { n: friendsCount })}</span>}
          {isSelf && visibility !== 'public' && (
            <span className="st-head__vis"><Icon name="lock" size={13} /> {t(`studio.visibility.${visibility}`)}</span>
          )}
        </p>
        <Masters key={profile.username} ids={profile.masteredArtists || []} />
        <div className="st-head__actions">
          {isSelf ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit} data-studio-edit="">
              <Icon name="edit" size={16} /> {t('studio.edit')}
            </button>
          ) : (
            <>
              <FriendAction profile={profile} onChange={onChange} />
              {canCompare && (
                <Link to={`/match/${encodeURIComponent(profile.username)}`} className="btn btn--ghost btn--sm">
                  <Icon name="headphones" size={16} /> {t('studio.compare')}
                </Link>
              )}
              <SafetyMenu target={{ type: 'user', id: profile.id }} user={summary.id ? summary : { id: profile.id, username: profile.username }} />
            </>
          )}
        </div>
      </div>
      <div className="st-head__side">
        {!isSelf && profile.access === 'full' && <div className="st-head__match"><MatchFigure username={profile.username} /></div>}
        <dl className="profile-stats">
          <div><dt>{t('profile.stats.unique')}</dt>{stat(s.unique, s.total)}</div>
          <div><dt>{t('profile.stats.albums')}</dt>{stat(s.albumsCompleted, s.albumsTotal)}</div>
          <div><dt>{t('profile.stats.artists')}</dt>{stat(s.artistsMastered, s.artistsTotal)}</div>
          <div><dt>{t('profile.stats.promos')}</dt>{stat(s.promos, s.promosTotal)}</div>
        </dl>
      </div>
    </section>
  );
}

export default StudioHeader;
