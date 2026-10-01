# Audit de l'affichage téléphone (avant refonte)

Fait le 2026-09-30 en émulation d'iPhone (390 × 844, densité 3, tactile, Safari mobile simulé), sur le
site de secours compilé (`npx vite build`), avec un vrai relais local. Script : `scripts/audit-mobile.mjs`
(outils communs : `scripts/mobile-outils.mjs`). Résultats bruts : `captures-avant/mesures.json`, une
capture par écran dans `captures-avant/` (61 écrans), captures de référence du bureau dans
`captures-bureau-avant/`.

Mesures prises par code sur chaque écran :

- débordement horizontal de la page et des blocs ;
- éléments interactifs visibles plus petits que 44 × 44 px (règle Apple) ;
- textes visibles sous 15 px ;
- champs : police < 16 px (Safari zoome la page au focus), `inputmode`, `autocomplete`, `enterkeyhint` ;
- prise en compte des zones de sécurité (encoche, barre d'accueil).

## Constat général

L'application n'avait **pas d'affichage téléphone** : c'était l'affichage du PC rétréci. Personne ne la
trouvait « ni esthétique ni pratique » sur téléphone, et les chiffres le confirment.

| Défaut | Ampleur |
| --- | --- |
| Zones tactiles < 44 px | sur **59 écrans sur 61** ; 1 238 éléments au total (34 sur 37 dans la personnalisation du hub, 48 sur 49 dans le tableau du Portefeuille) |
| Textes < 15 px | sur **tous** les écrans (11 à 14 px partout, 10,5 px dans les tuiles du hub) |
| Champs qui font zoomer Safari (< 16 px) | recherche des Paramètres, Support, Portefeuille, Administration, Tsuzuku |
| Champs sans le bon clavier | code TOTP sans clavier numérique ni `one-time-code`, mots de passe sans `new-password` à la création, aucun `enterkeyhint` |
| Zones de sécurité ignorées | sur tous les écrans (contenu sous l'encoche et la barre d'accueil en PWA plein écran) |
| Débordement horizontal | barre du haut du hub (synchro + Personnaliser + mise à jour + réglages + support + verrou sur une ligne) |
| Navigation | aucune barre basse : tout est en haut, hors de portée du pouce ; le Portefeuille affiche un bandeau de 17 onglets qui défile horizontalement |
| Dialogues | fenêtres centrées de bureau, boutons de 34 px, texte de 13 px |

## Par écran (phase A)

| Écran | Défauts majeurs relevés |
| --- | --- |
| Accueil du site | bouton principal au milieu de la page, textes de 13–14 px |
| Premier lancement | 7 cibles sur 9 trop petites, champs de 40 px, liens juridiques de 14 px de haut, aucun `enterkeyhint`, textes de 12 px |
| Acceptation légale | case à cocher de 22 px, « Continuer » perdu en bas d'un long texte |
| Document légal | texte de 13 px sur toute la page, bouton « Fermer » de 34 px |
| Hub | en-tête qui déborde, tuiles en une colonne trop hautes, infos des tuiles à 10,5–11 px, bouton Personnaliser de 34 px |
| Personnalisation du hub | glisser-déposer impossible à deviner au doigt, 34 contrôles sur 37 sous 44 px, menu des thèmes en liste déroulante de bureau |
| Paramètres | toutes les sections déroulées sur une seule page (sommaire latéral de bureau), recherche à 15 px (zoom), segments de 30 px de haut, 108 textes trop petits dans la section Administration |
| Support | catégories de 36 px, sujet et message à 15 px (zoom iOS), bouton « ← Retour » de 34 px |
| Déverrouillage | champ code sans clavier numérique, aide à 12 px, liens de 14 px de haut |
| Mot de passe oublié | mêmes défauts que le déverrouillage, 3 champs mal typés |

## Hors phase A (pour la phase B)

| App | Défauts majeurs relevés |
| --- | --- |
| Portefeuille | 17 onglets en bandeau défilant, tableaux larges (positions, dividendes, impôts) lisibles seulement en zoomant, formulaires de saisie à 13 px, graphiques aux légendes de 10–11 px |
| Administration | tableaux d'utilisateurs en colonnes serrées, actions de ligne de 30 px, mention « ÉCHAP POUR FERMER » de 11 px inutile au doigt |
| Tsuzuku | 33 textes de 11 px sur l'accueil, contrôles du lecteur de 34 px, fiche dense |

Les écrans de la phase B ont déjà, sans refonte de leur contenu, la coque téléphone commune : en-tête
compact « ‹ Accueil », barre basse de 4 sections + « Plus » (feuille basse), synchro condensée. Le reste
est décrit dans `guide-ecrans.md`.

## Après la phase A

`scripts/e2e-mobile.mjs` (émulation d'iPhone, tactile) repasse les mêmes mesures sur les écrans refaits
— accueil du site, premier lancement, acceptation légale, hub, personnalisation, Paramètres et leurs
sous-pages, Support, feuille Compte, déverrouillage, hub à 375 × 667 — : **0** débordement, **0** cible
sous 44 px, **0** texte sous 15 px, **0** champ sous 16 px ; code TOTP en `numeric` / `one-time-code`,
mots de passe de création en `new-password`. Captures dans `captures-apres/` (Nuit, Ivoire, Terminal).

Bureau : `scripts/captures-bureau.mjs` compare pixel à pixel hub, Paramètres et Portefeuille à 1280 × 800
avec les captures prises avant la refonte (`captures-bureau-avant/` → `captures-bureau-apres/`) :
identiques.
