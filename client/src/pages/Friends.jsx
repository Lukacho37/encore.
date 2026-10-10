// Page Amis : ajouter un membre, demandes reçues, amis, demandes envoyées.
// P0-E (PLAN.md 2.5) : la recherche de membres passe par la recherche globale limitée aux membres (SearchCombobox,
// pseudo partiel, fautes de frappe tolérées, membres bloqués jamais proposés) au lieu du pseudo exact ; Entrée sans
// suggestion choisie envoie la demande au pseudo tapé, comme avant. Menu ⋯ Signaler / Bloquer (SafetyMenu, P0-F) sur
// chaque ligne.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { get, post, del } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Avatar, ConfirmButton, Icon, Progress, Spinner, useToast } from '../components/ui.jsx';
import { SafetyMenu } from '../components/safety/SafetyMenu.jsx';
import { SearchCombobox } from '../components/search/SearchCombobox.jsx';
import '../styles/profile.css';
import '../styles/search.css';

function FriendRow({ entry, children }) {
  const { t } = useI18n();
  const u = entry.user;
  return (
    <li className="friend">
      <Link to={`/u/${u.username}`} className="friend__who">
        <Avatar user={u} size={44} />
        <span className="friend__text">
          <span className="friend__name">{u.username}</span>
          <span className="small muted friend__meta">
            <span>{t('profile.level', { n: u.level })}</span>
            <span>{t('friends.progress', { n: u.unique, total: u.total })}</span>
          </span>
          <Progress value={u.unique} max={u.total} color="var(--cue)" size="xs" />
        </span>
      </Link>
      <span className="friend__actions">
        {children}
        <SafetyMenu target={{ type: 'user', id: u.id }} user={u} />
      </span>
    </li>
  );
}

/** Membre choisi dans les suggestions : son état vis-à-vis du joueur et l'action qui va avec. */
function PickedMember({ user, busy, onSend, onClose }) {
  const { t } = useI18n();
  let action;
  if (user.relation === 'self') action = <span className="chip chip--quiet">{t('search.friends.self')}</span>;
  else if (user.relation === 'friend') action = <span className="chip chip--cue"><Icon name="check" size={14} /> {t('search.friends.already')}</span>;
  else if (user.relation === 'outgoing') action = <span className="chip">{t('search.friends.pending')}</span>;
  else if (user.relation === 'incoming') action = <span className="small muted">{t('search.friends.incoming')}</span>;
  else {
    action = (
      <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => onSend(user.username)}>
        <Icon name="plus" size={16} /> {t('search.friends.add')}
      </button>
    );
  }
  return (
    <ul className="friend-list gs-friend-pick">
      <li className="friend">
        <Link to={`/u/${encodeURIComponent(user.username)}`} className="friend__who">
          <Avatar user={user} size={44} />
          <span className="friend__text">
            <span className="friend__name">{user.username}</span>
            <span className="small muted friend__meta"><span>{t('profile.level', { n: user.level })}</span></span>
          </span>
        </Link>
        <span className="friend__actions">
          {action}
          <Link to={`/u/${encodeURIComponent(user.username)}`} className="btn btn--ghost btn--sm">{t('search.friends.view')}</Link>
          {user.relation !== 'self' && <SafetyMenu target={{ type: 'user', id: user.id }} user={user} />}
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('search.friends.close')}><Icon name="close" size={16} /></button>
        </span>
      </li>
    </ul>
  );
}

