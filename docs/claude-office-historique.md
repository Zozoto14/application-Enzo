# Historique de Claude Office

Chaque requête faite à Claude Code sur un appareil **équipé du hook d'historique** est notée dans un journal local,
même quand AppDashboard et Claude Office sont fermés. L'onglet « Historique » de la tuile Claude Office la relit.

## Conception retenue (en cinq lignes)

1. **Le hook écrit lui-même** : Claude Code lance `scripts/office-historique-hook.mjs` à chaque demande, outil,
   début/fin de session ou de réponse ; il ajoute une ligne JSON à `~/.agent-office/historique/AAAA-MM.jsonl`, sans
   serveur — c'est la seule façon d'enregistrer quand aucune application n'est ouverte.
2. **Append-only, tolérant aux crashs** : une ligne = un seul `write` en mode ajout (pas d'entremêlement entre
   sessions simultanées) ; une ligne coupée est ignorée et la suivante récupérée ; chaque entrée a un identifiant
   unique, l'ingestion déduplique et reprend où elle en était.
3. **Borné et discret** : rotation (`AAAA-MM.2.jsonl` au-delà de 10 Mo), 200 Mo au total (les plus anciens effacés),
   dossier 0700 et fichiers 0600, secrets masqués avant écriture, sorties d'outils **non** enregistrées par défaut.
