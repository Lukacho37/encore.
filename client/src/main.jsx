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
// Polices de l'identité (Archivo, Figtree, Martian Mono), fichiers des paquets @fontsource-variable (licence OFL 1.1).
import archivoVietnamese from '@fontsource-variable/archivo/files/archivo-vietnamese-wdth-normal.woff2?url';
import archivoLatinExt from '@fontsource-variable/archivo/files/archivo-latin-ext-wdth-normal.woff2?url';
import archivoLatin from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url';
import figtreeLatinExt from '@fontsource-variable/figtree/files/figtree-latin-ext-wght-normal.woff2?url';
import figtreeLatin from '@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url';
import martianCyrillicExt from '@fontsource-variable/martian-mono/files/martian-mono-cyrillic-ext-wdth-normal.woff2?url';
import martianCyrillic from '@fontsource-variable/martian-mono/files/martian-mono-cyrillic-wdth-normal.woff2?url';
import martianLatinExt from '@fontsource-variable/martian-mono/files/martian-mono-latin-ext-wdth-normal.woff2?url';
import martianLatin from '@fontsource-variable/martian-mono/files/martian-mono-latin-wdth-normal.woff2?url';

// ----- polices hébergées avec le site (P2-E, PLAN.md 7.1 et risque R14) -----------------------------------------
// Plus aucune requête vers Google Fonts (l'adresse IP des visiteurs n'y part plus) : les mêmes familles, axes et
// descripteurs que la feuille Google Fonts d'avant (Archivo wdth 62–125 % × wght 400–900 ; Figtree en cinq faces à
// graisse fixe 400 à 800, donc le 650 des boutons s'affiche toujours en 700 ; Martian Mono wdth 75–112,5 % × wght
// 400–700 ; mêmes sous-ensembles, mêmes plages Unicode). Les fichiers sont identiques octet pour octet à ceux de
// fonts.gstatic.com : le rendu ne change pas. Déclarées ici par l'API FontFace plutôt qu'en @font-face : les noms de
// famille restent écrits dans les seuls jetons --font-* de app.css (css-lint), et la démo autonome embarque chaque
// fichier une seule fois (les cinq faces de Figtree partagent le leur). Comme en CSS, une face n'est téléchargée que
// lorsqu'un texte en a besoin ; le site les sert depuis /assets (font-src 'self').
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF';
const VIETNAMESE = 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB';
const CYRILLIC_EXT = 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F';
const CYRILLIC = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116';
const ARCHIVO = { weight: '400 900', stretch: '62% 125%' };
const MARTIAN = { weight: '400 700', stretch: '75% 112.5%' };
const FONT_FACES = [
  ['Archivo', archivoVietnamese, { ...ARCHIVO, unicodeRange: VIETNAMESE }],
  ['Archivo', archivoLatinExt, { ...ARCHIVO, unicodeRange: LATIN_EXT }],
  ['Archivo', archivoLatin, { ...ARCHIVO, unicodeRange: LATIN }],
  ...['400', '500', '600', '700', '800'].flatMap((weight) => [
    ['Figtree', figtreeLatinExt, { weight, unicodeRange: LATIN_EXT }],
    ['Figtree', figtreeLatin, { weight, unicodeRange: LATIN }],
  ]),
  ['Martian Mono', martianCyrillicExt, { ...MARTIAN, unicodeRange: CYRILLIC_EXT }],
  ['Martian Mono', martianCyrillic, { ...MARTIAN, unicodeRange: CYRILLIC }],
  ['Martian Mono', martianLatinExt, { ...MARTIAN, unicodeRange: LATIN_EXT }],
  ['Martian Mono', martianLatin, { ...MARTIAN, unicodeRange: LATIN }],
];

function registerFonts() {
  if (typeof FontFace !== 'function' || !document.fonts?.add) return;
  for (const [family, url, descriptors] of FONT_FACES) {
    try {
      document.fonts.add(new FontFace(family, `url(${url}) format('woff2')`, { style: 'normal', display: 'swap', ...descriptors }));
    } catch {
      // Moteur sans un descripteur (très ancien lecteur intégré) : le texte garde la police de repli des jetons.
    }
  }
}
registerFonts();

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
