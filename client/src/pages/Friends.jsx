import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { get, post, del } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { Avatar, ConfirmButton, Icon, Progress, Spinner, useToast } from '../components/ui.jsx';

function FriendRow({ entry, children }) {
  const { t } = useI18n();
  const u = entry.user;
  return (
    <li className="friend">
      <Link to={`/u/${u.username}`} className="friend__who">
        <Avatar user={u} size={44} />
        <span className="friend__text">
          <span className="friend__name">{u.username}</span>
          <span className="small muted">{t('profile.level', { n: u.level })} · {t('friends.progress', { n: u.unique, total: u.total })}</span>
          <Progress value={u.unique} max={u.total} color="var(--cue)" size="xs" />
        </span>
      </Link>
      <span className="friend__actions">{children}</span>
    </li>
  );
}

export default function Friends() {
  const { t, error } = useI18n();
  const { refresh } = useGame();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await get('/friends'));
    } catch (err) {
      toast(error(err.code), 'error');
    }
  }, [toast, error]);

  useEffect(() => {
    load();
  }, [load]);

  const apply = async (promise) => {
    try {
      setData(await promise);
      refresh();
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  const send = async (e) => {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await post('/friends/request', { username: name });
      setMessage({ tone: 'ok', text: res.status === 'accepted' ? t('friends.autoAccepted', { name: res.username }) : t('friends.sent', { name: res.username }) });
      setUsername('');
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
        <p className="muted small">{t('friends.addBody')}</p>
        <form className="add-friend" onSubmit={send}>
          <label htmlFor="friend-name" className="sr-only">{t('friends.placeholder')}</label>
          <span className="add-friend__at" aria-hidden="true">@</span>
          <input id="friend-name" className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('friends.placeholder')}
            autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={20} />
          <button type="submit" className="btn btn--primary" disabled={busy || !username.trim()}>{t('friends.send')}</button>
        </form>
        {message && <p className={message.tone === 'ok' ? 'form-ok' : 'form-error'} role="status">{message.text}</p>}
      </section>

      {!data ? <Spinner /> : (
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
