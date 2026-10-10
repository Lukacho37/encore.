// Table des routes du site (PLAN.md 2.1), posée par K0 ; appartient ensuite à P0-D (P1-B en P1).
// Chaque route : { path, page, name?, guest?, eager?, redirect? }
//   page     : nom du fichier dans pages/ (sans .jsx) ; name : export nommé à utiliser (défaut : export par défaut) ;
//   guest    : absent → joueurs connectés seulement ; true → tout le monde ; 'only' → visiteurs non connectés
//              seulement (un joueur connecté qui y arrive repart sur l'accueil) ;
//   eager    : page incluse dans le premier chargement (accueil, connexion) ; les autres se chargent à la demande ;
//   redirect : ancienne adresse redirigée (requête et ancre gardées).
// Les pages sont trouvées par nom de fichier : tant qu'un chantier n'a pas créé sa page, la route affiche NotFound
// (et aucune entrée de navigation ne doit y mener : `pageExists('Discover')`).
import { lazy, Suspense } from 'react';
import { Navigate, Route, useLocation } from 'react-router';
import { Spinner } from './components/ui.jsx';
import { safeFrom } from './components/shell/redirect.js';
// Feuilles des pages chargées à la demande : importées ici aussi (premier chargement), à la place qu'elles avaient
// quand App.jsx importait toutes les pages, pour que l'ordre de la cascade (donc le rendu) ne dépende pas de l'ordre
// dans lequel on visite les pages. main.jsx importe app.css avant tout le reste (P0-B).
import './styles/collection.css';
import './styles/album.css';
import './styles/profile.css';

export const ROUTES = [
  // Visiteurs (et pages ouvertes à tous)
  { path: '/login', page: 'Auth', name: 'Login', guest: 'only', eager: true },
  { path: '/signup', page: 'Auth', name: 'Signup', guest: 'only', eager: true },
  { path: '/check-email', page: 'Auth', name: 'CheckEmail', guest: 'only', eager: true },
  { path: '/forgot', page: 'Auth', name: 'Forgot', guest: 'only', eager: true },
  { path: '/verify', page: 'Auth', name: 'Verify', guest: true, eager: true },
  { path: '/reset', page: 'Auth', name: 'Reset', guest: true, eager: true },
  { path: '/dev/mailbox', page: 'Mailbox', guest: true },
  { path: '/legal/:page', page: 'Legal', guest: true },
  { path: '/report', page: 'Report', guest: true },

  // Joueurs connectés
  { path: '/', page: 'Home', eager: true },
  { path: '/search', page: 'SearchPage' },
  { path: '/discover', page: 'Discover' },
  { path: '/collection', page: 'Collection' },
  { path: '/collection/:tab', page: 'Collection' },
  { path: '/album/:id', page: 'AlbumPage' },
  { path: '/track/:id', page: 'TrackPage' },
  { path: '/artist/:id', page: 'ArtistPage' },
  { path: '/studio', page: 'Profile' },
  { path: '/profile', redirect: '/studio' },
  { path: '/u/:username', page: 'Profile' },
  { path: '/u/:username/nine', page: 'GridEditor' },
  { path: '/u/:username/passport', page: 'Passport' },
  { path: '/u/:username/:tab', page: 'Profile' },
  { path: '/nine', page: 'GridEditor' },
  { path: '/friends', page: 'Friends' },
  { path: '/notifications', page: 'Notifications' },
  { path: '/post/:id', page: 'PostPage' },
  { path: '/review/:id', page: 'ReviewPage' },
  { path: '/lists', page: 'Lists' },
  { path: '/lists/new', page: 'ListEditor' },
  { path: '/list/:id', page: 'ListPage' },
  { path: '/list/:id/edit', page: 'ListEditor' },
  { path: '/battles', page: 'Battles' },
  { path: '/rankings', page: 'Rankings' },
  { path: '/rankings/:category', page: 'Rankings' },
  { path: '/match/:username', page: 'TasteMatch' },
  { path: '/quests', page: 'Quests' },
  { path: '/badges', page: 'Badges' },
  { path: '/welcome', page: 'Onboarding' },
  { path: '/settings', page: 'Settings' },
  { path: '/passport', page: 'Passport' },
  { path: '/retro/:year', page: 'Retro' },
  { path: '/events', page: 'Events' },
  { path: '/events/:slug', page: 'Events' },
  { path: '/sets/:id', page: 'SetPage' },
  { path: '/blindtest', page: 'BlindTest' },
  { path: '/admin', page: 'Admin' },
  { path: '/admin/:tab', page: 'Admin' },
];

