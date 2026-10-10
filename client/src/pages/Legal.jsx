// Pages légales /legal/:page (mentions, terms, privacy, rules, cookies) — chantier P0-D (PLAN.md 7.1).
// Ouvertes à tous : un joueur connecté les voit dans la coquille du site ; un visiteur dans un cadre simple (logo,
// langue, connexion) avec le pied de page. Textes : i18n/areas/legal.js ; coordonnées de l'éditeur et de
// l'hébergeur : GET /api/legal/info (variables LEGAL_*).
import { Link, NavLink, useParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useApi } from '../state/catalog.js';
import { Icon, Logo } from '../components/ui.jsx';
import { LangSwitch } from '../components/shell/controls.jsx';
import { Footer } from '../components/shell/Footer.jsx';
import { LEGAL_PAGES, hasReportPage } from '../components/shell/LegalLinks.jsx';
import NotFound from './NotFound.jsx';
import '../styles/shell.css';

// Variables d'environnement de chaque coordonnée (rappelées au propriétaire quand une valeur manque).
const FACTS = [
  ['editor', (i) => i.editor?.name, 'LEGAL_EDITOR_NAME'],
  ['editorAddress', (i) => i.editor?.address, 'LEGAL_EDITOR_ADDRESS'],
  ['editorEmail', (i) => i.editor?.email, 'LEGAL_EDITOR_EMAIL'],
  ['director', (i) => i.publicationDirector, 'LEGAL_PUBLICATION_DIRECTOR'],
  ['host', (i) => i.host?.name, 'LEGAL_HOST_NAME'],
  ['hostAddress', (i) => i.host?.address, 'LEGAL_HOST_ADDRESS'],
  ['hostPhone', (i) => i.host?.phone, 'LEGAL_HOST_PHONE'],
  ['contact', (i) => i.contactEmail, 'LEGAL_CONTACT_EMAIL'],
];

function Facts({ info }) {
  const { t } = useI18n();
  const { isAdmin } = useGame();
  return (
    <dl className="sh-legal__facts">
      {FACTS.map(([key, get, variable]) => {
        const value = info ? get(info) : null;
        const mail = value && /^[^\s@]+@[^\s@]+$/.test(value);
        return [
          <dt key={`${key}-t`}>{t(`legal.pages.mentions.facts.${key}`)}</dt>,
          <dd key={`${key}-d`}>
            {value ? (mail ? <a href={`mailto:${value}`}>{value}</a> : value) : (
              <span className="sh-legal__missing">
                {info ? t('legal.missing') : '…'}
                {info && isAdmin && ` (${t('legal.missingVar', { v: variable })})`}
              </span>
            )}
          </dd>,
        ];
      })}
    </dl>
  );
}

function Table({ head, rows }) {
  return (
    <table className="sh-legal__table">
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>{row.map((cell, i) => (i === 0 ? <th key={cell} scope="row">{cell}</th> : <td key={`${row[0]}-${i}`}>{cell}</td>))}</tr>
        ))}
      </tbody>
    </table>
  );
}

function LegalContent({ page }) {
  const { t, date } = useI18n();
  const info = useApi('/legal/info').data;
  const key = `legal.pages.${page}`;
  const sections = t(`${key}.sections`);
  const updated = info?.termsUpdatedAt ? Date.parse(info.termsUpdatedAt) : NaN;
  return (
    <div className="sh-legal">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('legal.eyebrow')}</p>
          <h1>{t(`${key}.title`)}</h1>
          {page === 'terms' && Number.isFinite(updated) && <p className="sh-legal__updated">{t('legal.updated', { date: date(updated) })}</p>}
        </div>
      </header>
      <nav className="tabs sh-legal__tabs" aria-label={t('shell.legalNav')}>
        {LEGAL_PAGES.map((p) => (
          <NavLink key={p} to={`/legal/${p}`} className="tabs__tab">{t(`legal.pages.${p}.short`)}</NavLink>
        ))}
      </nav>
      <article className="sh-legal__body">
        <p>{t(`${key}.intro`)}</p>
        {page === 'mentions' && <Facts info={info} />}
        {page === 'privacy' && <Table head={t(`${key}.retentionHead`)} rows={t(`${key}.retention`)} />}
        {page === 'cookies' && <Table head={t(`${key}.tableHead`)} rows={t(`${key}.table`)} />}
        {Array.isArray(sections) && sections.map((s) => (
          <section key={s.h}>
            <h2>{s.h}</h2>
            {(s.p || []).map((p) => <p key={p.slice(0, 40)}>{p}</p>)}
            {s.ul && <ul>{s.ul.map((li) => <li key={li.slice(0, 40)}>{li}</li>)}</ul>}
          </section>
        ))}
        {page === 'privacy' && (
          <p>{info?.contactEmail ? t('legal.contactLine', { email: info.contactEmail }) : t('legal.contactNone')}</p>
        )}
        {hasReportPage && page !== 'mentions' && (
          <section>
            <h2>{t('legal.reportCta')}</h2>
            <p>{t('legal.reportLine')}</p>
            <p><Link to="/report"><Icon name="flag" size={14} /> {t('legal.reportCta')}</Link></p>
          </section>
        )}
      </article>
    </div>
  );
}

/** Visiteur sans compte : barre simple (logo, langue, connexion), la page, le pied de page. */
function GuestFrame({ children }) {
  const { t } = useI18n();
  return (
    <div className="sh-guest">
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/login" className="topbar__logo sh-logo" aria-label="AlbumMania"><Logo /></Link>
          <div className="topbar__right">
            <LangSwitch />
            <Link to="/login" className="btn btn--ghost btn--sm sh-guest__login" aria-label={t('shell.login')}>
              <Icon name="user" /> <span className="sh-guest__login-text">{t('shell.login')}</span>
            </Link>
          </div>
        </div>
      </header>
      <main className="page" id="main">{children}</main>
      <Footer />
    </div>
  );
}

export default function Legal() {
  const { page } = useParams();
  const { status } = useGame();
  if (!LEGAL_PAGES.includes(page)) return status === 'guest' ? <GuestFrame><NotFound /></GuestFrame> : <NotFound />;
  const content = <LegalContent page={page} />;
  return status === 'guest' ? <GuestFrame>{content}</GuestFrame> : content;
}