4. **L'application lit, ne reçoit pas** : le processus principal d'Electron relit le journal (incrémental, toutes les
   5 s pendant que l'onglet Historique est ouvert, 2 s pour l'onglet Bureau via `claude-office:historique-activite`,
   en lecture seule, activité des 6 dernières heures sans contenu d'outil) ; la fenêtre n'a que sept canaux
   `claude-office:historique-*`, sans chemin libre.
5. **Copie chiffrée facultative** (désactivée par défaut) : un objet par PC dans l'espace `principal` du relais,
   scellé par la clé de synchronisation, au plus toutes les 15 min — **aucune modification du Worker**.

## Limites (à lire)

- **Seul un appareil équipé enregistre.** Le hook doit être installé dans les réglages de Claude Code de cet appareil
  (`npm run office:hooks`). Un appareil sans le hook — autre PC, session cloud, téléphone — n'enregistre **rien**.
- **PC éteint = rien.** Un PC éteint ne fait tourner ni Claude Code ni le hook : il n'y a rien à enregistrer. Ce qui
  est garanti : tant que Claude Code tourne sur un appareil équipé, chaque requête est écrite, AppDashboard ouvert ou
  non. La copie chiffrée sert à **relire** depuis un autre appareil quand le PC est éteint (dernier dépôt), pas à
  enregistrer.
- Le masquage des secrets se fait par motifs (clés `sk-ant-…`, `sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `AIza…`,
  `xox…-`, JWT, clés privées PEM, `Bearer …`, `mot_de_passe=…`, `--password …`, `https://u:mdp@…`, jetons et codes de
  liaison AppDashboard) : il peut en laisser passer. **L'historique contient ce que vous écrivez à Claude** ; l'écran
  le rappelle.
- Le journal est en clair sur le disque du PC (comme celui de Claude Office dans `~/.agent-office/history`), protégé
  par les droits du compte. Seule la copie du relais est chiffrée.
- Gemini CLI n'est pas concerné (Claude Code seulement).

## Où est quoi

| Fichier | Rôle |
| --- | --- |
| `bureau/electron/officeHistorique.mjs` | Journal : entrée, masquage, écriture, rotation, lecture incrémentale, import, suppression |
| `scripts/office-historique-hook.mjs` | Le hook lancé par Claude Code (rien sur la sortie standard, toujours code 0) |
| `bureau/electron/claudeOffice.mjs` | Plans d'installation (`planifierHistorique`, `enchainerPlans`) |
| `bureau/electron/claudeOfficeIpc.mjs` | Canaux `claude-office:historique-*` (confirmation native pour suppression et hook) |
| `src/claudeOffice/logiqueHistorique.ts` | Fusion, recherche, filtres, regroupement, compteurs, export JSON/CSV |
| `src/claudeOffice/Historique.tsx` | Onglet « Historique » |
| `src/claudeOffice/synchroHistorique.ts`, `synchroFond.ts` | Copie chiffrée sur le relais, présence rapide, dépôts en arrière-plan |

## Format d'une entrée

Une ligne JSON par événement, commençant toujours par `{"v":1,"id":"` :

```json
{"v":1,"id":"…uuid…","ts":"2026-10-07T09:00:00.000Z","type":"demande","source":"claude","appareil":"PC-BUREAU",
 "appareilId":"52e6f6322d1d","session":"…","dossier":"C:\\Users\\moi\\AppDashboard","projet":"AppDashboard",
 "texte":"Ajoute un export CSV"}
```

`type` : `demande`, `outil` (`outil`, `resume` court, `echec`), `debut-session`, `fin-session`, `fin-reponse`,
`fin-sous-agent`. Avec « Enregistrer aussi le contenu des outils », `entree`/`sortie` (2 000 caractères au plus).

Réglages : `~/.agent-office/historique/reglages.json` (`actif`, `enregistrerSorties`, `masquerSecrets`, `maxFichierMo`,
`maxTotalMo`, `appareil`, `appareilId`), modifiables dans l'écran. `OFFICE_HISTORIQUE_DIR` change le dossier.

## Installer le hook

Depuis le dossier d'AppDashboard sur le PC (Windows : `C:\Users\<vous>\...`, aucun chemin en dur) :

```bash
npm run office:hooks -- --a-blanc            # aperçu : Claude Office (si trouvé) + historique
npm run office:hooks                         # confirmation « oui », sauvegarde horodatée, écriture
npm run office:hooks -- --historique-seul    # seulement le hook d'historique
npm run office:hooks -- --sans-historique    # seulement les hooks de Claude Office
npm run office:hooks -- --desinstaller       # retire les deux (ou combiné avec --historique-seul)
```

Même garanties que pour Claude Office : aperçu exact, refus si `settings.json` a changé depuis l'aperçu ou n'est pas du
JSON, idempotent, les autres hooks ne sont jamais touchés, une seule sauvegarde et une seule écriture pour les deux. Le
hook d'historique n'a pas besoin du dossier de Claude Office. Dans l'écran (PC) : « Voir ce qui sera modifié »,
« Installer le hook… » (boîte de confirmation native). Puis **redémarrer Claude Code**.

## L'écran « Historique »

Liste par jour puis par session (les plus récentes d'abord), recherche plein texte (sans accents ni casse), filtres
(type, projet, appareil, outil, période), détail et « Copier », export JSON/CSV des entrées filtrées (CSV au
séparateur `;`, formules neutralisées), compteurs. Suppression d'une entrée, d'une période (filtre « du/au ») ou de
tout : confirmée dans l'écran, puis par une boîte native ; les lignes sont réellement retirées des fichiers (le
fichier est mis de côté par renommage, filtré, réécrit, puis effacé — le hook continue d'écrire pendant ce temps).

« Importer un journal… » : un fichier `.jsonl` copié depuis un autre appareil **équipé** (son
`~/.agent-office/historique/AAAA-MM.jsonl`) ; seules les entrées valides sont recopiées dans `importes/`, les doublons
sont ignorés à l'affichage.

## Copie chiffrée sur le relais (facultative)

- Réglage « Déposer la copie de ce PC », **désactivé par défaut**, propre à l'appareil ; « Dernier dépôt » affiché.
- Objet `office-historique-<appareilId>` de l'espace `principal` : le relais n'accepte sur cet espace que le jeton
  maître (compte principal). Contenu scellé par la clé de synchronisation (XChaCha20-Poly1305, l'appareil et la date
  liés au chiffré) : le relais ne voit que du bruit. Un ami, un gestionnaire ou un compte promu (jeton de profil)
  n'a aucun accès.
- Écritures KV : jamais une par requête. Au plus un dépôt toutes les 15 minutes (une minute pour « Synchroniser
  maintenant »), seulement si le contenu a changé, en **un seul objet par PC** qui remplace le précédent (5 000 entrées
  les plus récentes, 3 Mo au plus). Une suppression sur le PC se propage au dépôt suivant.
- Sur le site, le téléphone ou un autre PC (compte principal relié) : l'onglet lit et fusionne les copies de tous les
  PC équipés, en lecture seule. L'onglet « Bureau » s'en sert aussi (avec la présence rapide facultative, voir
  [`claude-office.md`](claude-office.md)).

## Droits

L'app `claude-office` reste réservée au Fondateur (tuile invisible pour administrateur, gestionnaire, ami) ; la copie
du relais est en plus réservée au compte principal (jeton maître). Tests : `src/claudeOffice/historique.test.tsx`,
`bureau/electron/officeHistorique.test.mjs`.
