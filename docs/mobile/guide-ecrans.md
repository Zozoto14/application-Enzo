# Guide : passer un écran en version téléphone (phase B)

La phase A a livré le socle (`src/ui/mobile/`, voir `design-system.md`), la coque de navigation, les écrans
d'entrée, le hub, les Paramètres et le Support. La phase B applique la même méthode aux apps
**Portefeuille**, **Administration** et **Tsuzuku**. Les défauts à corriger, écran par écran, sont dans
`audit.md` et `captures-avant/` (captures 23 à 59).

Ce qui est **déjà en place** pour ces apps, sans rien faire :

- **Portefeuille** : `CoqueTelephone` (`src/ui/Navigation.tsx`) remplace la barre latérale et le bandeau
  de 17 onglets : en-tête « ‹ Accueil » + titre, barre basse Portefeuille · Opération · Recherche ·
  Watchlist · Plus (destinations marquées `principale` dans `App.tsx`) ; le reste est dans « Plus ».
- **Administration**, **Tsuzuku** : `RetourHub` rend un en-tête compact (« ‹ Accueil », nom de l'app,
  synchro condensée, Réglages).
- `Bouton`, `Titre`, `SousTitre`, `Champ` (`src/ui/composants.tsx`) et `BoutonHub` passent à 48/44 px et
  15–17 px en mode téléphone.

Ce qui **reste** : le contenu de chaque écran (tableaux, formulaires, graphiques, listes, dialogues).

## 1. Méthode, pour chaque écran

1. **Lire la capture « avant »** et la ligne de `captures-avant/mesures.json` de l'écran.
2. **Aiguiller** : si la mise en page change vraiment, créer `XxxMobile.tsx` et faire de l'export
   existant une aiguille (`useMobile() ? <XxxMobile/> : <XxxBureau/>`). La logique (calculs, états
   métier) reste partagée ; seules les vues diffèrent. Pour un simple ajustement (taille, retour à la
   ligne), `useMobile()` dans les styles suffit — mais jamais de hook conditionnel.
3. **Composer** avec les composants du socle (tableau ci-dessous), jamais avec des tailles en dur.
4. **Ajouter l'écran** au parcours de `scripts/e2e-mobile.mjs` (fonction `controler`) et une capture.
5. **Vérifier le bureau** : test existant inchangé, capture desktop identique.

## 2. Quel composant pour quoi

| Sur le bureau | Sur téléphone |
| --- | --- |
| Tableau à colonnes (positions, utilisateurs, journal) | `GroupeCellules` + `Cellule` : titre = nom, sous-titre = 1–2 infos clés, `valeur` = chiffre principal à droite, `chevron` vers une fiche détaillée |
| Barre d'onglets en haut | sections principales dans la barre basse (`principale`), le reste dans « Plus » ; à l'intérieur d'un écran : segments égaux de 44 px (3–4 au plus) |
| Modale centrée, confirmation, menu déroulant | `FeuilleBasse` (`pied` = action principale) |
| Liste déroulante (`select`) | `Cellule` avec `valeur` → `FeuilleBasse` de cellules à `coche` |
| Case à cocher, interrupteur | `Cellule` avec `interrupteur` |
| Formulaire long | `EcranMobile` + `ChampMobile` (bonne `nature`) + `SectionRepliable` pour l'optionnel + `BoutonPrincipal` dans `pied` |
| Boutons d'action en ligne | une action principale (`BoutonPrincipal`) ; les autres en `Cellule` ou dans une feuille « … » |
| Titre + boutons en haut de page | `EnTeteMobile` (retour, titre, 1–2 `actions`) |
| Graphique | pleine largeur, hauteur fixe (200–240 px), légendes ≥ 15 px sous le graphique, valeur touchée affichée au-dessus |
| Raccourci clavier (Échap) | bouton visible + balayage retour (`onRetour` de `EcranMobile`) |
| Survol (info-bulle) | texte visible ou `Cellule` qui ouvre une feuille : le survol n'existe pas au doigt |

## 3. Exemples avant / après tirés du hub

### Support : une page de bureau → un écran de téléphone

Avant (bureau, rendu tel quel sur iPhone) : carte centrée, « ← Retour » de 34 px, catégories de 36 px,
champs à 15 px qui font zoomer Safari, aucune navigation basse (`captures-avant/21-support.jpg`).

Après (`src/hub/PageSupport.tsx`) :

