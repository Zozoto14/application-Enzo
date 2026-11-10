/**
 * Messages d'erreur de l'API Esport. Le serveur répond avec un `code` stable et un message écrit en
 * français ; en anglais l'app traduit ce message avec la table partagée `esport/noyau/erreurs.json`
 * (la même que celle du bot Discord) : phrase exacte d'abord, puis motifs à variables. Un message
 * inconnu reste tel quel (français) : le test esport/test/langues.test.mjs vérifie que tous ceux du
 * serveur sont couverts.
 */

import { tableErreursAnglais, type TableErreurs } from './anglais';
import { langueCourante, type Langue } from './index';

// Table chargée d'office (iPhone, tests) ou à la demande avec le dictionnaire anglais (web : anglais.web.ts).
let lue: TableErreurs | undefined;
let MOTIFS: ReadonlyArray<readonly [RegExp, string]> = [];
function table(): TableErreurs | undefined {
  const t = tableErreursAnglais();
  if (t && t !== lue) {
    lue = t;
    MOTIFS = t.motifs.map(([motif, modele]) => [new RegExp(motif, 's'), modele] as const);
  }
  return lue;
}

export function traduireServeur(message: string | undefined | null, langue: Langue = langueCourante()): string {
  const m = String(message ?? '');
  if (langue !== 'en' || !m) return m;
  const t = table();
  if (!t) return m;
  const exact = t.messages[m];
  if (exact) return exact;
  for (const [motif, modele] of MOTIFS) {
    const r = motif.exec(m);
    if (r) return modele.replace(/\$(\d)/g, (_, i: string) => r[Number(i)] ?? '');
  }
  return m;
}
