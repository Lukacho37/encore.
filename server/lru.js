// Petit cache mémoire à durée de vie limitée (PLAN.md 7.3) : profil 30 s, propriétaires d'un morceau 5 min,
// Découvrir 10 min par joueur, tendances 10 min, classements 60 s. Les plus anciennes entrées partent en premier
// quand le cache est plein (ordre d'insertion de Map, rafraîchi à chaque lecture).

export function createLru({ max = 500, ttlMs = 60_000, now = Date.now } = {}) {
  const map = new Map();

  function get(key) {
    const entry = map.get(key);
    if (!entry) return undefined;
    if (entry.exp <= now()) {
      map.delete(key);
      return undefined;
    }
    // Dernier lu = dernier sorti.
    map.delete(key);
    map.set(key, entry);
    return entry.value;
  }

  function set(key, value, ttl = ttlMs) {
    map.delete(key);
    map.set(key, { value, exp: now() + ttl });
    while (map.size > max) map.delete(map.keys().next().value);
    return value;
  }

  /** Valeur en cache, sinon `fn()` calculée puis gardée (une valeur `undefined` n'est pas gardée). */
  function wrap(key, fn, ttl = ttlMs) {
    const hit = get(key);
    if (hit !== undefined) return hit;
    const value = fn();
    return value === undefined ? value : set(key, value, ttl);
  }

  /** Oublie les clés qui commencent par `prefix` (ex. tout ce qui concerne un joueur). */
  function deletePrefix(prefix) {
    for (const key of [...map.keys()]) if (typeof key === 'string' && key.startsWith(prefix)) map.delete(key);
  }

  return {
    get,
    set,
    wrap,
    has: (key) => get(key) !== undefined,
    delete: (key) => map.delete(key),
    deletePrefix,
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
  };
}
