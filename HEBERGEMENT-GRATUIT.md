# Mettre AlbumMania en ligne gratuitement (Oracle Cloud)

Compte environ une heure la première fois, puis une dizaine de minutes d'installation automatique. Coût : **0 €**.
Tu auras besoin de :

- une **carte bancaire**, pour qu'Oracle vérifie ton identité (rien n'est prélevé tant que tu restes dans l'offre gratuite) ;
- un compte **Brevo** pour les e-mails : suis la section 1 de [DEPLOIEMENT.md](DEPLOIEMENT.md) et garde de côté l'identifiant SMTP, la clé SMTP et l'adresse d'expédition validée ;
- un ordinateur (Windows, Mac ou Linux) pour lancer quelques commandes.

Plus tard, tu pourras passer sur un hébergeur payant (Render ou autre) sans rien perdre : comptes, collections, enchères et échanges tiennent dans un seul fichier, `albummania.db`, qu'il suffit de copier (voir [la dernière section](#passer-plus-tard-sur-un-hébergeur-payant)).

## 1. Créer ton compte Oracle Cloud

1. Va sur <https://www.oracle.com/cloud/free/> → **Commencer gratuitement**.
2. **Région d'origine** : choisis **France Central (Paris)**, **France South (Marseille)** ou **Germany Central (Frankfurt)**. Ce choix est **définitif**.
3. Termine l'inscription (vérification de la carte).
4. Conseillé : dans **Billing → Upgrade and Manage Payment**, passe le compte en **Pay As You Go**. Tu restes gratuit tant que tu ne dépasses pas les limites « Always Free », et la récupération des machines jugées inactives ne vise que les comptes restés en offre gratuite (vérifie-le dans la FAQ d'Oracle au moment de t'inscrire). Ajoute ensuite une alerte : **Billing → Budgets → Create Budget**, montant 1 €, pour être prévenu au moindre centime.

## 2. Créer le serveur

Menu ☰ → **Compute → Instances → Create instance**.

| Réglage | Quoi choisir |
|---|---|
| Name | `albummania` |
| Image | **Change image → Ubuntu → Canonical Ubuntu 24.04** |
| Shape | **Change shape → Ampere → VM.Standard.A1.Flex**, **2 OCPU** et **12 Go** de mémoire (le maximum gratuit ; 1 OCPU et 6 Go suffisent aussi). Vérifie la mention **Always Free-eligible**. |
| Networking | Crée un nouveau réseau (VCN) avec un **sous-réseau public**, et coche **Assign a public IPv4 address** |
| Add SSH keys | **Generate a key pair for me** → **Save private key**. Renomme le fichier téléchargé (`ssh-key-….key`) en **`albummania.key`** et garde-le précieusement : c'est la clé de ton serveur |

Clique sur **Create**. Au bout d'une minute, la page de l'instance affiche son **Public IP address** (par exemple `152.67.12.34`) : note-la.

> Message « Out of capacity » : les machines Ampere gratuites sont parfois toutes prises dans un centre. Réessaie un peu plus tard, ou choisis un autre **Availability domain** dans la section Placement.

## 3. Ouvrir le web (ports 80 et 443)

Sur la page de l'instance : clique sur le lien du **Subnet** → **Security Lists** → **Default Security List** → **Add Ingress Rules** :

- Source CIDR : `0.0.0.0/0`
- IP Protocol : **TCP**
- Destination Port Range : `80,443`

