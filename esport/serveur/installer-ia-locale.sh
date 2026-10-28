#!/bin/bash
# IA LOCALE du serveur Esport (o2switch) : installation, à lancer dans le Terminal cPanel (une fois, puis
# après un changement de modèle). Aucun droit administrateur, aucune carte graphique :
#
#   bash ~/application-enzo/esport/serveur/installer-ia-locale.sh            # Qwen2.5-7B (≈ 4,7 Go)
#   bash ~/application-enzo/esport/serveur/installer-ia-locale.sh --petit    # Qwen3-4B (≈ 2,5 Go, 2x plus rapide)
#   bash ~/application-enzo/esport/serveur/installer-ia-locale.sh --test     # banc d'essai + recommandation
#   bash ~/application-enzo/esport/serveur/installer-ia-locale.sh --dry-run  # montre le plan, ne fait rien
#   bash ~/application-enzo/esport/serveur/installer-ia-locale.sh --diagnostic  # moteur seul : tué par nous ou par l'extérieur ?
#
# Il installe le moteur llama.cpp (version figée, SHA-256 / commit vérifiés : archive officielle si la
# glibc le permet, sinon compilation sans root avec un GCC récent), télécharge le modèle GGUF avec reprise
# et vérification SHA-256, puis affiche les lignes à mettre dans ~/.appdashboard/esport.env.
# Tout va dans ~/.appdashboard/ia-locale (hors du dépôt, hors de public_html) ; deployer.sh n'y touche pas.
# Idempotent : relancer ne refait que ce qui manque (--forcer pour tout refaire).
#
# Autres options : --threads N, --modele qwen2.5-7b|qwen3-4b, --dossier <chemin absolu>,
# --revision <commit Hugging Face>, --route auto|officiel|compilation, --aide.
# Désinstallation : rm -rf ~/.appdashboard/ia-locale (voir docs/esport/ia-locale.md).

set -uo pipefail
DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Node : celui de l'app Esport de « Setup Node.js App » (comme deployer.sh), sinon celui du PATH.
trouver_node() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then echo "$NODE_BIN"; return; fi
  local n
  n=$(printf '%s\n' "$HOME"/nodevenv/application-enzo/esport/*/bin/node | sort -V | tail -n1)
  if [ -n "$n" ] && [ -x "$n" ]; then echo "$n"; return; fi
  command -v node || true
}
NODE="$(trouver_node)"
if [ -z "$NODE" ]; then
  echo "Node introuvable : créez d'abord l'app Esport dans « Setup Node.js App » (Node 22)." >&2
  exit 1
fi
PATH="$(dirname "$NODE"):$PATH"
export PATH

INSTALLEUR="$DEPOT/esport/serveur/ia-locale/installer.mjs"
if [ ! -f "$INSTALLEUR" ]; then
  echo "Fichier introuvable : $INSTALLEUR (dépôt incomplet ?)" >&2
  exit 1
fi

# Priorité la plus basse : le site reste rapide pendant les téléchargements, la compilation et l'essai.
if command -v nice >/dev/null 2>&1; then
  exec nice -n 19 "$NODE" "$INSTALLEUR" "$@"
fi
exec "$NODE" "$INSTALLEUR" "$@"