```tsx
const mobile = useMobile();
if (mobile) {
  return (
    <View style={styles.racine} testID="hub-support">
      <EcranMobile theme={theme} onRetour={onFermer}
        entete={<EnTeteMobile theme={theme} titre="Support" onRetour={onFermer} libelleRetour="Accueil" testIDRetour="hub-support-fermer" />}>
        <FormulaireSupport … />            {/* ChampMobile, segments de 44 px, BoutonPrincipal */}
        <GroupeCellules theme={theme} titre="Mes tickets">…</GroupeCellules>
      </EcranMobile>
      <BarreBasseHub actif="support" />
    </View>
  );
}
```

Les `testID` restent les mêmes que sur le bureau : les tests existants et les E2E continuent de passer.

### Paramètres : une longue page à sommaire → liste puis sous-pages

Avant : toutes les sections déroulées l'une sous l'autre, sommaire latéral, recherche à 15 px
(`captures-avant/11-parametres.jpg`).

Après (`src/hub/PageParametres.tsx` aiguille vers `PageParametresMobile.tsx`) : une liste de
`Cellule` à `chevron` groupées (« Compte et appareil », « Apps », « Aide »), une recherche
`ChampMobile nature="recherche"`, chaque section dans sa sous-page `EcranMobile` avec « ‹ Réglages ».
Les réglages eux-mêmes sont **les mêmes composants** que sur le bureau (`rendu(id)`).

### Hub : glisser-déposer → boutons

Avant : personnalisation par glisser-déposer et petits boutons de 30 px (`captures-avant/09-hub-personnaliser.jpg`).
Après (`HubMobile.tsx`) : en mode édition, une liste où chaque app a ses boutons ▲ ▼ épingler masquer
taille de 44 px ; même logique (`personnalisation.ts`) que le bureau.

## 4. Plan de la phase B

| App | Écrans | Approche |
| --- | --- | --- |
| Portefeuille | tableau, onglets Résumé → Impôts, positions | onglets internes en segments défilants de 44 px ou cellules ; positions en cellules (nom, quantité · PRU, valeur et +/- à droite) → fiche |
| | saisie d'opération, import, objectifs, projection | `EcranMobile` + `ChampMobile nature="decimal"` + `BoutonPrincipal` collant |
| | recherche, screener, watchlist, comparateur, carnet, journal | liste de cellules, filtres dans une `FeuilleBasse` |
| | graphiques (performances, projection, exposition) | pleine largeur, légendes ≥ 15 px |
| Administration | tableau de bord, utilisateurs, applications, abonnements, sécurité, journal, réglages | sections dans une barre basse ou une liste de cellules ; une ligne d'utilisateur = cellule → fiche en sous-page ; actions dans une feuille ; retirer « Échap pour fermer » |
| Tsuzuku | accueil, catalogue, fiche, lecteur, bibliothèque | affiches en 2–3 colonnes, textes ≥ 15 px, commandes du lecteur ≥ 44 px, plein écran en paysage |

## 5. Checklist de recette mobile (à cocher pour chaque écran)

- [ ] 390 × 844 et 375 × 667 : aucun débordement horizontal.
- [ ] Toutes les zones tactiles ≥ 44 × 44 px (mesuré par `controler()` de `e2e-mobile.mjs`).
- [ ] Tous les textes ≥ 15 px (pastilles de compteur exemptées par `EXEMPTE_TEXTE`, rien d'autre).
- [ ] Champs ≥ 16 px, `nature` juste (clavier numérique, `one-time-code`, `new-password`…), `enterKeyHint`.
- [ ] Une seule action principale, en bas, sous le pouce ; elle reste visible clavier ouvert.
- [ ] Un seul défilement vertical ; pas de tableau à faire défiler en largeur.
- [ ] Retour possible par un bouton visible ET par le balayage depuis le bord gauche.
- [ ] Dialogues en feuilles basses ; Échap / retour Android les ferment.
- [ ] Encoche et barre d'accueil respectées (rien sous la Dynamic Island, rien sous la barre d'accueil).
- [ ] Captures relues dans Nuit, Ivoire et Terminal : contraste, alignements, aucun texte coupé.
- [ ] Rôles et états accessibles (VoiceOver : chaque pictogramme a un nom).
- [ ] Bureau inchangé : tests existants verts, E2E desktop verts, capture desktop identique.
- [ ] Essai sur un vrai iPhone (AltStore) et sur le site de secours ajouté à l'écran d'accueil.
