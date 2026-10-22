#!/bin/bash
# Transcription des réunions SUR LE SERVEUR (o2switch) : installation, à lancer UNE FOIS dans le Terminal
# cPanel (et après un changement de modèle). Rien à compiler, aucun droit administrateur :
#
#   bash ~/application-enzo/esport/serveur/installer-transcription.sh
#
# Il installe le moteur (ONNX Runtime et ffmpeg, binaires précompilés, dans ~/esport-modeles/moteur),
# télécharge le modèle Whisper (« base » par défaut, environ 160 Mo), fait un court essai, puis affiche
# « Transcription serveur prête ». Le déploiement automatique (deployer.sh) ne touche jamais à
# ~/esport-modeles : le modèle n'est téléchargé qu'une fois.
#
# Options : --modele tiny|base|small   --threads 1|2   --dossier <chemin>   --forcer (tout refaire)
# Réglages lus dans ~/.appdashboard/esport.env : TRANSCRIPTION_MODELE, TRANSCRIPTION_THREADS,
# TRANSCRIPTION_DOSSIER_MODELES (voir docs/o2switch.md).

set -uo pipefail
DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Node : celui de l'app Esport de « Setup Node.js App » (comme deployer.sh), sinon celui du PATH.
trouver_node() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then echo "$NODE_BIN"; return; fi
  local n
  n=$(ls -1d "$HOME"/nodevenv/application-enzo/esport/*/bin/node 2>/dev/null | sort -V | tail -n1)
  if [ -n "$n" ] && [ -x "$n" ]; then echo "$n"; return; fi
  command -v node || true
}
NODE="$(trouver_node)"
if [ -z "$NODE" ]; then
  echo "Node introuvable : créez d'abord l'app Esport dans « Setup Node.js App » (Node 22)." >&2
  exit 1
fi
export PATH="$(dirname "$NODE"):$PATH"

# Priorité basse (le site reste rapide pendant l'installation et l'essai).
if command -v nice >/dev/null 2>&1; then
  exec nice -n 19 "$NODE" "$DEPOT/esport/serveur/transcription/installer.mjs" "$@"
fi
exec "$NODE" "$DEPOT/esport/serveur/transcription/installer.mjs" "$@"
