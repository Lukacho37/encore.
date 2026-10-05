// Client HTTP de l'API. En mode démo, les appels sont servis par un faux serveur dans le navigateur.
import { absorbResponse } from './catalogStore.js';

export class ApiError extends Error {
  constructor(status, code, data = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

let demoServer = null;

export async function api(method, path, body) {
  if (__DEMO__) {
    demoServer ||= await import('./demo/mockServer.js');
    const data = await demoServer.handle(method, path, body);
    absorbResponse(data);
    return data;
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
  absorbResponse(data);
  return data;
}

export const get = (path) => api('GET', path);
export const post = (path, body = {}) => api('POST', path, body);
export const del = (path) => api('DELETE', path);
