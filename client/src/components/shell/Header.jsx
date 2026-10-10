// Coquille du site : barre du haut, menu du compte et barre d'onglets du téléphone — chantier P0-D.
// Navigation (PLAN.md 2.2 revu par les décisions de l'orchestrateur, design/DESIGN-OVERRIDE.md) :
//   ordinateur : logo · Boosters · Découvrir · Collection · Amis · Studio · recherche globale (GlobalSearch, P0-E) ·
//                pastilles boosters et royalties (inchangées) · FR/EN et son (dans la barre à partir de 1280 px,
//                dans le menu du compte en dessous) · cloche (NotificationBell, P0-F) · avatar (menu du compte) ;
//   téléphone  : logo · recherche · cloche · avatar en haut (pastille des boosters entre 641 et 859 px), et la barre
//                d'onglets Boosters (/) · Découvrir · Collection · Amis · Studio en bas ; à 640 px et moins, le nombre de
//                boosters prêts passe sur l'onglet Boosters.
// Pas de « feuille booster » : l'onglet Boosters et la pastille des boosters mènent à l'accueil, où le héros Boosters
// reste en tête, inchangé. Styles : styles/shell.css (préfixe sh-) et les classes actuelles (.topbar, .topnav__link,
// .pill, .tabbar__link, .menu, .count-badge, .dot-badge).
import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { Avatar, Icon, Logo, Modal, Royalties, formatDuration, useNow, useToast } from '../ui.jsx';
import { ScaleSwitch } from '../Rating.jsx';
import { post } from '../../api.js';
import { pageExists } from '../../routes.jsx';
import { GlobalSearch } from '../search/GlobalSearch.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { GearIcon, LangSwitch, SoundButton, SoundSwitch } from './controls.jsx';
import '../../styles/shell.css';

/** Déjà sur l'accueil : un lien vers « / » remonte au héros Boosters au lieu de ne rien faire. */
function useHomeClick() {
  const { pathname } = useLocation();
  return () => {
    if (pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}

/** Entrées de la navigation principale (barre du haut et barre d'onglets). */
export function useNavLinks() {
  const { counts } = useGame();
  const pendingFriends = counts?.pendingFriends ?? 0;
  const { t } = useI18n();
  return [
    { id: 'boosters', to: '/', label: t('nav.boosters'), icon: 'pack', end: true },
    { id: 'discover', to: '/discover', label: t('nav.discover'), icon: 'compass' },
    { id: 'collection', to: '/collection', label: t('nav.collection'), icon: 'grid' },
    { id: 'friends', to: '/friends', label: t('nav.friends'), icon: 'users', badge: pendingFriends },
    { id: 'studio', to: '/studio', label: t('nav.studioTab'), icon: 'user' },
  ].filter((l) => l.id !== 'discover' || pageExists('Discover'));
}

/** Pastille des boosters (inchangée) : stock, minuteur du prochain gratuit ; mène à l'accueil. */
function PackPill() {
  const { packs, now, refresh } = useGame();
  const { t } = useI18n();
  const homeClick = useHomeClick();
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
    <Link to="/" onClick={homeClick} className={`pill pill--packs sh-packs${packs.available > 0 || packs.unlimited ? ' has-packs' : ''}`} title={t('header.packs', { n: packs.available })}>
      <Icon name="pack" size={16} />
      <span className="mono">{packs.unlimited ? '∞' : packs.available}</span>
      {!packs.unlimited && remaining != null && remaining > 0 && <span className="pill__timer mono">{formatDuration(remaining)}</span>}
    </Link>
  );
}

/** Démo uniquement : l'accès admin se déverrouille avec le code secret du propriétaire. */
function DemoAdminUnlock({ open, onClose }) {
  const { t, error } = useI18n();
  const { applyState } = useGame();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      const res = await post('/demo/unlock-admin', { code });
      applyState(res.state);
      toast(t('demo.unlocked'), 'success');
      setCode('');
      onClose();
    } catch (ex) {
      setErr(error(ex.code));
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('demo.unlock')} className="modal--narrow">
      <form className="auth__form" onSubmit={submit}>
        <p className="muted small">{t('demo.hint')}</p>
        <label className="field__label" htmlFor="demo-admin-code">{t('demo.code')}</label>
        <input id="demo-admin-code" className="input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} data-autofocus />
        {err && <p className="form-error">{err}</p>}
        <button type="submit" className="btn btn--primary" disabled={!code.trim()}>{t('demo.submit')}</button>
      </form>
    </Modal>
  );
}

/**
 * Menu du compte (style actuel) : en-tête (avatar, pseudo, niveau, royalties) · Mon Studio · Amis · Quêtes et Badges
 * (dès que leurs pages existent) · Paramètres · Langue · Notation · Effets sonores · Admin (propriétaire) ·
 * déverrouillage admin (démo) · Se déconnecter.
 */
