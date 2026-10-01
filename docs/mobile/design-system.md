# Système de design du mode téléphone

Code : `src/ui/mobile/` (point d'entrée `index.ts`). Tests : `src/ui/mobile/mobile.test.tsx`.
Recette de bout en bout : `scripts/e2e-mobile.mjs`. Procédure pour les autres écrans : `guide-ecrans.md`.

## 1. Quand est-on « sur téléphone » ?

Une seule règle, dans `detection.ts` (`estTelephone`) :

- fenêtre de **moins de 768 px** de large (iPhone, site de secours sur téléphone, fenêtre de PC très étroite) ;
- **ou** app native (iOS/Android) tenue **en portrait**.

PC, tablette en paysage, fenêtre ≥ 768 px : **rien ne change**, l'affichage de bureau est rendu tel quel.

- Dans un composant : `useMobile()` (suit la rotation et le redimensionnement).
- Dans une petite fonction de style d'un contenu déjà aiguillé : `tt(taille)` / `ct(hauteur)` (`jetons.ts`).
- Tests : `jest.setup.js` force le mode « large » ; un test du téléphone appelle
  `forcerModeAffichage('telephone')` ou enveloppe dans `<ModeAffichageForce mode="telephone">`.

**Règle d'aiguillage** : un écran qui a deux mises en page ne branche jamais ses hooks sur `useMobile()`.
Il devient une aiguille :

```tsx
export function Hub(props: HubProps) {
  return useMobile() ? <HubMobile {...props} /> : <HubBureau {...props} />;
}
```

## 2. Jetons (`jetons.ts`)

Les couleurs, polices et rayons viennent du **thème unique du hub** (`ThemeHub`, 8 thèmes : Nuit, Ivoire,
Terminal…). Les jetons mobiles ne fixent que les mesures.

| Jeton | Valeurs |
| --- | --- |
| `ESPACE` | 4 · 8 · 12 · 16 · 20 · 24 · 32 (multiples de 4) |
| `GOUTTIERE` | 16 px de marge latérale |
| `TEXTE` | légende 15 · corps 17 · champ 17 · en-tête 17 · section 20 · titre 28 |
| `TEXTE_MIN` | **15 px**, jamais moins (seule exception : pastilles de compteur, marquées `EXEMPTE_TEXTE`) |
| `CONTROLE` | hauteur 48 · **cible 44** · en-tête 52 · barre basse 58 |
| `rayonControle(theme)` / `rayonCarte(theme)` | d'après le thème (Terminal : 0 ; Sauge : pilule) |
| `DUREE` | 160 / 240 ms, ramenées à 0 si « réduire les animations » |

## 3. Composants

| Composant | Rôle | Règles |
| --- | --- | --- |
| `EcranMobile` | gabarit d'écran : en-tête, **une** colonne qui défile, pied collant | un seul défilement vertical ; contenu ≤ 600 px centré ; clavier évité ; `onActualiser` = tirer pour actualiser ; `onRetour` = balayage depuis le bord gauche |
| `EnTeteMobile` | en-tête compact 52 px : « ‹ Retour », titre, 1–2 actions | une seule ligne, le titre se tronque ; zone de sécurité du haut incluse |
| `BoutonIcone` | bouton pictogramme 44 × 44 de l'en-tête | `libelle` obligatoire (lecteur d'écran) |
| `BarreOnglets` | barre basse, 3 à 5 entrées (`MAX_ONGLETS`) | onglet actif marqué par couleur **et** graisse ; pastille possible ; zone de sécurité du bas |
| `BarreBasseHub` / `FeuilleCompte` | barre basse du hub et sa feuille « Compte » | voir § 4 |
| `FeuilleBasse` | remplace modales, menus déroulants, confirmations | glisse du bas ; voile et poignée ferment ; Échap/retour Android ; ≤ 90 % de la hauteur ; `pied` pour l'action principale |
| `GroupeCellules` / `Cellule` | listes à la iOS : titre, sous-titre, glyphe, valeur, chevron, interrupteur, coche, danger | 48 px minimum, toute la ligne est cliquable |
| `SectionRepliable` | couper un long formulaire en blocs | en-tête 52 px, `expanded` annoncé, résumé quand fermée |
| `BoutonPrincipal` | bouton pleine largeur 48 px (`plein`, `discret`, `danger`, `enCours`) | **une** action principale par écran |
| `PiedCollant` | pied collé en bas (bouton principal + une action secondaire au plus) | au-dessus de la barre d'accueil et du clavier |
| `ChampMobile` | champ 48 px, texte 17 px, libellé au-dessus, aide/erreur dessous | `nature` règle le clavier (voir § 5) ; œil pour afficher un mot de passe |
| `ZoneSecurite` / `margesSecurite` | encoche, Dynamic Island, barre d'accueil | web : `env(safe-area-inset-*)` (`viewport-fit=cover`) ; natif : déjà géré par la racine |
| `useBalayageRetour` | balayage depuis le bord gauche (24 px, 80 px de course) = retour | double toujours un bouton visible ; ne capture jamais un toucher ordinaire |