// Les chemins des deux globs doivent rester littéraux (Vite les lit à la compilation). Les pages « eager » de la
// table sont dans le premier, avec NotFound (affichée sans attendre de chargement).
const EAGER = import.meta.glob(['./pages/Home.jsx', './pages/Auth.jsx', './pages/NotFound.jsx'], { eager: true });
const LAZY = import.meta.glob(['./pages/*.jsx', '!./pages/Home.jsx', '!./pages/Auth.jsx', '!./pages/NotFound.jsx']);
const NotFound = EAGER['./pages/NotFound.jsx'].default;

const fileOf = (page) => `./pages/${page}.jsx`;

/** Une page existe-t-elle déjà ? (pour n'afficher une entrée de navigation que vers une page qui marche) */
export const pageExists = (page) => fileOf(page) in EAGER || fileOf(page) in LAZY;

function PageFallback() {
  return <div className="boot boot--inline"><Spinner /></div>;
}

/** Composant d'une route, créé une seule fois (React.lazy doit garder la même identité d'un rendu à l'autre). */
const components = new Map();
function componentOf(page, name = 'default') {
  const key = `${page}#${name}`;
  if (!components.has(key)) {
    const file = fileOf(page);
    let Component = NotFound;
    if (EAGER[file]) Component = EAGER[file][name] || NotFound;
    else if (LAZY[file]) {
      const Lazy = lazy(() => LAZY[file]().then((mod) => ({ default: mod[name] || NotFound })));
      Component = function LazyPage() {
        return <Suspense fallback={<PageFallback />}><Lazy /></Suspense>;
      };
    }
    components.set(key, Component);
  }
  return components.get(key);
}

/** Ancienne adresse → nouvelle, en gardant la requête et l'ancre. */
function Redirect({ to }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}

// Retour après la connexion : la page gardée dans state.from n'est rouverte que si c'est une adresse interne.
export { safeFrom };

/** Visiteur sur une page réservée aux joueurs : connexion d'abord, la page demandée est gardée dans state.from. */
function GuestCatchAll() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to="/login" replace state={{ from: `${pathname}${search}${hash}` }} />;
}

/**
 * Joueur connecté sur une page réservée aux visiteurs (connexion, inscription…) : vers la page demandée avant la
 * connexion (state.from), sinon l'accueil. C'est aussi ce qui s'affiche juste après la connexion, avant que la
 * navigation de la page de connexion ne s'applique (react-router la passe en transition) : les deux mènent au même
 * endroit.
 */
function GuestOnly() {
  const { state } = useLocation();
  return <Navigate to={safeFrom(state?.from)} replace />;
}

function elementOf(route) {
  if (route.redirect) return <Redirect to={route.redirect} />;
  const Component = componentOf(route.page, route.name);
  return <Component />;
}

/** Routes d'un visiteur non connecté (à placer dans <Routes>). */
export const guestRoutes = [
  ...ROUTES.filter((r) => r.guest).map((r) => <Route key={r.path} path={r.path} element={elementOf(r)} />),
  <Route key="*" path="*" element={<GuestCatchAll />} />,
];

/** Routes d'un joueur connecté (à placer dans <Routes>, dans la coque du site). */
export const userRoutes = [
  ...ROUTES.map((r) => (
    <Route key={r.path} path={r.path} element={r.guest === 'only' ? <GuestOnly /> : elementOf(r)} />
  )),
  <Route key="*" path="*" element={<NotFound />} />,
];
