# Site AppDashboard : vitesse et stabilité (mesures avant / après)

Demande du Fondateur : « optimise encore un peu le site pour qu'il soit encore plus rapide car des fois il bug ».

## Comment c'est mesuré

`scripts/mesure-performance.mjs` sert le build de production **comme chez o2switch** (compression gzip, fichiers de
`assets/` gardés un an, `index.html` et `version.json` revalidés) et le parcourt dans Chromium **bridé comme un iPad
ou un PC moyen en 4G lente** : 1,6 Mb/s, 150 ms d'aller-retour, processeur 4 fois plus lent. Médiane de 3 tours.

```
npx vite build
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/mesure-performance.mjs              # bridé
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/mesure-performance.mjs --sans-bridage
```

Parcours : (1) première visite, cache vide, jusqu'à l'écran d'accueil ; (2) visite suivante (cache chaud) jusqu'à
l'écran de déverrouillage ; (3) déverrouillage jusqu'au hub ; (4) ouverture de Tâches 6 s après l'affichage du hub.
« bloque » : temps du fil principal au-delà de 50 ms par tâche longue (chargement compris).

## Résultats : chargement du site

| Mesure (4G lente, CPU x4) | Avant | Après | Gain |
| --- | --- | --- | --- |
| JavaScript téléchargé à la première visite (compressé) | 1 148 Ko | 644 Ko | -44 % |
| Première visite : écran d'accueil affiché (LCP) | 7,0 s | 4,3 s | -2,7 s |
| Fil principal bloqué au chargement | 655 ms | 353 ms | -46 % |
| Visite suivante : écran de déverrouillage | 0,71 s | 0,56 s | -21 % |
| Déverrouillage → hub | 1,61 s | 1,58 s | = (dérivation de la clé, voulue lente) |
| Ouverture de Tâches (6 s après le hub) | 0,33 s | 0,43 s | +0,1 s (code préchargé au repos) |

Sans bridage (PC rapide) : accueil 0,32 s → 0,26 s, déverrouillage 0,21 s → 0,11 s.

Fichier principal (avant compression) : **3,72 Mo → 1,54 Mo**, plus un fichier « socle » de 488 Ko (React,
react-native-web, cryptographie) qui ne change presque jamais et reste donc en cache d'un déploiement à l'autre.

## Ce qui a changé (site et app PC ; l'iPhone et les tests gardent les imports directs)

- **Chaque app du hub est chargée à la demande** (`src/hub/racinesDifferees.web.tsx`) : Tâches, Tsuzuku, Journal,
  Abonnements, Prospects, Claude Office, Administration. L'Esport l'était déjà, ainsi que ses gros modules (CM,
  Drive, tickets, événements, planning, transcription : jamais dans le fichier principal).
- **Écrans du Portefeuille** chargés à la demande (`src/ui/ecrans/differes.web.tsx`), ainsi que les cartes de
  Paramètres propres à une app, le Devblog et la page Support (`src/hub/reglagesDifferes.web.tsx`) et le
  générateur de QR code (`src/ui/ecrans/qrDiffere.web.tsx`).
- **Anglais de l'Esport à la demande** (`src/esport/i18n/anglais.web.ts`) : le dictionnaire anglais et la table de
  traduction des erreurs du serveur (≈ 260 Ko) ne sont téléchargés que pour un utilisateur en anglais ; au démarrage
  d'un appareil en anglais, le site les attend (4 s au plus) avant le premier affichage, rien ne change à l'écran.
- **Analyseur HTML de Tsuzuku** (htmlparser2, css-select, ≈ 170 Ko) sorti du démarrage : la synchro ne lisait que
  des constantes (`tsuzuku/moteur/languesVersion.ts`, `liensEpisodesPage.ts`, `tsuzuku/app/importSources.ts`).
- **Préchargement au repos** (`src/app/App.tsx`) : 4 s après l'affichage du hub, le code des apps permises est
  téléchargé une app après l'autre ; ouvrir une tuile reste immédiat. Un échec de préchargement (hors ligne) ne
  recharge jamais la page (`sansRechargement`, `src/ui/versionPerimee.ts`).
- **Import qui échoue retenté une fois** (`src/ui/differe.tsx`) avant d'afficher une erreur (Wi-Fi qui décroche
  sur iPad) ; « Réessayer » de l'écran d'erreur redemande vraiment le module.
- **Compression Apache** (`scripts/htaccess-o2switch.mjs`) : brotli si le module est présent, sinon gzip, pour
  HTML, JS, CSS, JSON, SVG et wasm (jamais les polices ni les images, déjà compressées), sous garde `mod_filter`
  (sans lui, Apache refuserait tout le .htaccess). Cache : `assets/` un an (noms à empreinte), `index.html`,
  `version.json` et configurations revalidés à chaque visite (inchangé).
- Polices : déjà en `font-display: swap`, découpées par alphabet (seul le latin est téléchargé) ; images : deux
  icônes de 3 et 7 Ko. Rien à gagner de ce côté.

## Ouverture de l'Esport et serveur endormi

