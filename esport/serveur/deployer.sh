#!/bin/bash
# Déploiement « par pull » chez o2switch (aucun accès entrant depuis GitHub, aucun jeton API cPanel) :
# lancé par une tâche cron cPanel toutes les 5 minutes, il met à jour TOUT le dashboard :
#
#   1. le code (dépôt cloné par « Git Version Control » avec une deploy key en lecture seule) :
#      git fetch ; s'il y a du nouveau sur main : git reset --hard origin/main ;
#   2. les dépendances du serveur (esport/package.json : le paquet pg seulement), si elles ont changé ;
#   3. les migrations de la base PostgreSQL (Esport + table de la boîte du relais) ;
#   4. le redémarrage des deux apps Node (Passenger : touch tmp/restart.txt) ;
#   5. le site : branche deploiement-o2switch (construite par GitHub Actions), copiée dans public_html
#      (rsync --delete, en protégeant .htaccess, .well-known, cgi-bin, maj/… ; bloc .htaccess fusionné).
#
# Idempotent (rien à faire = rien de fait) et protégé contre deux exécutions simultanées (flock).
# Journal : ~/logs/esport-deploy.log. Tâche cron cPanel (une ligne) :
#   */5 * * * * /bin/bash /home/jayo8828/application-enzo/esport/serveur/deployer.sh >/dev/null 2>&1
#
# Options : --forcer (refait tout même sans nouveauté), --sans-git (code déjà à jour : bouton
# « Deploy HEAD Commit » de cPanel, voir .cpanel.yml), --sans-site, --sans-code.
# Réglages (variables, facultatives) : DEPOT, BRANCHE, BRANCHE_SITE, SITE_DIR, NODE_BIN, NPM_BIN, JOURNAL.

set -uo pipefail

DEPOT="${DEPOT:-$HOME/application-enzo}"
BRANCHE="${BRANCHE:-main}"
BRANCHE_SITE="${BRANCHE_SITE:-deploiement-o2switch}"
SITE_DIR="${SITE_DIR:-$HOME/public_html}"
JOURNAL="${JOURNAL:-$HOME/logs/esport-deploy.log}"
ETAT="$HOME/.appdashboard"
FORCER=0; SANS_GIT=0; SANS_SITE=0; SANS_CODE=0
for a in "$@"; do
  case "$a" in
    --forcer) FORCER=1 ;;
    --sans-git) SANS_GIT=1 ;;
    --sans-site) SANS_SITE=1 ;;
    --sans-code) SANS_CODE=1 ;;
    *) echo "Option inconnue : $a" >&2; exit 2 ;;
  esac
done

mkdir -p "$(dirname "$JOURNAL")" "$ETAT"
chmod 700 "$ETAT" 2>/dev/null || true
journal() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$JOURNAL"; }
echec() { journal "ÉCHEC : $*"; echo "ÉCHEC : $*" >&2; exit 1; }

# ---- Verrou : une seule exécution à la fois (le cron peut se chevaucher si npm est lent).
exec 9>"$ETAT/deployer.verrou"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || exit 0
fi

cd "$DEPOT" 2>/dev/null || echec "dossier du dépôt introuvable : $DEPOT (Git Version Control › Clone)."

