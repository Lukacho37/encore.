// Texte publié par un joueur (critique, post, commentaire) — chantier P0-F (PLAN.md 9.2). Props : { text, clamp? }.
// Squelette posé par K0 (scripts/scaffold.mjs) : le texte tel quel, retours à la ligne gardés. P0-F ajoute les liens
// autorisés et la coupure « Lire la suite ».
export function UgcText({ text }) {
  return <span style={{ whiteSpace: 'pre-line' }}>{text}</span>;
}

export default UgcText;
