// Feuille de base en premier : jetons et composants communs d'abord, puis les feuilles des pages et des chantiers
// (importées par leurs composants), qui la précisent sans astuce de spécificité.
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router';
import App from './App.jsx';
import { I18nProvider } from './i18n/index.jsx';
import { GameProvider } from './state/GameContext.jsx';
import { ToastProvider } from './components/ui.jsx';
import { CardModalProvider } from './components/CardModal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { CoversProvider } from './state/CoversContext.jsx';

// La démo tourne dans un cadre isolé : on garde la navigation en mémoire.
const Router = __DEMO__ ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <Router>
        <I18nProvider>
          <CoversProvider>
            <GameProvider>
              <ToastProvider>
                <CardModalProvider>
                  <App />
                </CardModalProvider>
              </ToastProvider>
            </GameProvider>
          </CoversProvider>
        </I18nProvider>
      </Router>
    </ErrorBoundary>
  </StrictMode>,
);
