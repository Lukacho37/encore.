import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { get } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { Icon, Logo, Spinner } from '../components/ui.jsx';

/** Boîte e-mail de test (développement sans SMTP). */
export default function Mailbox() {
  const { t, date } = useI18n();
  const navigate = useNavigate();
  const [mails, setMails] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const load = () => get('/dev/emails').then(setMails, () => setMails([]));
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  // Les liens de l'e-mail pointent vers l'URL publique du site : on les ouvre dans l'application.
  const follow = (text) => {
    const m = /(\/(?:verify|reset)\?token=[\w-]+)/.exec(text);
    if (m) navigate(m[1]);
  };

  return (
    <div className="mailbox">
      <header className="mailbox__head">
        <Link to="/" aria-label="AlbumMania"><Logo /></Link>
        <div>
          <h1>{t('mailbox.title')}</h1>
          <p className="muted small">{t('mailbox.note')}</p>
        </div>
      </header>
      {!mails ? <Spinner /> : mails.length === 0 ? <p className="muted">{t('mailbox.empty')}</p> : (
        <ul className="mailbox__list">
          {mails.map((m) => (
            <li key={m.id} className={`mail${open === m.id ? ' is-open' : ''}`}>
              <button type="button" className="mail__row" onClick={() => setOpen(open === m.id ? null : m.id)}>
                <Icon name="mail" />
                <span className="mail__subject">{m.subject}</span>
                <span className="muted small">{t('mailbox.to', { to: m.to })} · {date(m.createdAt)}</span>
              </button>
              {open === m.id && (
                <div className="mail__body">
                  <pre>{m.text}</pre>
                  <button type="button" className="btn btn--primary btn--sm" onClick={() => follow(m.text)}>{t('mailbox.open')}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