function AccountMenu() {
  const { user, logout, isAdmin, counts } = useGame();
  const pendingFriends = counts?.pendingFriends ?? 0;
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [unlock, setUnlock] = useState(false);
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
        <div className="menu sh-menu" role="menu">
          <Link to="/studio" className="menu__head" role="menuitem">
            <Avatar user={user} size={46} />
            <span className="sh-menu__who">
              <strong>{user.username}</strong>
              <span className="sh-menu__meta">
                <span>{t('profile.level', { n: user.level.level })}</span>
                <Royalties value={user.royalties} />
              </span>
            </span>
          </Link>
          <Link to="/studio" className="menu__item" role="menuitem"><Icon name="user" /> {t('nav.myStudio')}</Link>
          <Link to="/friends" className="menu__item" role="menuitem">
            <Icon name="users" /> {t('nav.friends')}
            {pendingFriends > 0 && <span className="count-badge">{pendingFriends}</span>}
          </Link>
          {pageExists('Quests') && <Link to="/quests" className="menu__item" role="menuitem"><Icon name="flag" /> {t('nav.quests')}</Link>}
          {pageExists('Badges') && <Link to="/badges" className="menu__item" role="menuitem"><Icon name="trophy" /> {t('nav.badges')}</Link>}
          {pageExists('Settings') && <Link to="/settings" className="menu__item" role="menuitem"><GearIcon /> {t('nav.settings')}</Link>}
          {isAdmin && <Link to="/admin" className="menu__item" role="menuitem"><Icon name="shield" /> {t('nav.admin')}</Link>}
          <div className="menu__row">
            <span className="menu__label"><Icon name="globe" /> {t('nav.language')}</span>
            <LangSwitch />
          </div>
          <div className="menu__row">
            <span className="menu__label"><Icon name="star" /> {t('nav.scale')}</span>
            <ScaleSwitch />
          </div>
          <SoundSwitch />
          {__DEMO__ && !isAdmin && (
            <button type="button" className="menu__item" role="menuitem" onClick={() => { setOpen(false); setUnlock(true); }}>
              <Icon name="lock" /> {t('demo.unlock')}
            </button>
          )}
          <button type="button" className="menu__item menu__item--danger" role="menuitem" onClick={async () => { await logout(); navigate('/login'); }}>
            <Icon name="logout" /> {t('nav.logout')}
          </button>
        </div>
      )}
      {__DEMO__ && <DemoAdminUnlock open={unlock} onClose={() => setUnlock(false)} />}
    </div>
  );
}

/** Barre d'onglets du téléphone (< 860 px) : 5 colonnes, opaque ; l'onglet Boosters porte le nombre de boosters prêts. */
function TabBar({ links }) {
  const { packs } = useGame();
  const { t } = useI18n();
  const homeClick = useHomeClick();
  const ready = packs ? (packs.unlimited ? '∞' : packs.available) : 0;
  return (
    <nav className="tabbar sh-tabbar" aria-label={t('nav.tabs')}>
      {links.map((l) => {
        const boosters = l.id === 'boosters';
        const label = boosters && ready ? `${l.label} · ${packs.unlimited ? t('header.unlimited') : t('header.packs', { n: ready })}` : undefined;
        return (
          <NavLink key={l.to} to={l.to} end={l.end} onClick={boosters ? homeClick : undefined} aria-label={label}
            className={`tabbar__link sh-tab sh-tab--${l.id}${boosters && !ready ? ' is-empty' : ''}`}>
            <span className="tabbar__icon">
              <Icon name={l.icon} size={22} />
              {boosters && ready ? <span className="tabbar__count" aria-hidden="true">{ready}</span> : null}
              {l.badge > 0 && <span className="dot-badge" aria-hidden="true" />}
            </span>
            <span>{l.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function Header() {
  const { user } = useGame();
  const { t } = useI18n();
  const links = useNavLinks();
  const homeClick = useHomeClick();
  return (
    <>
      <a href="#main" className="sh-skip">{t('shell.skip')}</a>
      <header className="topbar sh-topbar">
        <div className="topbar__inner">
          <Link to="/" onClick={homeClick} className="topbar__logo sh-logo" aria-label="AlbumMania"><Logo /></Link>
          <nav className="topnav sh-topnav" aria-label={t('nav.main')}>
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} onClick={l.id === 'boosters' ? homeClick : undefined} className="topnav__link">
                {l.label}
                {l.badge > 0 && <span className="count-badge">{l.badge}</span>}
              </NavLink>
            ))}
          </nav>
          {/* Emplacement de la recherche globale (P0-E) : il prend la place libre entre la navigation et les pastilles. */}
          <div className="sh-search"><GlobalSearch /></div>
          <div className="topbar__right">
            <PackPill />
            <Royalties value={user.royalties} className="pill pill--royalties sh-royalties" />
            <LangSwitch className="sh-wide" />
            <SoundButton className="sh-wide" />
            <NotificationBell />
            <AccountMenu />
          </div>
        </div>
      </header>
      <TabBar links={links} />
    </>
  );
}

export default Header;
