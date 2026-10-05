// Visuels générés pour les albums et singles importés (catalogue Deezer) : une palette et un motif tirés
// de façon déterministe de leur identifiant. Le même identifiant donne toujours le même visuel.

const PALETTES = [
  ['#0b1030', '#4fc3ff', '#f1e9ff'],
  ['#1a0f0a', '#ff8b3d', '#ffe3b0'],
  ['#0f1f17', '#7fd36b', '#e8ffd9'],
  ['#1b0f24', '#b17dff', '#ffd6f3'],
  ['#231616', '#ef3b3b', '#f4eee3'],
  ['#101820', '#f2aa4c', '#e9e5d8'],
  ['#14213d', '#fca311', '#e5e5e5'],
  ['#2b2d42', '#ef233c', '#edf2f4'],
  ['#0d1b2a', '#778da9', '#e0e1dd'],
  ['#1d3557', '#e63946', '#f1faee'],
  ['#2d0b1e', '#ff4f7e', '#ffd35a'],
  ['#0a2a2a', '#3fd6c4', '#fefae0'],
  ['#3d2c1e', '#c9a227', '#f6ecd2'],
  ['#111111', '#e8e8e8', '#c9a227'],
  ['#f2f2ee', '#1c1c1c', '#d23a2f'],
  ['#e7e3d8', '#2d2a24', '#7a8b3a'],
  ['#0e0e12', '#c9b37e', '#6d7a8c'],
  ['#1e1b3a', '#ffb4a2', '#e5989b'],
  ['#132a13', '#ecf39e', '#90a955'],
  ['#22223b', '#c9ada7', '#f2e9e4'],
  ['#3a0ca3', '#f72585', '#4cc9f0'],
  ['#283618', '#dda15e', '#fefae0'],
  ['#03045e', '#00b4d8', '#caf0f8'],
  ['#370617', '#f48c06', '#ffba08'],
  ['#1b263b', '#e0b1cb', '#be95c4'],
  ['#2f3e46', '#cad2c5', '#84a98c'],
  ['#5f0f40', '#fb8b24', '#e36414'],
  ['#0b090a', '#e5383b', '#f5f3f4'],
];

const MOTIFS = ['bars', 'rings', 'sun', 'grid', 'stripes', 'orbit', 'arcs', 'burst', 'diamond', 'checker', 'curtain', 'dots', 'halftone', 'shards', 'split', 'spotlight', 'waves'];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Palette et motif d'un visuel généré à partir d'un identifiant d'album ou de single. */
export function generatedArt(id) {
  const h = hash(String(id));
  return { palette: PALETTES[h % PALETTES.length], motif: MOTIFS[(h >>> 8) % MOTIFS.length] };
}