« Des fois le site met du temps à charger » : le serveur n'est pas chargé (il ne consomme presque rien), mais
**Passenger arrête une app Node restée quelques minutes sans requête** ; le visiteur suivant attend alors son
redémarrage (Node, connexion à PostgreSQL, puis le relais pour valider le jeton), souvent plusieurs secondes.

| Ouverture de l'Esport (requêtes qui bloquent l'écran) | Avant | Après |
| --- | --- | --- |
| Lecture de `esport.json` (adresse du serveur) | à chaque ouverture | une fois par page |
| `POST /session` (le serveur Esport interroge le relais) | à l'ouverture | faite pendant l'affichage du hub |
| `GET /moi` | après la session | inutile : le profil vient avec la session (moins de 30 s) |
| Code de l'Esport (compte « Esport seulement ») | à l'ouverture | demandé dès l'affichage du hub |
| Serveur Esport / relais endormis | premier visiteur attend le réveil | réveillés par le cron toutes les 5 min |

- `src/esport/prechauffage.ts` : dès que le hub s'affiche pour un compte qui a l'Esport, la session est ouverte en
  arrière-plan (cela réveille aussi les deux serveurs s'ils dormaient). Une seule app permise : son code est
  téléchargé tout de suite au lieu d'attendre 4 s.
- `src/esport/client.ts` : `ouvrir()` reprend le profil joint à `POST /session` (le serveur y met exactement
  `GET /moi`), une seule fois et s'il a moins de 30 s ; `esport.json` n'est lu qu'une fois par page.
- `esport/serveur/cron.mjs` (`garderEveilles`) : à chaque passage du cron (5 min), `GET /sante` du serveur Esport et
  du relais. Un réveil de plus de 3 s (l'app dormait) est écrit dans `~/logs/esport-cron.log` :
  « serveur réveillé (démarrage à froid) : relais 4200 ms ».
- `esport/serveur/app.mjs` : réponses JSON compressées en gzip (comme le relais) ; jamais les flux temps réel ni
  les fichiers. Les listes (planning, CM, tickets) sont plusieurs fois plus légères en 4G.
- `bureau/index.html` : connexions ouvertes d'avance (`preconnect`) vers le relais et le serveur Esport.

Base de données : le Fondateur confirme que le serveur ne manque pas de ressources ; les tables listées (membres,
teams, cartes CM, tickets, notifications, événements, disponibilités) ont déjà leurs index sur les colonnes filtrées
(revue des migrations 0001 à 0068). Pas de nouvelle migration.

## « Des fois il bug » : ce qui a été vérifié ou corrigé

- **Après un déploiement** : les anciens fichiers de `assets/` restent 7 jours sur le serveur (`deployer.sh`), un
  morceau introuvable recharge la page une seule fois puis propose « Recharger » (déjà en place,
  `src/ui/versionPerimee.ts`, `scripts/e2e-chunks-perimes.mjs`). Ajout : un import raté est retenté avant.
- **Écran « Affichage impossible »** (GardeErreur par app, avec « Réessayer ») : l'erreur est maintenant
  **signalée au serveur Esport** (`src/ui/signalementErreurs.ts`) ; React ne la remonte à aucun écouteur global,
  elle était donc invisible. Elle apparaît dans les statistiques d'usage (erreurs JS) et dans
  `~/logs/esport.log` :
  `erreur client [empreinte] tablette team.agenda.planning : [Tâches] TypeError: …`.
  Message nettoyé (ni e-mail, ni adresse, ni jeton, ni compte), une même erreur au plus une fois par 10 minutes,
  30 lignes par minute au plus. Une erreur survenue avant l'ouverture de l'Esport est envoyée à son ouverture.
- Temps réel (SSE) : reconnexion déjà en attente exponentielle avec part au hasard (2 s → 5 min), plafond de 20
  connexions par minute, une seule connexion par navigateur (`src/esport/tempsReel/transport.ts`, testé) ; conflits
  de version (409) : bandeau, jamais de nouvel essai automatique ; relectures périodiques suspendues page masquée.

## Diagnostiquer la prochaine fois

1. **Le site est lent** : `npx vite build` puis `node scripts/mesure-performance.mjs` (avant / après une modification).
   Un nouvel `import` statique d'un gros écran depuis le hub (`src/app/App.tsx`, `src/hub/*`) remet son code dans le
   fichier principal : passer par les fichiers `…Differe(e)s.tsx` / `.web.tsx` ci-dessus.
2. **« Ça bugue »** : `tail -n 100 ~/logs/esport.log | grep "erreur client"` (Terminal de cPanel), ou la page
   Statistiques de l'Esport (erreurs JS, regroupées par empreinte).
3. **Premier chargement lent après une pause** : `grep "démarrage à froid" ~/logs/esport-cron.log`. S'il revient
   souvent, l'app s'endort entre deux passages du cron : passer la tâche cron à toutes les 3 minutes
   (`*/3 * * * *`, cPanel › Tâches cron), ou demander à o2switch un délai d'inactivité Passenger plus long.
4. **Un écran reste sur « Une nouvelle version est disponible »** : le déploiement n'a pas fini de copier
   `assets/` ; recharger après 5 minutes.