Enregistre. (Le pare-feu interne du serveur, lui, est ouvert par le script d'installation.)

## 4. Donner une adresse au site (DuckDNS, gratuit)

1. Va sur <https://www.duckdns.org> et connecte-toi (Google, GitHub…).
2. Choisis un sous-domaine, par exemple `albummania` → **add domain**.
3. Dans la colonne **current ip**, mets l'**adresse IP publique** du serveur → **update ip**.
4. Note le **token** affiché en haut de la page.

Ton site sera à l'adresse `https://albummania.duckdns.org`. Tu pourras prendre plus tard un vrai nom de domaine (environ 10 € par an).

## 5. Se connecter au serveur

**Mac ou Linux** : ouvre le **Terminal** et tape (adapte le nom du fichier de clé et l'adresse IP) :

```sh
chmod 600 ~/Downloads/albummania.key
ssh -i ~/Downloads/albummania.key ubuntu@152.67.12.34
```

**Windows** : ouvre **PowerShell**, va dans le dossier de la clé, protège-la (Windows refuse une clé lisible par d'autres comptes), puis connecte-toi :

```powershell
cd $HOME\Downloads
icacls .\albummania.key /inheritance:r
icacls .\albummania.key /grant:r "$($env:USERNAME):(R)"
ssh -i .\albummania.key ubuntu@152.67.12.34
```

À la première connexion, réponds `yes`. Tu es sur le serveur quand l'invite devient `ubuntu@albummania:~$`.

## 6. Installer AlbumMania

Toujours connecté au serveur, colle ces deux commandes :

```sh
curl -fsSL https://raw.githubusercontent.com/Lukacho37/encore./claude/music-album-collection-game-d7i36d/deploy/oracle/install.sh -o install.sh
sudo bash install.sh
```

Le script te pose quelques questions :

- **Adresse du site** : `albummania.duckdns.org` (sans `https://`) ;
- **Jeton DuckDNS** : le token de l'étape 4 (rien ne s'affiche pendant la saisie, c'est normal) ;
- **Ton adresse e-mail** : celle avec laquelle tu créeras ton compte ; **toi seul seras admin** ;
- **Brevo** : identifiant SMTP, clé SMTP, adresse d'expédition validée ;
- **Mentions légales** : ton nom et une adresse de contact.

Il installe ensuite tout seul Node.js, le HTTPS (Caddy, certificat Let's Encrypt), le service du site (il redémarre tout seul, même après un redémarrage du serveur), les mises à jour de sécurité d'Ubuntu et une sauvegarde quotidienne de la base. Compte une dizaine de minutes. À la fin : « C'est en ligne : https://albummania.duckdns.org ».

## 7. Créer ton compte admin

Comme pour Render : section 3 de [DEPLOIEMENT.md](DEPLOIEMENT.md). Ouvre le site, crée ton compte **avec l'adresse donnée au script**, clique sur le lien reçu par e-mail : l'entrée **Admin** apparaît dans le menu de ta photo de profil.

Le catalogue s'importe tout seul (environ 4 heures pour 20 000 albums) ; on peut jouer pendant ce temps.

## 8. Compléter les mentions légales

La loi impose d'indiquer l'hébergeur (nom, adresse, téléphone : ceux d'Oracle, dans ses conditions et mentions légales) et, selon ta situation, ton adresse (voir la section 4 de [DEPLOIEMENT.md](DEPLOIEMENT.md)). Sur le serveur :

```sh
sudo nano /etc/albummania/albummania.env
```

Remplis les lignes `LEGAL_…` entre les guillemets, enregistre (**Ctrl+O**, **Entrée**, **Ctrl+X**), puis :

```sh
sudo systemctl restart albummania
```

Vérifie la page **Mentions légales** (lien en bas du site) : plus aucun « non renseigné ».

## Au quotidien

| Pour… | Commande (sur le serveur) |
|---|---|
| Mettre le site à jour (dernière version du code) | `sudo bash /opt/albummania/deploy/oracle/install.sh` |
| Modifier un réglage | `sudo nano /etc/albummania/albummania.env` puis `sudo systemctl restart albummania` |
| Voir ce qui se passe | `sudo journalctl -u albummania -f` (Ctrl+C pour quitter) |
| Redémarrer le site | `sudo systemctl restart albummania` |

**Sauvegardes** : une copie de la base est faite chaque nuit dans `/var/backups/albummania` (14 jours gardés). Elles sont sur le même serveur : de temps en temps, rapatrie la plus récente sur ton ordinateur (depuis ton ordinateur, pas depuis le serveur) :

```sh
scp -i ~/Downloads/albummania.key "ubuntu@152.67.12.34:/var/backups/albummania/albummania-*.db.gz" .
```

## Passer plus tard sur un hébergeur payant

Tout le site vit dans `albummania.db`. Pour déménager (Render, un autre serveur…) :

1. Installe AlbumMania chez le nouvel hébergeur ([DEPLOIEMENT.md](DEPLOIEMENT.md)) avec les mêmes réglages.
2. Arrête l'ancien site (`sudo systemctl stop albummania`), fais une dernière sauvegarde (`sudo -u albummania /usr/local/sbin/albummania-backup`) et copie-la chez le nouvel hébergeur, décompressée, à l'emplacement de `DATABASE_FILE`.
3. Fais pointer l'adresse du site vers le nouvel hébergeur et mets à jour `APP_URL`.

Avec un vrai nom de domaine, les joueurs ne voient pas le changement.

## Limites de l'offre gratuite

- Oracle peut récupérer une machine gratuite jugée inactive sur 7 jours (processeur, réseau et mémoire sous 20 %) si le compte n'est pas passé en **Pay As You Go** (étape 1).
- C'est ton serveur : les mises à jour de sécurité d'Ubuntu s'installent toutes seules, mais pense à mettre le site à jour de temps en temps et à rapatrier une sauvegarde.
- Oracle bloque l'envoi d'e-mails par le port 25 : ce n'est pas un problème, Brevo passe par le port 587.
