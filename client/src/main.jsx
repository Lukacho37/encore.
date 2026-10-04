import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router';
import App from './App.jsx';
import { I18nProvider } from './i18n/index.jsx';
import { GameProvider } from './state/GameContext.jsx';
import { ToastProvider } from './components/ui.jsx';
import { CardModalProvider } from './components/CardModal.jsx';
import './styles/app.css';

// La démo tourne dans un cadre isolé : on garde la navigation en mémoire.
const Router = __DEMO__ ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router>
      <I18nProvider>
        <GameProvider>
          <ToastProvider>
            <CardModalProvider>
              <App />
            </CardModalProvider>
          </ToastProvider>
        </GameProvider>
      </I18nProvider>
    </Router>
  </StrictMode>,
);
