// Quêtes du joueur côté site (GET /api/quests) : une seule copie pour la rangée de l'accueil et la page Quêtes, mise à
// jour après chaque réclamation, relance ou bonus, et relue (au plus une fois toutes les 1,5 s) quand une autre action
// du joueur a pu faire avancer une quête (booster ouvert, note, vote…). Chantier P1-F.
//   const { data, error, loading, reload } = useQuests();
//   await claimQuest(periodKey, slot) · rerollQuest(periodKey, slot) · claimBonus(periodKey)
import { useEffect, useSyncExternalStore } from 'react';
import { get, onApiResponse, post } from '../../api.js';

const enc = encodeURIComponent;
let store = { data: null, error: null, loading: false, at: 0 };
const listeners = new Set();
let watchers = 0;
let pending = null;
let timer = null;
let subscribed = false;

function set(patch) {
  store = { ...store, ...patch };
  for (const fn of listeners) fn();
}

/** Recharge les quêtes (une requête à la fois). */
export function loadQuests() {
  if (pending) return pending;
  set({ loading: true });
  pending = get('/quests')
    .then((data) => set({ data, error: null, loading: false, at: Date.now() }))
    .catch((error) => set({ error, loading: false }))
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Une action du joueur qui renvoie un état (booster, note, vote…) peut faire avancer une quête : relecture différée. */
function listen() {
  if (subscribed) return;
  subscribed = true;
  onApiResponse((res, { method, path }) => {
    if (method === 'GET' || !res?.state || String(path).startsWith('/quests')) return;
    if (!watchers) {
      set({ at: 0 }); // relue au prochain affichage
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(loadQuests, 1500);
  });
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const read = () => store;

/** Quêtes du joueur : { data, error, loading, reload } ; chargées au premier affichage, relues si elles ont vieilli. */
export function useQuests() {
  const state = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    listen();
    watchers += 1;
    // Une minute sans relecture, ou une période finie : on relit.
    const stale = !store.data || Date.now() - store.at > 60_000 || (store.data.daily?.endsAt && Date.now() >= store.data.daily.endsAt);
    if (stale) loadQuests();
    return () => {
      watchers -= 1;
    };
  }, []);
  return { ...state, reload: loadQuests };
}

/** Remplace une quête dans la copie locale (réponse d'une réclamation ou d'une relance). */
function patchQuest(periodKey, quest, extra = {}) {
  const data = store.data;
  if (!data || !quest) return;
  const fix = (period) => {
    if (!period || period.periodKey !== periodKey) return period;
    const slots = period.slots.map((q) => (q.slot === quest.slot ? quest : q));
    const all = slots.length === 3 && slots.every((q) => q.claimed);
    return { ...period, slots, ...extra, bonus: { ...period.bonus, claimable: all && !period.bonus?.claimed } };
  };
  const firstSteps = periodKey === 'first' ? data.firstSteps.map((q) => (q.slot === quest.slot ? quest : q)) : data.firstSteps;
  set({ data: { ...data, daily: fix(data.daily), weekly: fix(data.weekly), firstSteps } });
}

/** Réclame une quête : { reward, quest, levelUp, badgesEarned, state } (l'état partiel est fusionné par api.js). */
export async function claimQuest(periodKey, slot) {
  const res = await post(`/quests/${enc(periodKey)}/${slot}/claim`);
  patchQuest(periodKey, res.quest);
  return res;
}

/** Relance une quête du jour : { quest, rerollsLeft }. */
export async function rerollQuest(periodKey, slot) {
  const res = await post(`/quests/${enc(periodKey)}/${slot}/reroll`);
  patchQuest(periodKey, res.quest, { rerollsLeft: res.rerollsLeft });
  return res;
}

/** Bonus de la période (3 quêtes réclamées) : { reward, state }. */
export async function claimBonus(periodKey) {
  const res = await post(`/quests/bonus/${enc(periodKey)}`);
  const data = store.data;
  if (data) {
    const fix = (p) => (p && p.periodKey === periodKey ? { ...p, bonus: { ...p.bonus, claimable: false, claimed: true, reward: res.reward } } : p);
    set({ data: { ...data, daily: fix(data.daily), weekly: fix(data.weekly) } });
  }
  return res;
}
