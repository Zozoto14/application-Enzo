#!/bin/bash
# Redémarre les deux apps Node (Esport et relais) chez o2switch. Appelé par deployer.sh après chaque déploiement du
# code ; utilisable aussi à la main, dans le Terminal de cPanel :
#
#   bash ~/application-enzo/esport/serveur/redemarrer-apps.sh            # les deux
#   bash ~/application-enzo/esport/serveur/redemarrer-apps.sh relais     # une seule
#
# Deux mécanismes, l'un après l'autre :
#   1. tmp/restart.txt touché (Passenger relit le code à la requête suivante) ; toujours fait ;
#   2. si la commande existe (CloudLinux, comme chez o2switch) : `cloudlinux-selector restart --json --interpreter
#      nodejs --app-root application-enzo/<app>`, le même redémarrage que le bouton « Restart » de Setup Node.js App
#      (restart.txt seul ne suffit pas toujours). Son résultat est noté au journal ; un échec n'arrête rien.
#
# Journal : JOURNAL (défaut ~/logs/esport-deploy.log). Réglages pour les tests : DEPOT, CLOUDLINUX_SELECTOR (chemin
# de la commande, « aucun » pour ne pas l'utiliser). Code de sortie : 0 (le redémarrage par restart.txt reste posé).

set -uo pipefail

DEPOT="${DEPOT:-$HOME/application-enzo}"
JOURNAL="${JOURNAL:-$HOME/logs/esport-deploy.log}"
mkdir -p "$(dirname "$JOURNAL")"
journal() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$JOURNAL"; }

APPS=("$@")
[ "${#APPS[@]}" -gt 0 ] || APPS=(esport relais)

if [ "${CLOUDLINUX_SELECTOR:-}" = aucun ]; then
  SELECTEUR=""
elif [ -n "${CLOUDLINUX_SELECTOR:-}" ]; then
  SELECTEUR="$CLOUDLINUX_SELECTOR"
else
  SELECTEUR="$(command -v cloudlinux-selector 2>/dev/null || true)"
  [ -n "$SELECTEUR" ] || { [ -x /usr/sbin/cloudlinux-selector ] && SELECTEUR=/usr/sbin/cloudlinux-selector; }
fi

# Racine de l'app telle que cPanel la connaît : relative au dossier personnel (application-enzo/relais).
racine_relative() {
  local chemin="$DEPOT/$1"
  case "$chemin" in
    "$HOME"/*) echo "${chemin#"$HOME"/}" ;;
    *) echo "$chemin" ;;
  esac
}

for app in "${APPS[@]}"; do
  case "$app" in
    esport|relais) ;;
    *) echo "App inconnue : $app (esport ou relais)" >&2; continue ;;
  esac
  mkdir -p "$DEPOT/$app/tmp"
  touch "$DEPOT/$app/tmp/restart.txt"
  if [ -n "$SELECTEUR" ] && [ -x "$SELECTEUR" ]; then
    RACINE="$(racine_relative "$app")"
    SORTIE="$("$SELECTEUR" restart --json --interpreter nodejs --app-root "$RACINE" 2>&1)"
    CODE=$?
    # Une ligne courte, sans retour à la ligne ; la sortie de la commande ne contient aucun secret.
    RESUME="$(printf '%s' "$SORTIE" | tr '\n\r' '  ' | cut -c1-200)"
    if [ "$CODE" -eq 0 ] && printf '%s' "$SORTIE" | grep -Eq '"result" *: *"success"'; then
      journal "redémarrage $app : fait (cloudlinux-selector, $RACINE)"
    else
      journal "redémarrage $app : cloudlinux-selector a échoué (code $CODE : $RESUME) ; restart.txt posé, sinon bouton Restart de Setup Node.js App"
    fi
  else
    journal "redémarrage $app : restart.txt posé (cloudlinux-selector absent)"
  fi
done
exit 0
