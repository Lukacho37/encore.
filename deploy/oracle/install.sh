#!/usr/bin/env bash
# Installe ou met à jour AlbumMania sur un serveur Ubuntu (Oracle Cloud « Always Free », ou tout autre VPS Ubuntu).
# Guide pas à pas : HEBERGEMENT-GRATUIT.md à la racine du dépôt.
#
#   curl -fsSL https://raw.githubusercontent.com/Lukacho37/encore./claude/music-album-collection-game-d7i36d/deploy/oracle/install.sh -o install.sh
#   sudo bash install.sh
#
# Première fois : pose quelques questions (adresse du site, ton adresse d'admin, e-mails Brevo, mentions légales), puis
# installe Node.js 22, Caddy (HTTPS automatique), le service « albummania » (redémarre tout seul), la sauvegarde
# quotidienne de la base, les mises à jour de sécurité d'Ubuntu et, avec DuckDNS, la mise à jour de l'adresse IP.
# Fois suivantes (sudo bash /opt/albummania/deploy/oracle/install.sh) : récupère la dernière version du code, recompile
# et redémarre le site, sans rien redemander. Les réglages restent dans /etc/albummania/albummania.env.
#
# Variables facultatives : BRANCH (branche du dépôt à installer), REPO (adresse du dépôt).
set -euo pipefail