export default function Friends() {
  const { t, error } = useI18n();
  const { refresh } = useGame();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [username, setUsername] = useState('');
  const [picked, setPicked] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  // Les photos de profil « album:<id> » des joueurs cités arrivent avec la réponse (champ catalog, enregistré par api.js).
  const load = useCallback(async () => {
    try {
      setData(await get('/friends'));
      setFailed(false);
    } catch (err) {
      setFailed(true);
      toast(error(err.code), 'error');
    }
  }, [toast, error]);

  useEffect(() => {
    load();
  }, [load]);

  // Un blocage depuis un menu ⋯ (amitié retirée côté serveur) : la liste est relue.
  useEffect(() => {
    const onBlocks = () => load();
    window.addEventListener('albummania:blocks', onBlocks);
    return () => window.removeEventListener('albummania:blocks', onBlocks);
  }, [load]);

  const apply = async (promise) => {
    try {
      setData(await promise);
      refresh();
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  const send = async (raw) => {
    const name = String(raw || '').trim().replace(/^@/, '');
    if (!name) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await post('/friends/request', { username: name });
      setMessage({ tone: 'ok', text: res.status === 'accepted' ? t('friends.autoAccepted', { name: res.username }) : t('friends.sent', { name: res.username }) });
      setUsername('');
      setPicked((p) => (p && p.username.toLowerCase() === String(res.username || name).toLowerCase()
        ? { ...p, relation: res.status === 'accepted' ? 'friend' : 'outgoing' } : p));
      load();
      refresh();
    } catch (err) {
      setMessage({ tone: 'error', text: error(err.code) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="friends">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('nav.friends')}</span>
          <h1>{t('friends.title')}</h1>
        </div>
      </header>

      <section className="panel panel--add">
        <h2 className="panel__title"><Icon name="plus" /> {t('friends.addTitle')}</h2>
        <p className="muted small">{t('search.friends.body')}</p>
        <SearchCombobox variant="inline" scope="user" id="friend-search" value={username} recent={false}
          placeholder={t('search.friends.placeholder')} label={t('search.friends.label')}
          onChange={(v) => {
            setUsername(v);
            setMessage(null);
          }}
          onPick={(_result, user) => {
            setPicked(user || null);
            setUsername('');
            setMessage(null);
          }}
          onSubmit={send}
          submitLabel={(q) => t('search.friends.submit', { q: q.replace(/^@/, '') })} />
        {picked && <PickedMember user={picked} busy={busy} onSend={send} onClose={() => setPicked(null)} />}
        {message && <p className={message.tone === 'ok' ? 'form-ok' : 'form-error'} role="status">{message.text}</p>}
      </section>

      {!data && failed ? (
        <div className="empty pf-empty" role="alert">
          <p>{t('friends.loadError')}</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setFailed(false); load(); }}>{t('friends.retry')}</button>
        </div>
      ) : !data ? <Spinner /> : (
        <>
          {data.incoming.length > 0 && (
            <section className="section">
              <header className="section__head"><h2>{t('friends.incoming')} <span className="count-badge">{data.incoming.length}</span></h2></header>
              <ul className="friend-list">
                {data.incoming.map((e) => (
                  <FriendRow key={e.requestId} entry={e}>
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => apply(post(`/friends/${e.requestId}/accept`))}>{t('friends.accept')}</button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => apply(post(`/friends/${e.requestId}/decline`))}>{t('friends.decline')}</button>
                  </FriendRow>
                ))}
              </ul>
            </section>
          )}

          <section className="section">
            <header className="section__head"><h2>{t('friends.list')} <span className="muted mono">{data.friends.length}</span></h2></header>
            {data.friends.length === 0 ? <p className="empty">{t('friends.empty')}</p> : (
              <ul className="friend-list">
                {data.friends.map((e) => (
                  <FriendRow key={e.requestId} entry={e}>
                    <Link to={`/u/${e.user.username}`} className="btn btn--ghost btn--sm">{t('friends.view')}</Link>
                    <ConfirmButton className="btn btn--ghost btn--sm btn--quiet" confirmLabel={t('friends.removeConfirm', { name: e.user.username })}
                      onConfirm={() => apply(del(`/friends/${e.user.id}`))}>{t('friends.remove')}</ConfirmButton>
                  </FriendRow>
                ))}
              </ul>
            )}
          </section>

          {data.outgoing.length > 0 && (
            <section className="section">
              <header className="section__head"><h2>{t('friends.outgoing')}</h2></header>
              <ul className="friend-list">
                {data.outgoing.map((e) => (
                  <FriendRow key={e.requestId} entry={e}>
                    <span className="chip">{t('profile.pending')}</span>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => apply(post(`/friends/${e.requestId}/decline`))}>{t('friends.cancel')}</button>
                  </FriendRow>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