## 4. Navigation retenue

**Hub** — barre basse à 4 entrées, sur toutes les pages de premier niveau (hub, Paramètres, Support) :

```
⌂ Accueil   ·   ? Support   ·   ⚙ Réglages   ·   ◉ Compte
```

« Compte » ouvre une feuille basse : compte ouvert, synchronisation détaillée (« Synchroniser
maintenant »), « Changer de compte », « Recharger l'app » (site), « Verrouiller ». Sa pastille prend la
couleur de la synchro (orange : en attente, rouge : erreur).

**Apps** (Portefeuille, Administration, Tsuzuku) — coque commune `CoqueTelephone` (`src/ui/Navigation.tsx`) :
en-tête « ‹ Accueil » + titre de la section + synchro condensée + Réglages ; barre basse de **4 sections
principales** (`Destination.principale`, libellé court `libelleCourt`) + « Plus » (feuille basse : autres
sections, mode discret, verrouillage).

**Sous-pages** : « ‹ Parent » dans l'en-tête, balayage depuis le bord gauche, Échap au clavier.

## 5. Claviers et saisie (`ChampMobile`, `nature`)

| `nature` | Clavier / remplissage |
| --- | --- |
| `prenom` | `given-name`, majuscule aux mots |
| `identifiant` | `username` |
| `motDePasse` | `current-password` (trousseau iCloud) |
| `nouveauMotDePasse` | `new-password` (mot de passe proposé par iOS) |
| `codeTotp` | pavé numérique, `one-time-code` (code de Messages), 6 chiffres, touche « Aller » |
| `codeLiaison` / `codeRecuperation` | sans correction ni majuscule automatique |
| `recherche` | `inputmode=search`, touche « Rechercher » |
| `email`, `url`, `nombre`, `decimal`, `multiligne` | le clavier correspondant |

Toujours : police ≥ 16 px (sinon Safari zoome), `enterKeyHint` (`next` entre les champs, `go`/`done` sur le
dernier).

## 6. Règles de recette (vérifiées par `scripts/e2e-mobile.mjs`)

- aucun débordement horizontal (page et blocs) ;
- tout élément interactif visible ≥ 44 × 44 px ;
- tout texte visible ≥ 15 px ;
- tout champ ≥ 16 px, avec `inputmode` / `autocomplete` / `enterkeyhint` adaptés ;
- zones de sécurité respectées ;
- états accessibles : rôles (`button`, `tab`, `checkbox`, `dialog`), état (`selected`, `checked`,
  `expanded`), noms accessibles des pictogrammes ;
- contraste et lisibilité vérifiés à l'œil sur les captures dans Nuit, Ivoire et Terminal
  (`captures-apres/`).
