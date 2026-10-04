import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useLocation, useNavigate } from 'react-router';
import { useGame } from './state/GameContext.jsx';
import { useI18n, LANGS } from './i18n/index.jsx';
import { Avatar, Icon, Logo, Royalties, formatDuration, useNow, Spinner } from './components/ui.jsx';
import { sound } from './sound.js';
import Home from './pages/Home.jsx';
import Collection from './pages/Collection.jsx';
import AlbumPage from './pages/AlbumPage.jsx';
import ArtistPage from './pages/ArtistPage.jsx';
import Profile from './pages/Profile.jsx';
import Friends from './pages/Friends.jsx';
import BlindTest from './pages/BlindTest.jsx';
import { Login, Signup, CheckEmail, Verify, Forgot, Reset } from './pages/Auth.jsx';
import Mailbox from './pages/Mailbox.jsx';

const Admin = lazy(() => import('./pages/Admin.jsx'));

function useSound() {
  const [muted, setMuted] = useState(sound.isMuted());
  useEffect(() => sound.subscribe(setMuted), []);
  return [muted, () => sound.setMuted(!muted)];
}

function LangSwitch({ className = '' }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div className={`seg ${className}`} role="group" aria-label={t('nav.language')}>
      {LANGS.map((l) => (
        <button key={l.id} type="button" className={`seg__btn${lang === l.id ? ' is-on' : ''}`} aria-pressed={lang === l.id} onClick={() => setLang(l.id)} title={l.name}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

function PackPill() {
  const { packs, now, refresh } = useGame();
  const { t } = useI18n();
  useNow(1000);
  const remaining = packs?.nextAt ? packs.nextAt - now() : null;
  const fired = useRef(false);
  useEffect(() => {
    if (remaining != null && remaining <= 0 && !fired.current) {
      fired.current = true;
      refresh().finally(() => {
        fired.current = false;
      });
    }
  }, [remaining, refresh]);
  if (!packs) return null;
  return (
    <Link to="/" className={`pill pill--packs${packs.available > 0 || packs.unlimited ? ' has-packs' : ''}`} title={t('header.packs', { n: packs.available })}>
      <Icon name="pack" size={16} />
      <span className="mono">{packs.unlimited ? '∞' : packs.available}</span>
      {!packs.unlimited && remaining != null && remaining > 0 && <span className="pill__timer mono">{formatDuration(remaining)}</span>}
    </Link>
  );
}

function AccountMenu() {
  const { user, logout, isAdmin, pendingFriends } = useGame();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [muted, toggleMuted] = useSound();
  const ref = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account" ref={ref}>
      <button type="button" className="account__btn" aria-haspopup="menu" aria-expanded={open} aria-label={t('nav.menu')} onClick={() => setOpen((o) => !o)}>
        <Avatar user={user} size={38} />
        {pendingFriends > 0 && <span className="dot-badge" aria-hidden="true" />}
      </button>
      {open && (
        <div className="menu" role="menu">
          <Link to="/profile" className="menu__head" role="menuitem">
            <Avatar user={user} size={46} />
            <span>
              <strong>{user.username}</strong>
              <span className="muted small">{t('profile.level', { n: user.level.level })}</span>
            </span>
          </Link>
          <Link to="/profile" className="menu__item" role="menuitem"><Icon name="user" /> {t('nav.studio')}</Link>
          <Link to="/friends" className="menu__item" role="menuitem">
            <Icon name="users" /> {t('nav.friends')}
            {pendingFriends > 0 && <span className="count-badge">{pendingFriends}</span>}
          </Link>
          {isAdmin && <Link to="/admin" className="menu__item" role="menuitem"><Icon name="shield" /> {t('nav.admin')}</Link>}
          <div className="menu__row">
            <span className="menu__label"><Icon name="globe" /> {t('nav.language')}</span>
            <LangSwitch />
          </div>
          <button type="button" className="menu__item" role="menuitemcheckbox" aria-checked={!muted} onClick={toggleMuted}>
            <Icon name={muted ? 'mute' : 'sound'} /> {t('nav.sound')}
            <span className={`switch${muted ? '' : ' is-on'}`} aria-hidden="true" />
          </button>
          <button type="button" className="menu__item menu__item--danger" role="menuitem" onClick={async () => { await logout(); navigate('/login'); }}>
            <Icon name="logout" /> {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

function Header() {
  const { user, pendingFriends } = useGame();
  const { t } = useI18n();
  const [muted, toggleMuted] = useSound();
  const links = [
    { to: '/', label: t('nav.boosters'), icon: 'pack', end: true },
    { to: '/collection', label: t('nav.collection'), icon: 'grid' },
    { to: '/blindtest', label: t('nav.blindtest'), icon: 'headphones' },
    { to: '/friends', label: t('nav.friends'), icon: 'users', badge: pendingFriends },
  ];
  return (
    <>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" className="topbar__logo" aria-label="encore."><Logo /></Link>
          <nav className="topnav" aria-label="Navigation">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className="topnav__link">
                {l.label}
                {l.badge > 0 && <span className="count-badge">{l.badge}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="topbar__right">
            <PackPill />
            <Royalties value={user.royalties} className="pill pill--royalties" />
            <LangSwitch className="hide-mobile" />
            <button type="button" className="icon-btn hide-mobile" onClick={toggleMuted} aria-label={muted ? t('header.soundOff') : t('header.soundOn')} title={muted ? t('header.soundOff') : t('header.soundOn')}>
              <Icon name={muted ? 'mute' : 'sound'} />
            </button>
            <AccountMenu />
          </div>
        </div>
      </header>
      <nav className="tabbar" aria-label="Navigation">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className="tabbar__link">
            <span className="tabbar__icon"><Icon name={l.icon} size={22} />{l.badge > 0 && <span className="dot-badge" />}</span>
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="footer">
      <Logo className="logo--sm" />
      <p>{t('footer.legal')}</p>
      {__DEMO__ && <p className="footer__demo">{t('common.demoNote')}</p>}
    </footer>
  );
}

export default function App() {
  const { status } = useGame();
  const location = useLocation();

  if (status === 'loading') {
    return <div className="boot"><Logo /><Spinner /></div>;
  }

  if (status === 'guest') {
    return (
      <>
        <ScrollToTop />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/check-email" element={<CheckEmail />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/forgot" element={<Forgot />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/dev/mailbox" element={<Mailbox />} />
          <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
        </Routes>
      </>
    );
  }

  return (
    <div className="shell">
      <ScrollToTop />
      <Header />
      <main className="page">
        <Suspense fallback={<div className="boot boot--inline"><Spinner /></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/collection" element={<Collection />} />
            <Route path="/collection/:tab" element={<Collection />} />
            <Route path="/album/:id" element={<AlbumPage />} />
            <Route path="/artist/:id" element={<ArtistPage />} />
            <Route path="/blindtest" element={<BlindTest />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/u/:username" element={<Profile />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/reset" element={<Reset />} />
            <Route path="/dev/mailbox" element={<Mailbox />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
