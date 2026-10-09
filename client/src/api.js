// Client HTTP de l'API. En mode démo, les appels sont servis par un faux serveur dans le navigateur.
// Chaque réponse réussie passe par absorbResponse (références du catalogue) puis par les abonnés de onApiResponse :
// GameContext y fusionne l'état du joueur (state partiel ou complet, client/src/state/mergeState.js), de sorte
// qu'aucune page n'a besoin d'appeler applyState elle-même (les appels existants restent sans effet en double).
import { absorbResponse } from './catalogStore.js';

export class ApiError extends Error {
  constructor(status, code, data = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const listeners = new Set();

/** Abonne `fn(data, { method, path })` à chaque réponse réussie ; renvoie la fonction de désabonnement. */
export function onApiResponse(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function received(data, method, path) {
  absorbResponse(data);
  for (const fn of listeners) {
    try {
      fn(data, { method, path });
    } catch (err) {
      console.error('[api] abonné en erreur :', err);
    }
  }
  return data;
}

let demoServer = null;

export async function api(method, path, body) {
  if (__DEMO__) {
    demoServer ||= await import('./demo/mockServer.js');
    const data = await demoServer.handle(method, path, body);
    return received(data, method, path);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-AlbumMania': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'server_error', data);
  return received(data, method, path);
}

export const get = (path) => api('GET', path);
export const post = (path, body = {}) => api('POST', path, body);
export const put = (path, body = {}) => api('PUT', path, body);
export const del = (path) => api('DELETE', path);
