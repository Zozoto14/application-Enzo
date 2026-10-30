#!/bin/bash
# Transcription des réunions SUR LE SERVEUR (o2switch) : installation, à lancer dans le Terminal cPanel (une
# fois, puis après un changement de modèle). Aucun droit administrateur, aucune carte graphique :
#
#   bash ~/application-enzo/esport/serveur/installer-transcription.sh            # ONNX Runtime + large-v3-turbo (Équilibrée)
#   bash ~/application-enzo/esport/serveur/installer-transcription.sh --tous     # + small (Rapide) et large-v3 (Maximale), ≈ 3,2 Go
#   bash ~/application-enzo/esport/serveur/installer-transcription.sh --test     # essai DANS Node : × temps réel, mémoire
#   bash ~/application-enzo/esport/serveur/installer-transcription.sh --dry-run  # montre le plan, ne fait rien
#
# Le calcul se fait DANS le processus Node (ONNX Runtime) : l'hébergeur arrête de force les binaires de calcul
# externes (whisper.cpp, llama-server : SIGKILL) mais pas `node`. Il installe ONNX Runtime et ffmpeg (paquets npm,
# versions figées), puis les modèles Whisper ONNX int8 (exports sherpa-onnx, SHA-256 publiés par Hugging Face
# vérifiés), et affiche « Transcription serveur prête ». Tout va dans ~/esport-modeles (hors du dépôt, hors de
# public_html) ; deployer.sh n'y touche jamais : rien n'est retéléchargé.
#
# Autres options : --modele <nom>, --threads N, --forcer, --whispercpp (option : whisper.cpp compilé, binaire
# externe), --route auto|systeme|compilation, --revision <commit>, --dossier <chemin>, --sans-redemarrage, --aide.
# Réglages : docs/esport/transcription.md.

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
