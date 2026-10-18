import { useEffect, Suspense } from 'react';
import { Routes, useLocation, useNavigate } from 'react-router';
import { useGame } from './state/GameContext.jsx';
import { Logo, Spinner } from './components/ui.jsx';
// Coquille du site (P0-D) : barre du haut, menu du compte, barre d'onglets, bandeau des CGU, pied de page.
import { Header } from './components/shell/Header.jsx';
import { Footer } from './components/shell/Footer.jsx';
import { TermsBanner } from './components/shell/TermsBanner.jsx';
// Pages : table des routes (chargement à la demande sauf accueil et connexion).
import { guestRoutes, pageExists, userRoutes } from './routes.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  // Accolades obligatoires : un effet ne doit rien renvoyer d'autre qu'une fonction de nettoyage.
  // Dans certains lecteurs intégrés (claude.ai), scrollTo renvoie une valeur, que React tenterait d'appeler.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

// Accueil d'un nouveau joueur (P1-B, PLAN.md 2.1 et 2.5 « Onboarding ») : tant que `user.onboarded` vaut false, une seule
// redirection vers /welcome par session d'onglet (sessionStorage, et une variable du module si le stockage est
// refusé), jamais depuis les pages légales, les Paramètres, le signalement ou la page d'accueil elle-même, jamais pour le
// compte du propriétaire (admin), et seulement quand la page Onboarding existe (P1-E). Le joueur peut ensuite naviguer
// librement : passer l'accueil ne le ramène jamais en boucle.
const ONBOARDING_KEY = 'albummania.onboardingRedirect';
const ONBOARDING_SKIP = /^\/(legal|settings|report|welcome|verify|reset|dev)(\/|$)/;
const onboardingDone = new Set(); // comptes déjà redirigés dans cette page (repli du sessionStorage)

function seenOnboardingRedirect(userId) {
  if (onboardingDone.has(userId)) return true;
  try {
    return window.sessionStorage.getItem(`${ONBOARDING_KEY}.${userId}`) === '1';
  } catch {
    return false;
  }
}

function rememberOnboardingRedirect(userId) {
  onboardingDone.add(userId);
  try {
    window.sessionStorage.setItem(`${ONBOARDING_KEY}.${userId}`, '1');
  } catch {
    // stockage refusé : l'ensemble du module suffit pour cette page
  }
}

function OnboardingRedirect() {
  const { user, isAdmin } = useGame();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pending = user?.onboarded === false && !isAdmin;
  const userId = user?.id;
  useEffect(() => {
    if (!pending || seenOnboardingRedirect(userId) || ONBOARDING_SKIP.test(pathname) || !pageExists('Onboarding')) return;
    rememberOnboardingRedirect(userId);
    navigate('/welcome');
  }, [pending, userId, pathname, navigate]);
  return null;
}

export default function App() {
  const { status } = useGame();

  if (status === 'loading') {
    return <div className="boot"><Logo /><Spinner /></div>;
  }

  // Visiteur : pages de connexion, pages légales et formulaire de signalement, sans la coquille.
  if (status === 'guest') {
    return (
      <>
        <ScrollToTop />
        <Routes>{guestRoutes}</Routes>
      </>
    );
  }

  return (
    <div className="shell">
      <ScrollToTop />
      <OnboardingRedirect />
      <Header />
      <TermsBanner />
      <main className="page sh-main" id="main" tabIndex={-1}>
        <Suspense fallback={<div className="boot boot--inline"><Spinner /></div>}>
          <Routes>{userRoutes}</Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