# ---- Node : celui de l'app créée dans « Setup Node.js App » (environnement virtuel de cPanel).
trouver_node() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then echo "$NODE_BIN"; return; fi
  local n
  n=$(ls -1d "$HOME"/nodevenv/application-enzo/esport/*/bin/node 2>/dev/null | sort -V | tail -n1)
  if [ -n "$n" ] && [ -x "$n" ]; then echo "$n"; return; fi
  command -v node || true
}
NODE="$(trouver_node)"
[ -n "$NODE" ] || echec "Node introuvable : créez d'abord l'app Esport dans « Setup Node.js App » (Node 22)."
BIN_NODE="$(dirname "$NODE")"
NPM="${NPM_BIN:-$BIN_NODE/npm}"
export PATH="$BIN_NODE:$PATH"

# ---------------------------------------------------------------- 1. Code
CODE_CHANGE=0
if [ "$SANS_CODE" = 0 ]; then
  AVANT="$(git rev-parse HEAD 2>/dev/null || echo aucun)"
  if [ "$SANS_GIT" = 0 ]; then
    git fetch --quiet origin "+refs/heads/$BRANCHE:refs/remotes/origin/$BRANCHE" 2>>"$JOURNAL" || echec "git fetch $BRANCHE (deploy key, ~/.ssh/config : voir docs/o2switch.md)."
    APRES="$(git rev-parse "origin/$BRANCHE")"
    if [ "$AVANT" != "$APRES" ]; then
      git reset --quiet --hard "origin/$BRANCHE" || echec "git reset --hard origin/$BRANCHE"
      journal "code : $AVANT → $APRES"
    fi
  fi
  APRES="$(git rev-parse HEAD)"
  DEJA="$(cat "$ETAT/code-deploye" 2>/dev/null || echo aucun)"
  if [ "$DEJA" != "$APRES" ] || [ "$FORCER" = 1 ]; then CODE_CHANGE=1; fi

  if [ "$CODE_CHANGE" = 1 ]; then
    # 2. Dépendances du serveur (esport/package.json : pg). L'app Node de cPanel range node_modules dans son
    #    environnement virtuel (lien esport/node_modules) : « npm install » (et non « npm ci », qui effacerait ce lien).
    EMPREINTE="$(cat esport/package.json esport/package-lock.json 2>/dev/null | sha256sum | cut -d' ' -f1)"
    if [ "$FORCER" = 1 ] || [ "$EMPREINTE" != "$(cat "$ETAT/deps-empreinte" 2>/dev/null)" ] || [ ! -e esport/node_modules/pg/package.json ]; then
      journal "dépendances : npm install --omit=dev (esport)"
      ( cd esport && "$NPM" install --omit=dev --no-audit --no-fund >> "$JOURNAL" 2>&1 ) || echec "npm install (esport)"
      echo "$EMPREINTE" > "$ETAT/deps-empreinte"
    fi
    # 3. Migrations (idempotentes) : configuration lue dans ~/.appdashboard/esport.env.
    "$NODE" esport/serveur/migrer.mjs >> "$JOURNAL" 2>&1 || echec "migrations (voir le journal ; l'ancienne version reste en service)"
    # 4. Redémarrage des deux apps (Passenger relit le code au prochain appel).
    mkdir -p esport/tmp relais/tmp
    touch esport/tmp/restart.txt relais/tmp/restart.txt
    echo "$APRES" > "$ETAT/code-deploye"
    journal "serveurs Esport et relais redémarrés sur $(git log -1 --format='%h %s' | cut -c1-90)"
  fi
fi

# ---------------------------------------------------------------- 5. Site (public_html)
if [ "$SANS_SITE" = 0 ]; then
  if git fetch --quiet origin "+refs/heads/$BRANCHE_SITE:refs/remotes/origin/$BRANCHE_SITE" 2>/dev/null; then
    SITE="$(git rev-parse "origin/$BRANCHE_SITE")"
    if [ "$SITE" != "$(cat "$ETAT/site-deploye" 2>/dev/null)" ] || [ "$FORCER" = 1 ]; then
      [ -d "$SITE_DIR" ] || echec "dossier du site introuvable : $SITE_DIR"
      TMP="$(mktemp -d "$ETAT/site.XXXXXX")"
      trap 'rm -rf "$TMP"' EXIT
      git archive "origin/$BRANCHE_SITE" | tar -x -C "$TMP" || echec "lecture de la branche $BRANCHE_SITE"
      [ -f "$TMP/index.html" ] || echec "branche $BRANCHE_SITE sans index.html : rien n'est copié"
      # Première fois : sauvegarde de ce qu'il y avait dans public_html.
      if [ ! -f "$SITE_DIR/.appdashboard-site" ]; then
        mkdir -p "$HOME/sauvegardes"
        tar -czf "$HOME/sauvegardes/public_html-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$SITE_DIR" . 2>>"$JOURNAL" && journal "site : sauvegarde de public_html dans ~/sauvegardes"
      fi
      # Protégés (jamais effacés ni remplacés) : ce qu'o2switch/cPanel y met, le paquet de mise à jour iPhone,
      # et la liste personnelle ~/.appdashboard/site-garder.txt (un chemin par ligne, ex. /mon-dossier/).
      FILTRES=(--filter='P /.htaccess' --filter='P /.well-known/' --filter='P /cgi-bin/' --filter='P /.user.ini' --filter='P /php.ini'
        --filter='P /maj/' --filter='P /esport.appdashboard.fr/' --filter='P /relais.appdashboard.fr/' --filter='P /.appdashboard-site'
        --exclude='/htaccess-appdashboard.conf' --exclude='/.htaccess' --exclude='/LISEZMOI-deploiement.md')
      if [ -f "$ETAT/site-garder.txt" ]; then
        while IFS= read -r ligne; do [ -n "$ligne" ] && [ "${ligne#\#}" = "$ligne" ] && FILTRES+=(--filter="P $ligne"); done < "$ETAT/site-garder.txt"
      fi
      if command -v rsync >/dev/null 2>&1; then
        # --chmod : le dossier temporaire (mktemp) est en 700 ; sans cela, rsync recopie ce 700 sur
        # public_html et le serveur web répond 403 partout (Let's Encrypt compris).
        rsync -a --delete --chmod=D755,F644 "${FILTRES[@]}" "$TMP/" "$SITE_DIR/" >> "$JOURNAL" 2>&1 || echec "rsync vers $SITE_DIR"
      else
        journal "site : rsync absent, copie simple (les anciens fichiers ne sont pas effacés)"
        ( cd "$TMP" && tar -c --exclude=./htaccess-appdashboard.conf --exclude=./LISEZMOI-deploiement.md . ) | tar -x -C "$SITE_DIR" || echec "copie vers $SITE_DIR"
      fi
      if [ -f "$TMP/htaccess-appdashboard.conf" ]; then
        "$NODE" scripts/htaccess-o2switch.mjs fusionner "$TMP/htaccess-appdashboard.conf" "$SITE_DIR/.htaccess" >> "$JOURNAL" 2>&1 || echec "fusion du .htaccess"
      fi
      # public_html doit rester lisible par le serveur web. 755 et non 750 : cPanel met d'habitude
      # le groupe « nobody » (serveur web) sur public_html, mais une copie peut le remplacer par le
      # groupe de l'utilisateur, que celui-ci ne peut pas remettre ; avec 750, ce serait 403 partout.
      chmod 755 "$SITE_DIR" 2>/dev/null || true
      echo "$SITE" > "$SITE_DIR/.appdashboard-site"
      echo "$SITE" > "$ETAT/site-deploye"
      journal "site : public_html à jour ($(git log -1 --format='%h %s' "origin/$BRANCHE_SITE" | cut -c1-90))"
    fi
  fi
fi
exit 0
