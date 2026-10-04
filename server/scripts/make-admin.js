// Usage : npm run admin -- <nom_d_utilisateur>   (ajouter --remove pour retirer le rôle)
import { openDb } from '../db.js';

const args = process.argv.slice(2);
const username = args.find((a) => !a.startsWith('--'));
const remove = args.includes('--remove');
if (!username) {
  console.error('Usage : npm run admin -- <nom_d_utilisateur> [--remove]');
  process.exit(1);
}
const db = openDb();
const res = db.prepare('UPDATE users SET role = ? WHERE username = ?').run(remove ? 'player' : 'admin', username);
if (!res.changes) {
  console.error(`Aucun compte « ${username} ».`);
  process.exit(1);
}
console.log(remove ? `${username} n'est plus admin.` : `${username} est maintenant admin.`);
