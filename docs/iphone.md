# AppliBourse sur l'iPhone (et l'iPad)

Trois morceaux, qui se protègent l'un l'autre :

| | Ce que c'est | S'il tombe |
|---|---|---|
| **App iPhone** | L'application installée par AltStore, gratuite | Elle expire au bout de 7 jours sans renouvellement… |
| **Site de secours** | La même application dans Safari, sur l'écran d'accueil | …et le site prend le relais, avec les mêmes données |
| **Relais** | Une boîte aux lettres chiffrée sur Cloudflare (gratuit) | Chaque appareil garde tout ; la synchro reprend au retour |

**À savoir avant tout : une app expirée ne perd rien.** Elle refuse seulement
de s'ouvrir. Dès qu'AltStore la renouvelle, tout est là. Les données ne
disparaissent que si l'on **supprime** l'app : ne la supprimez jamais,
renouvelez-la.

---

## 1. Le relais et le site (sur le PC, une fois)

1. Créez un compte gratuit sur **dash.cloudflare.com** (un e-mail suffit, pas
   de carte bancaire).
2. Dans le dossier d'AppliBourse, ouvrez un terminal et lancez :

   ```
   npm run relais:deployer
   ```

   Le navigateur s'ouvre pour vous connecter à Cloudflare : acceptez. Le
   script crée la boîte aux lettres, installe le relais, publie le site, puis
   affiche leurs adresses. Si Cloudflare demande de choisir un
   sous-domaine « workers.dev », tapez un nom (par exemple votre pseudo).

   Relancer la commande ne recrée rien. Les identifiants restent sur le PC
   (`relais/relais-local.json`), jamais sur GitHub.

3. Ouvrez AppliBourse sur le PC › **Paramètres › Synchronisation entre
   appareils**. Le relais est reconnu tout seul. Choisissez un **mot de passe
   de synchronisation** (8 caractères minimum), notez-le dans Bitwarden, puis
   **Relier cet appareil**.

Ce mot de passe chiffre tout ce qui part sur internet. Il n'est enregistré
nulle part : il vous sera demandé une fois sur chaque appareil.

Ensuite, le site se remet à jour tout seul : à chaque mise à jour du PC,
l'application le republie en arrière-plan.

## 2. Le site de secours sur l'iPhone

1. Sur le PC : **Paramètres › Synchronisation › Relier un autre appareil**.
   Deux QR codes s'affichent.
2. Avec l'appareil photo de l'iPhone, scannez **« Site de secours »**. Safari
   s'ouvre.
3. Bouton **Partager** › **Sur l'écran d'accueil**. Ouvrez-le ensuite depuis
   l'icône, pas depuis Safari : c'est l'icône qui garde vos données.
4. Créez le mot de passe de l'application (comme sur le PC), puis
   **Paramètres › Synchronisation** : le relais est reconnu, tapez le mot de
   passe de synchronisation, **Relier**. Deux minutes plus tard, votre
   portefeuille est là. Sur un portefeuille vide, le bouton **Récupérer depuis
   mes autres appareils** mène au même endroit.

## 3. L'app iPhone par AltStore

### Sur le PC, une fois

1. Installez **iTunes** et **iCloud** depuis **le site d'Apple**, pas depuis le
   Microsoft Store (AltServer ne fonctionne pas avec ces versions-là).
2. Installez **AltServer** depuis **altstore.io**. Dans ses réglages, cochez le
   lancement au démarrage de Windows.
3. Branchez l'iPhone en USB. Dans iTunes, cochez **Synchroniser avec cet
   iPhone en Wi-Fi** (c'est ce qui permettra les renouvellements sans câble).
4. Icône AltServer près de l'horloge › **Install AltStore** › votre iPhone.
   Entrez votre identifiant Apple (il ne sert qu'à signer, chez Apple).
5. Sur l'iPhone :
   - **Réglages › Général › VPN et gestion de l'appareil** : faites confiance
     à votre identifiant Apple ;
   - **Réglages › Confidentialité et sécurité › Mode développeur** : activez,
     l'iPhone redémarre.

### Fabriquer l'app

1. Sur **github.com**, dans le dépôt AppliBourse : onglet **Actions** ›
   **App iPhone (AltStore)** › **Run workflow**.
2. Une vingtaine de minutes plus tard, ouvrez l'exécution terminée : en bas,
   rubrique **Artifacts**, téléchargez **AppliBourse-ipa** et dézippez-le.
   Vous obtenez `AppliBourse.ipa`.

### L'installer

- Icône AltServer › **Sideload .ipa…** (maintenez **Maj** en cliquant si
  l'option est cachée) › choisissez `AppliBourse.ipa` › votre iPhone.
- Ou bien : posez le fichier dans iCloud Drive, puis dans AltStore sur
  l'iPhone › **Mes apps** › **+**.

Puis ouvrez l'app, créez son mot de passe, et scannez le QR code
**« App iPhone »** affiché par le PC (ou recopiez le code qui commence par
`AB1.`). Mot de passe de synchronisation, **Relier** : c'est fait.

## 4. Au quotidien

- **Renouvellement** : AltStore renouvelle l'app tout seul quand l'iPhone est
  sur le même Wi-Fi que le PC allumé, avec AltServer lancé. Dans AltStore ›
  Réglages, laissez **Actualisation en arrière-plan** activée.
- **Rappels** : l'app vous prévient **2 jours avant**, **la veille** et **3
  heures avant** l'expiration, même fermée. Le PC l'affiche aussi dans
  Paramètres › Synchronisation (« iPhone : expire demain »).
- **Mises à jour** : les nouveautés ordinaires arrivent seules — l'app les
  télécharge depuis le site (au plus toutes les 6 heures) et les applique à
  l'ouverture suivante. Il faut une clé de signature sur le PC
  (`cle-maj-privee.txt`, déjà en place). Refaire l'étape « Fabriquer l'app »
  n'est utile que pour un changement du code natif : la page Actions se
  relance d'ailleurs seule dans ce cas.
- **Si l'app a expiré** (vacances…) : rien n'est perdu. Utilisez le site de
  secours en attendant ; de retour sur le Wi-Fi de la maison, ouvrez AltStore
  › **Tout actualiser**.

## Ce qui se synchronise

Comptes, valeurs, opérations (notes comprises), watchlist, carnet de thèses,
objectifs, répartition cible, frais des ETF, versement mensuel. Toutes les
deux minutes quand l'app est ouverte, et dès qu'on la quitte.

Restent propres à chaque appareil : le thème, les alertes et briefings, la
voix du podcast, l'historique des cours (il se recharge seul).

**Modifié sur deux appareils ?** La version la plus récente gagne partout.
**Supprimé ?** La suppression part aussi vers les autres, qui ne la
ressusciteront pas.

## Sécurité, en bref

- Tout est chiffré **sur l'appareil** (XChaCha20-Poly1305, clé tirée du mot de
  passe par Argon2id) avant d'aller sur le relais. Cloudflare ne voit ni
  montant, ni valeur, ni nom.
- Le relais exige un jeton tiré au hasard à l'installation ; sans lui,
  personne ne peut y déposer ni s'en servir pour joindre Yahoo.
- Le QR code contient l'adresse du relais et ce jeton, **pas** le mot de passe
  de synchronisation.
- L'app iPhone n'installe une mise à jour que si elle est signée par votre clé
  (`cle-maj-privee.txt`, sur le PC uniquement).
