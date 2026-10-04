import { Component, Fragment } from 'react';
import { storage } from '../storage.js';

const DEMO_KEY = 'albummania.demo.v1';

// Textes en dur : cette barrière entoure tout, y compris le fournisseur de traductions.
const TEXT = {
  fr: {
    title: 'AlbumMania a rencontré une erreur',
    body: 'La page n’a pas pu s’afficher. Recharge-la ; si l’erreur revient, réinitialise la démo.',
    reload: 'Recharger',
    reset: 'Réinitialiser la démo',
    details: 'Détail technique',
  },
  en: {
    title: 'AlbumMania ran into an error',
    body: 'The page could not be displayed. Reload it; if the error comes back, reset the demo.',
    reload: 'Reload',
    reset: 'Reset the demo',
    details: 'Technical details',
  },
};

function lang() {
  const saved = storage.get('albummania.lang');
  if (saved === 'fr' || saved === 'en') return saved;
  try {
    return (navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
  } catch {
    return 'fr';
  }
}

/** Affiche l'erreur au lieu de laisser un écran vide quand un composant plante. */
export default class ErrorBoundary extends Component {
  state = { error: null, attempt: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidMount() {
    // Signale au garde-fou de la démo autonome que l'application a démarré.
    window.__albummaniaReady = true;
  }

  componentDidCatch(error, info) {
    console.error('AlbumMania', error, info?.componentStack);
  }

  retry = () => {
    try {
      window.location.reload();
    } catch {
      this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
    }
  };

  resetDemo = () => {
    storage.remove(DEMO_KEY);
    this.retry();
  };

  render() {
    const { error, attempt } = this.state;
    if (!error) return <Fragment key={attempt}>{this.props.children}</Fragment>;
    const t = TEXT[lang()];
    return (
      <div className="boot crash" role="alert">
        <h1>{t.title}</h1>
        <p className="muted measure">{t.body}</p>
        <div className="crash__actions">
          <button type="button" className="btn btn--primary" onClick={this.retry}>{t.reload}</button>
          {__DEMO__ && <button type="button" className="btn btn--ghost" onClick={this.resetDemo}>{t.reset}</button>}
        </div>
        <details className="crash__details">
          <summary>{t.details}</summary>
          <pre>{String(error?.stack || error?.message || error)}</pre>
        </details>
      </div>
    );
  }
}