REPO=${REPO:-https://github.com/Lukacho37/encore.}
BRANCH=${BRANCH:-claude/music-album-collection-game-d7i36d}
APP_DIR=/opt/albummania
DATA_DIR=/var/lib/albummania
BACKUP_DIR=/var/backups/albummania
CONF_DIR=/etc/albummania
ENV_FILE=$CONF_DIR/albummania.env
APP_USER=albummania
PORT=3000

say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
# Question posée au clavier, même quand le script arrive par un tube.
ask() { local answer; read -r -p "$1 " answer </dev/tty; printf '%s' "$answer"; }
ask_secret() { local answer; read -r -s -p "$1 " answer </dev/tty; echo >/dev/tty; printf '%s' "$answer"; }
# Valeur entre guillemets pour un fichier EnvironmentFile de systemd (\ et " échappés).
quote() { local v=${1//\\/\\\\}; printf '"%s"' "${v//\"/\\\"}"; }
as_app() { sudo -u "$APP_USER" -H "$@"; }

[[ $EUID -eq 0 ]] || die "Lance le script avec sudo : sudo bash install.sh"
grep -qi ubuntu /etc/os-release || die "Ce script est prévu pour Ubuntu (22.04 ou 24.04)."
export DEBIAN_FRONTEND=noninteractive

# ---------- réglages (première fois seulement) ----------
first_run=false
if [[ ! -f $ENV_FILE ]]; then
  first_run=true
  say "Réglages du site (tu pourras les modifier plus tard : sudo nano $ENV_FILE)"
  domain=$(ask "Adresse du site, sans https:// (ex. albummania.duckdns.org) :")
  domain=${domain#https://}; domain=${domain#http://}; domain=${domain%%/*}
  [[ $domain == *.* ]] || die "Adresse invalide : $domain"
  duck_token=""
  if [[ $domain == *.duckdns.org ]]; then
    duck_token=$(ask_secret "Jeton (token) DuckDNS, affiché en haut de duckdns.org :")
    [[ -n $duck_token ]] || die "Le jeton DuckDNS est nécessaire pour une adresse en .duckdns.org."
  fi
  admin=$(ask "Ton adresse e-mail (toi seul seras admin ; crée ton compte AlbumMania avec elle) :")
  [[ $admin == *@*.* ]] || die "Adresse e-mail invalide."
  echo "E-mails avec Brevo (menu « SMTP et API → SMTP »). Laisse vide pour configurer plus tard."
  smtp_user=$(ask "  Identifiant SMTP (login) :")
  smtp_pass=""
  [[ -z $smtp_user ]] || smtp_pass=$(ask_secret "  Clé SMTP (rien ne s'affiche pendant la saisie) :")
  sender=$(ask "  Adresse d'expédition validée dans Brevo :")
  echo "Mentions légales (obligatoires en France). Laisse vide pour compléter plus tard."
  editor=$(ask "  Ton nom (éditeur et directeur de la publication) :")
  contact=$(ask "  Adresse e-mail de contact affichée sur le site :")

  mkdir -p "$CONF_DIR"
  {
    echo "# Réglages d'AlbumMania (voir DEPLOIEMENT.md). Après une modification : sudo systemctl restart albummania"
    echo "NODE_ENV=production"
    echo "PORT=$PORT"
    echo "APP_URL=$(quote "https://$domain")"
    echo "TRUST_PROXY=true"
    echo "DATABASE_FILE=$DATA_DIR/albummania.db"
    echo "ADMIN_EMAILS=$(quote "$admin")"
    echo
    echo "# E-mails (Brevo)"
    echo "SMTP_HOST=smtp-relay.brevo.com"
    echo "SMTP_PORT=587"
    echo "SMTP_USER=$(quote "$smtp_user")"
    echo "SMTP_PASS=$(quote "$smtp_pass")"
    echo "MAIL_FROM=$(quote "AlbumMania <${sender:-no-reply@$domain}>")"
    echo
    echo "# Mentions légales (/legal/mentions). Hébergeur : nom, adresse et téléphone indiqués dans les conditions d'Oracle."
    echo "LEGAL_EDITOR_NAME=$(quote "$editor")"
    echo "LEGAL_PUBLICATION_DIRECTOR=$(quote "$editor")"
    echo "LEGAL_EDITOR_EMAIL=$(quote "$contact")"
    echo "LEGAL_CONTACT_EMAIL=$(quote "$contact")"
    echo 'LEGAL_EDITOR_ADDRESS=""'
    echo 'LEGAL_HOST_NAME=""'
    echo 'LEGAL_HOST_ADDRESS=""'
    echo 'LEGAL_HOST_PHONE=""'
  } >"$ENV_FILE"
  if [[ -n $duck_token ]]; then
    # Mise à jour de l'adresse IP chez DuckDNS : le jeton reste lisible par root seulement.
    cat >/usr/local/sbin/albummania-duckdns <<EOF
#!/bin/sh
curl -fsS --max-time 20 "https://www.duckdns.org/update?domains=${domain%.duckdns.org}&token=$duck_token&ip=" >/dev/null
EOF
    chmod 700 /usr/local/sbin/albummania-duckdns
    echo "*/5 * * * * root /usr/local/sbin/albummania-duckdns" >/etc/cron.d/albummania-duckdns
  fi
fi
domain=$(sed -n 's/^APP_URL="https:\/\/\(.*\)"$/\1/p' "$ENV_FILE")
[[ -n $domain ]] || die "APP_URL introuvable dans $ENV_FILE"

# ---------- paquets ----------
say "Paquets système (quelques minutes la première fois)"
apt-get update -q
apt-get install -y -q ca-certificates curl git gnupg sqlite3 unattended-upgrades iptables-persistent netfilter-persistent >/dev/null
# Mises à jour de sécurité d'Ubuntu, installées toutes seules.
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' >/etc/apt/apt.conf.d/20auto-upgrades

if ! node -v 2>/dev/null | grep -q '^v2[2-9]'; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -q nodejs >/dev/null
fi

if ! command -v caddy >/dev/null; then
  say "Caddy (HTTPS automatique)"
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy >/dev/null
fi

# ---------- pare-feu de la machine ----------
# Les images Ubuntu d'Oracle refusent tout sauf SSH (iptables) : on ouvre le web (80, 443). Les « Security Lists » de la
# console Oracle doivent aussi les ouvrir (voir le guide).
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true

# ---------- code du site ----------
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chown "$APP_USER:" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chown root:"$APP_USER" "$ENV_FILE" && chmod 640 "$ENV_FILE"

say "Code d'AlbumMania (branche $BRANCH)"
if [[ -d $APP_DIR/.git ]]; then
  as_app git -C "$APP_DIR" fetch -q --depth 1 origin "$BRANCH"
  as_app git -C "$APP_DIR" reset -q --hard FETCH_HEAD
else
  as_app git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
say "Compilation du site"
(cd "$APP_DIR" && as_app npm ci --no-audit --no-fund --loglevel=error && as_app npm run build --silent >/dev/null)

# ---------- service ----------
cat >/etc/systemd/system/albummania.service <<EOF
[Unit]
Description=AlbumMania
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/caddy/Caddyfile <<EOF
# HTTPS automatique (Let's Encrypt) devant AlbumMania.
$domain {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF

# ---------- sauvegarde quotidienne ----------
cat >/usr/local/sbin/albummania-backup <<EOF
#!/bin/sh
# Copie cohérente de la base (même site ouvert), compressée ; garde 14 jours. Lancée par l'utilisateur du site, pour
# que les fichiers annexes de la base (-wal, -shm) lui appartiennent toujours.
set -e
f=$BACKUP_DIR/albummania-\$(date +%F).db
sqlite3 $DATA_DIR/albummania.db ".backup '\$f'"
gzip -f "\$f"
find $BACKUP_DIR -name 'albummania-*.db.gz' -mtime +13 -delete
EOF
chmod 755 /usr/local/sbin/albummania-backup
echo "30 5 * * * $APP_USER [ -f $DATA_DIR/albummania.db ] && /usr/local/sbin/albummania-backup" >/etc/cron.d/albummania-backup

# ---------- démarrage ----------
[[ -x /usr/local/sbin/albummania-duckdns ]] && /usr/local/sbin/albummania-duckdns || true
systemctl daemon-reload
systemctl enable -q albummania caddy
systemctl restart albummania
systemctl reload caddy 2>/dev/null || systemctl restart caddy

say "Démarrage du site"
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 || die "Le site ne répond pas. Journal : sudo journalctl -u albummania -n 50"

say "C'est en ligne : https://$domain"
if $first_run; then
  cat <<EOF
  - Le certificat HTTPS peut mettre une minute à arriver la première fois.
  - Le catalogue s'importe tout seul : environ 4 heures pour 20 000 albums ; on peut jouer pendant ce temps.
  - Crée ton compte avec l'adresse d'admin donnée plus haut, puis clique sur le lien reçu par e-mail.
EOF
fi
cat <<EOF
  Mettre à jour le site :  sudo bash $APP_DIR/deploy/oracle/install.sh
  Modifier les réglages :  sudo nano $ENV_FILE   puis   sudo systemctl restart albummania
  Voir le journal :        sudo journalctl -u albummania -f
  Sauvegardes :            $BACKUP_DIR (une par jour, 14 jours)
EOF
