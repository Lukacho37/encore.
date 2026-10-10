import { useEffect, Suspense } from 'react';
import { Routes, useLocation } from 'react-router';
import { useGame } from './state/GameContext.jsx';
import { Logo, Spinner } from './components/ui.jsx';
// Coquille du site (P0-D) : barre du haut, menu du compte, barre d'onglets, bandeau des CGU, pied de page.
import { Header } from './components/shell/Header.jsx';
import { Footer } from './components/shell/Footer.jsx';
import { TermsBanner } from './components/shell/TermsBanner.jsx';
// Pages : table des routes (chargement à la demande sauf accueil et connexion).
import { guestRoutes, userRoutes } from './routes.jsx';

function ScrollToTop() {
  const { pathname } = useLocation();
  // Accolades obligatoires : un effet ne doit rien renvoyer d'autre qu'une fonction de nettoyage.
  // Dans certains lecteurs intégrés (claude.ai), scrollTo renvoie une valeur, que React tenterait d'appeler.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
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
