/**
 * Page d'aide courte « Comment bien configurer une source » (page Sources) :
 * modèles d'adresse ({query}/{q}, {slug}, {n}), API JSON, POST, pagination,
 * limites (pages construites en JavaScript, protections anti-robot, miroirs)
 * et diagnostic à copier. Exemples sur des sites FICTIFS uniquement.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { useTsuzuku } from './contexte';
import { Bouton, styleAttenue, styleTexte } from './ui';

/** Sections de l'aide (titre, texte, exemple facultatif) : données pures, testées. */
export const SECTIONS_AIDE_CONFIGURATION: ReadonlyArray<{ titre: string; texte: string; exemple?: string }> = [
  {
    titre: '1. Trouver la bonne page de recherche',
    texte: 'Cherchez un titre sur le site, puis copiez l’adresse de la page de résultats. Remplacez le titre par {query} (ou {q}) : c’est le modèle de recherche (search.path). Préférez l’adresse de la page de RÉSULTATS à celle de l’accueil quand vous lancez l’assistant.',
    exemple: '"path": "/recherche?q={query}"   ou   "path": "/?s={q}"   ou   "path": "/search/{query}"',
  },
  {
    titre: '2. Le site n’a pas de recherche lisible : {slug}',
    texte: 'Si chaque oeuvre a une adresse prévisible (titre en minuscules, sans accents, mots séparés par des tirets), utilisez {slug} : l’app ouvre directement la page de l’oeuvre et essaie aussi les variantes « -2 », « -saison-2 », « -vostfr », « -vf ». Une page absente (404) compte comme « pas de résultat ».',
    exemple: '"path": "/anime/{slug}"   →   « Frieren: Beyond Journey’s End » donne /anime/frieren-beyond-journeys-end',
  },
  {
    titre: '3. Résultats chargés en JavaScript : l’API JSON',
    texte: 'Si le diagnostic dit « page construite en JavaScript (SPA) », le HTML reçu est vide : les résultats arrivent par une API. Ouvrez l’onglet Réseau des outils du navigateur pendant une recherche, repérez l’appel qui renvoie du JSON, et décrivez-le : "type": "json", item = chemin de la liste, title / link = chemins relatifs à un élément. Si l’API ne donne qu’un identifiant, linkFormat fabrique le lien.',
    exemple: '"search": { "path": "/api/recherche?terme={query}", "type": "json", "item": "data.resultats", "title": "titre", "link": "slug", "linkFormat": "/anime/{value}" }',
  },
  {
    titre: '4. Recherche en POST (point d’entrée AJAX)',
    texte: 'Certains sites envoient la recherche en POST (formulaire). Indiquez "method": "POST" et le corps encodé avec {query}. Si la réponse est du JSON qui contient du HTML, htmlPath désigne ce fragment et les sélecteurs CSS s’y appliquent (sinon, l’app le repère seule).',
    exemple: '"search": { "path": "/ajax/recherche", "method": "POST", "body": "action=recherche&terme={query}", "htmlPath": "data.html", "item": "li.resultat", "title": "a", "link": "a" }',
  },
  {
    titre: '5. Épisodes : sélecteurs, pages et saisons',
    texte: 'episodes.item désigne UN épisode. Sans sélecteur (ou s’il ne trouve rien), l’app repère les liens « Épisode N », « EP N », « E01 », « S2E03 », « 第N話 » ou finissant par un numéro, y compris dans les blocs masqués et les menus. Une liste paginée est suivie (rel=next, « Suivant », ou episodes.next) ; si la page mêle plusieurs saisons, celle de la fiche est gardée. Numéro : episodes.number (facultatif) désigne l’élément qui le porte ; l’app y lit « Épisode 03 », « Ep. 1 VF », « S1 E2 » ou le dernier nombre (« Titre 2 - 03 VOSTFR » → 3), en ignorant dates, années, durées, saison et titre de la série. Sans numéro lisible, la liste est numérotée par son ordre (du plus récent au plus ancien). Le diagnostic montre, pour chaque lien, le numéro lu et son texte : un épisode « absent » s’y vérifie d’un coup d’oeil.',
    exemple: '"episodes": { "item": "ul.episodes li", "number": ".num", "link": "a", "next": "a.page-suivante" }',
  },
  {
    titre: '6. VF et VOSTFR',
    texte: 'Tsuzuku lit la langue de chaque fiche et de chaque épisode : « (VF) », « VOSTFR », « Dub », « Sub » dans le titre ou le lien, -vf / -vostfr dans l’adresse, onglets ou sections « VF » / « VOSTFR », attributs data-lang. Deux fiches « Titre » et « Titre (VF) » deviennent les deux langues d’une même série (la fiche sans marqueur est alors présumée VOSTFR, et affichée comme telle). Si le site sépare les langues par deux recherches, renseignez search.pathVf / search.pathVostfr ; s’il n’en propose qu’une, réglez la langue de la source (« language »). Si rien n’indique la langue, le lecteur affiche « Langue inconnue » plutôt que de deviner.',
    exemple: '"language": "vostfr",  "search": { "path": "/recherche?q={query}", "pathVf": "/vf/recherche?q={query}", … }',
  },  {
    titre: '7. Liens manuels : {n}',
    texte: 'Pour un seul titre, le lien manuel de la fiche accepte {n} (numéro d’épisode) : collez l’adresse de l’épisode 1 en remplaçant le numéro par {n}.',
    exemple: 'https://mediatheque-exemple.fr/serie/voyage/episode-{n}',
  },
  {
    titre: '8. Ce qui ne dépend pas de l’app',
    texte: 'Protection anti-robot (« Just a moment… », captcha, 403/503) : Tsuzuku ne la contourne pas et l’affiche comme telle. Miroirs : si le site change d’adresse, mettez à jour baseUrl (les redirections et les « meta refresh » sont suivis). Page construite en JavaScript sans API accessible : la source ne peut pas être lue.',
  },
  {
    titre: '9. Ça ne trouve toujours pas ?',
    texte: 'Sur la fiche : « Tester une source sur ce titre », puis « Détail du diagnostic » › « Copier le diagnostic ». Le texte copié dit, pour chaque requête : adresse, statut HTTP, type de contenu, taille, page JavaScript / anti-robot / JSON, candidats trouvés et leurs scores. Il ne contient ni clé d’API ni secret.',
  },
];

export function AideConfiguration({ onFermer }: { onFermer(): void }) {
  const { theme } = useTsuzuku();
  return (
    <View testID="sources-aide-config" accessibilityLabel="Comment bien configurer une source" style={{ gap: 12, padding: 14, borderRadius: theme.rayonMoyen, borderWidth: 1, borderColor: theme.ligne, backgroundColor: theme.surface }}>
      <Text accessibilityRole="header" style={[styleTexte(theme, 16), { fontWeight: '800' }]}>
        Comment bien configurer une source
      </Text>
      {SECTIONS_AIDE_CONFIGURATION.map(sec => (
        <View key={sec.titre} style={{ gap: 4 }}>
          <Text style={[styleTexte(theme, 14), { fontWeight: '800' }]}>{sec.titre}</Text>
          <Text style={[styleAttenue(theme, 14), { lineHeight: 20 }]}>{sec.texte}</Text>
          {sec.exemple ? (
            <Text selectable style={[styleTexte(theme, 12), { fontFamily: 'monospace', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: theme.ligne }]}>
              {sec.exemple}
            </Text>
          ) : null}
        </View>
      ))}
      <Bouton titre="Fermer" onPress={onFermer} testID="sources-aide-config-fermer" style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}
