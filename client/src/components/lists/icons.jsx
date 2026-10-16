// Icônes propres aux listes et aux images de partage — chantier P1-C. Même trait que l'Icon commun (ui.jsx : 24 × 24,
// trait 1,8, bouts arrondis) ; celles qui existent déjà là-bas (plus, close, share, list…) ne sont pas redessinées ici.

const common = (size) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
});

export function ListIcon({ name, size = 18 }) {
  const p = common(size);
  switch (name) {
    case 'download':
      return <svg {...p}><path d="M12 4v11M7 10.5l5 5 5-5" /><path d="M5 19.5h14" /></svg>;
    case 'grip':
      return <svg {...p}><circle cx="9" cy="6" r="0.6" /><circle cx="15" cy="6" r="0.6" /><circle cx="9" cy="12" r="0.6" /><circle cx="15" cy="12" r="0.6" /><circle cx="9" cy="18" r="0.6" /><circle cx="15" cy="18" r="0.6" /></svg>;
    case 'up':
      return <svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
    case 'down':
      return <svg {...p}><path d="M12 5v14M6 13l6 6 6-6" /></svg>;
    case 'left':
      return <svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
    case 'right':
      return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'swap':
      return <svg {...p}><path d="M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8" /></svg>;
    case 'trash':
      return <svg {...p}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5" /></svg>;
    case 'image':
      return <svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 16l-5-5-8 8.5" /></svg>;
    case 'lock':
      return <svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    case 'friends':
      return <svg {...p}><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="8" r="2.4" /><path d="M16 13.2a4.5 4.5 0 0 1 5 4.8" /></svg>;
    case 'globe':
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.6 5.2 3.6 8.5s-1.1 6.1-3.6 8.5c-2.5-2.4-3.6-5.2-3.6-8.5S9.5 5.9 12 3.5z" /></svg>;
    default:
      return null;
  }
}

export default ListIcon;
