/**
 * Maps proposées (Administration › Jeux › « Maps proposées »), migration 0078 : le serveur PRÉPARE une
 * proposition par map, le gestionnaire la VALIDE ; rien n'est appliqué au profil avant validation.
 *
 *  - The Finals : wiki communautaire (wiki-thefinals.mjs) : vue de dessus (sinon illustration de l'arène),
 *    variantes, modes, pool compétitif suggéré (« Ranked Cashout »), échelle approximative à vérifier, source et
 *    licence (lue sur le wiki), aucun repère (le wiki n'en donne pas de coordonnées) ;
 *  - Valorant : valorant-api.com (import.mjs) : minimap, échelle calculée, callouts ; l'écran montre ce qui
 *    changera dans le profil (image, échelle, callouts) avant validation.
 *
 * Images : téléchargées par le téléchargeur borné (hôtes autorisés, https, sans redirection, 10 Mo, type
 * vérifié aux octets) et rangées dans le stockage (`jeu_images`) dès la préparation ; une image identique
 * (même empreinte) n'est jamais re-déposée.
 * Préparer de nouveau : les propositions « à valider » sont rafraîchies (une image remplacée ou un calibrage fait
 * à la main sur la proposition sont gardés) ; une map validée ou rejetée ne revient « à valider » que si l'image
 * de la source a changé ; le profil n'est jamais modifié par la préparation.
 * Valider : la map est ajoutée au profil (dans le pool si suggéré) ou mise à jour : image, source et licence,
 * échelle (un calibrage fait à la main dans le profil est gardé), repères importés (ceux posés à la main restent).
 */

import { echec, iso, jsonOu } from '../outils.mjs';
import { empreinteSha256 } from '../fichiers.mjs';
import { TYPES_IMAGE_JEU, verifierImageJeu, verifierOctetsImage } from './images.mjs';
import { HOTES_VALORANT, TAILLE_MAX_IMAGE_IMPORT, TAILLE_MAX_JSON_IMPORT, URL_MAPS_VALORANT, echelleDepuisUnitesParMetre, fusionnerReperes, mapValorant, telechargerBorne } from './import.mjs';
import { HOTES_WIKI_THEFINALS, arenesDuWiki } from './wiki-thefinals.mjs';
import { Invalide, cleDe, lireEchelle, validerDonnees } from './schema.mjs';

export const STATUTS_PROPOSITION = ['a-valider', 'validee', 'rejetee'];
const MAX_CARTES = 80;

/** Valorant : maps de valorant-api.com → propositions (même forme que celles du wiki). */
async function mapsValorant(fetchImport) {
  const { octets } = await telechargerBorne(fetchImport, URL_MAPS_VALORANT, { hotes: HOTES_VALORANT, max: TAILLE_MAX_JSON_IMPORT, types: ['application/json'] });
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(octets));
  } catch {
    throw echec(502, 'import-json', 'Réponse de valorant-api.com illisible.');
  }
  const maps = (Array.isArray(json?.data) ? json.data : []).map(mapValorant).filter(Boolean);
  if (maps.length === 0) throw echec(502, 'import-vide', 'valorant-api.com ne donne aucune map exploitable.');
  return maps.map(m => ({
    cle: m.cle,
    nom: m.nom,
    page: null,
    image: { url: m.minimap, vueDessus: true },
    variantes: [],
    modes: [],
    // valorant-api.com ne dit pas quelles maps sont dans le pool du moment : le gestionnaire choisit.
    competitive: null,
    horsCompetition: !m.competitive,
    echelle: echelleDepuisUnitesParMetre(m.pxParMetre, 'import'),
    reperes: m.reperes.map(r => ({ ...r, cle: cleDe(r.nom) })),
    attribution: 'Source : valorant-api.com (API communautaire, données du jeu © Riot Games).',
  }));
}

export function servicesCartesProposees({ base, images, fetchImport, maintenant, exigerGestion, ligneJeu, donneesDe, ecrireVersion, detail, modeleDe }) {
  const lignes = cle => base.tous('SELECT * FROM jeu_cartes_proposees WHERE jeu_cle = ? ORDER BY carte_cle', [cle]);
  const ligne = (cle, carte) => base.premier('SELECT * FROM jeu_cartes_proposees WHERE jeu_cle = ? AND carte_cle = ?', [cle, carte]);

  function exigerModele(j) {
    const modele = modeleDe(j);
    if (modele !== 'valorant' && modele !== 'thefinals') throw echec(400, 'import-modele', 'Import automatique : Valorant et The Finals seulement (déposez les images à la main).');
    return modele;
  }

  /** Ce que la validation changerait dans le profil (écran de revue). */
  function changements(p, row, c) {
    if (!c) return { nouvelle: true, image: row.fichier ? 'ajout' : 'aucune', echelle: p.echelle ? 'ajout' : 'aucune', reperes: p.reperes?.length ?? 0 };
    const memeImage = row.fichier && (c.fichier === row.fichier || (row.empreinte && c.source?.empreinte === row.empreinte && !p.imageManuelle));
    const echelle = !p.echelle ? 'aucune' : !c.echelle ? 'ajout' : c.echelle.pxParMetre === p.echelle.pxParMetre ? 'identique' : !c.echelle.methode && !p.echelleManuelle ? 'gardee' : 'remplacement';
    return { nouvelle: false, image: !row.fichier ? 'aucune' : memeImage ? 'identique' : c.fichier ? 'remplacement' : 'ajout', echelle, reperes: p.reperes?.length ?? 0 };
  }

  /** `GET /jeux/:cle/cartes-proposees` : propositions, avec les liens signés de leurs images. */
  async function liste(acteur, cle, { origine = '' } = {}) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    const d = donneesDe(j);
    const rows = await lignes(cle);
    const cartes = rows.map(row => {
      const p = jsonOu(row.donnees, {});
      const c = d.cartes.find(x => x.cle === row.carte_cle);
      return {
        cle: row.carte_cle,
        nom: c?.nom ?? p.nom,
        statut: row.statut,
        fournisseur: row.fournisseur,
        fichier: row.fichier ?? null,
        vueDessus: Boolean(p.vueDessus),
        imageManuelle: Boolean(p.imageManuelle),
        imageUrl: p.imageUrl ?? null,
        page: p.page ?? null,
        licence: p.licence ?? null,
        attribution: p.attribution ?? null,
        echelle: p.echelle ?? null,
        echelleManuelle: Boolean(p.echelleManuelle),
        competitive: p.competitive ?? null,
        horsCompetition: Boolean(p.horsCompetition),
        variantes: p.variantes ?? [],
        modes: p.modes ?? [],
        reperes: p.reperes?.length ?? 0,
        erreur: p.erreur ?? null,
        dansProfil: Boolean(c),
        changements: changements(p, row, c),
        majLe: row.maj_le,
        decideLe: row.decide_le ?? null,
      };
    });
    const ordre = { 'a-valider': 0, rejetee: 1, validee: 2 };
    cartes.sort((a, b) => ordre[a.statut] - ordre[b.statut] || a.nom.localeCompare(b.nom));
    return { cleJeu: cle, version: Number(j.version), modele: modeleDe(j), cartes, images: await images.liens(cle, { cartes: rows.filter(r => r.fichier).map(r => ({ fichier: r.fichier })) }, acteur.compte, origine) };
  }

  /** Télécharge une image (bornée, vérifiée) ; rend `{ verifiee, empreinte }`. */
  async function telechargerImage(url, hotes) {
    const { octets, type } = await telechargerBorne(fetchImport, url, { hotes, max: TAILLE_MAX_IMAGE_IMPORT, types: Object.keys(TYPES_IMAGE_JEU) });
    const verifiee = verifierOctetsImage(octets, type, TAILLE_MAX_IMAGE_IMPORT);
    return { verifiee, empreinte: await empreinteSha256(octets) };
  }

  /** Image déjà rangée pour ce jeu avec cette empreinte (proposition précédente ou profil) : réutilisée. */
  async function imageExistante(cle, empreinte) {
    const l = await base.premier('SELECT id FROM jeu_images WHERE jeu_cle = ? AND empreinte = ? AND supprime_le IS NULL ORDER BY cree_le DESC LIMIT 1', [cle, empreinte]);
    return l?.id ?? null;
  }

  async function ecrireLigne(cle, carte, { fournisseur, statut, donnees, empreinte, fichier, existante }) {
    const t = iso(maintenant());
    if (existante) {
      await base.executer('UPDATE jeu_cartes_proposees SET fournisseur = ?, statut = ?, donnees = ?, empreinte = ?, fichier = ?, maj_le = ?, decide_par = ?, decide_le = ? WHERE jeu_cle = ? AND carte_cle = ?', [
        fournisseur,
        statut,
        JSON.stringify(donnees),
        empreinte ?? null,
        fichier ?? null,
        t,
        statut === existante.statut ? (existante.decide_par ?? null) : null,
        statut === existante.statut ? (existante.decide_le ?? null) : null,
        cle,
        carte,
      ]);
    } else {
      await base.executer('INSERT INTO jeu_cartes_proposees (jeu_cle, carte_cle, fournisseur, statut, donnees, empreinte, fichier, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [cle, carte, fournisseur, statut, JSON.stringify(donnees), empreinte ?? null, fichier ?? null, t, t]);
    }
  }

  /**
   * `POST /jeux/:cle/cartes-proposees/preparer` : lit la source (wiki ou valorant-api.com), télécharge les images,
   * range les propositions. Rend un compte rendu par map et la liste.
   */
  async function preparer(acteur, cle, _corps = {}, { origine = '' } = {}) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    const modele = exigerModele(j);
    const d = donneesDe(j);
    let maps;
    let hotes;
    let fournisseur;
    let licence = null;
    if (modele === 'thefinals') {
      const wiki = await arenesDuWiki(fetchImport);
      maps = wiki.arenes;
      licence = wiki.licence;
      hotes = HOTES_WIKI_THEFINALS;
      fournisseur = 'thefinals.wiki';
    } else {
      // Valorant : maps de compétition, et celles déjà dans le profil.
      maps = (await mapsValorant(fetchImport)).filter(m => !m.horsCompetition || d.cartes.some(c => c.cle === m.cle));
      hotes = HOTES_VALORANT;
      fournisseur = 'valorant-api.com';
    }
    const existantes = new Map((await lignes(cle)).map(r => [r.carte_cle, r]));
    const rapport = [];
    for (const m of maps) {
      const row = existantes.get(m.cle);
      const avant = row ? jsonOu(row.donnees, {}) : null;
      const entree = { carte: m.nom, statut: 'nouvelle' };
      let empreinte = null;
      let fichier = null;
      let erreur = null;
      try {
        if (m.image?.url) {
          const img = await telechargerImage(m.image.url, hotes);
          empreinte = img.empreinte;
          // Proposition validée ou rejetée dont l'image de la source n'a pas changé : rien à faire.
          if (row && row.statut !== 'a-valider' && row.empreinte === empreinte) {
            rapport.push({ carte: m.nom, statut: row.statut === 'validee' ? 'deja-validee' : 'deja-rejetee' });
            continue;
          }
          if (row?.statut === 'a-valider' && avant?.imageManuelle) fichier = row.fichier;
          else fichier = row?.fichier && row.empreinte === empreinte ? row.fichier : ((await imageExistante(cle, empreinte)) ?? (await images.deposerVerifiee(acteur, cle, img.verifiee, `${m.cle}.${img.verifiee.format === 'jpeg' ? 'jpg' : img.verifiee.format}`)).id);
        } else erreur = 'import-sans-image';
      } catch (e) {
        if (!e?.code) throw e;
        erreur = e.code;
        if (row && row.statut !== 'a-valider') {
          rapport.push({ carte: m.nom, statut: row.statut === 'validee' ? 'deja-validee' : 'deja-rejetee', erreur });
          continue;
        }
        fichier = row?.fichier ?? null;
        empreinte = row?.empreinte ?? null;
      }
      const garderEchelle = row?.statut === 'a-valider' && avant?.echelleManuelle;
      const donnees = {
        nom: m.nom,
        page: m.page,
        imageUrl: m.image?.url ?? null,
        imageFichierSource: m.image?.fichier ?? null,
        vueDessus: Boolean(m.image?.vueDessus),
        imageManuelle: Boolean(row?.statut === 'a-valider' && avant?.imageManuelle),
        ...(avant?.imageManuelle && row?.statut === 'a-valider' ? { imageManuelleUrl: avant.imageManuelleUrl ?? null } : {}),
        licence: licence ? { texte: licence.texte, url: licence.url } : null,
        attribution: m.attribution,
        echelle: garderEchelle ? avant.echelle : m.echelle ? lireEchelle(m.echelle, 'echelle') : null,
        echelleManuelle: Boolean(garderEchelle),
        competitive: m.competitive,
        horsCompetition: Boolean(m.horsCompetition),
        variantes: m.variantes,
        modes: m.modes,
        reperes: m.reperes,
        ...(erreur ? { erreur } : {}),
        le: iso(maintenant()),
      };
      if (row) entree.statut = row.statut === 'a-valider' ? 'rafraichie' : 'mise-a-jour';
      if (erreur) entree.erreur = erreur;
      await ecrireLigne(cle, m.cle, { fournisseur, statut: 'a-valider', donnees, empreinte, fichier, existante: row });
      rapport.push(entree);
    }
    return { rapport, ...(await liste(acteur, cle, { origine })) };
  }

  /** Applique une proposition aux données du profil (copie) ; rend la map. */
  function appliquer(d, row, t) {
    const p = jsonOu(row.donnees, {});
    let c = d.cartes.find(x => x.cle === row.carte_cle);
    if (!c) {
      if (d.cartes.length >= MAX_CARTES) throw echec(400, 'cartes-trop', 'Profil complet : 80 maps au plus.');
      c = { cle: row.carte_cle, nom: p.nom, image: null, actif: p.competitive === true, modes: [] };
      d.cartes.push(c);
    }
    if (row.fichier) {
      c.fichier = row.fichier;
      const url = p.imageManuelle ? p.imageManuelleUrl || p.page || p.imageUrl : p.imageUrl || p.page;
      c.source = {
        fournisseur: row.fournisseur,
        url,
        le: t,
        ...(row.empreinte && !p.imageManuelle ? { empreinte: row.empreinte } : {}),
        aVerifier: row.fournisseur !== 'valorant-api.com' || Boolean(p.imageManuelle) || !p.vueDessus,
        ...(p.page ? { page: p.page } : {}),
        ...(p.licence?.texte ? { licence: p.licence.texte } : {}),
        ...(p.licence?.url ? { licenceUrl: p.licence.url } : {}),
        ...(p.attribution ? { attribution: p.attribution } : {}),
      };
      if (!c.source.url) delete c.source;
    }
    if (p.echelle && (!c.echelle || c.echelle.methode === 'import' || c.echelle.methode === 'approx' || p.echelleManuelle)) c.echelle = p.echelle;
    if (p.reperes?.length) c.reperes = fusionnerReperes(c.reperes, p.reperes).reperes;
    return c;
  }

  /** `POST /jeux/:cle/cartes-proposees/valider` { cartes: [clés] } ou { toutes: true } : une seule nouvelle version du profil. */
  async function valider(acteur, cle, corps = {}, { origine = '' } = {}) {
    await exigerGestion(acteur);
    const j = await ligneJeu(cle);
    const rows = (await lignes(cle)).filter(r => r.statut === 'a-valider');
    const choisies = corps?.toutes === true ? rows : rows.filter(r => Array.isArray(corps?.cartes) && corps.cartes.includes(r.carte_cle));
    if (choisies.length === 0) throw echec(400, 'proposition-aucune', 'Aucune map à valider.');
    const d = structuredClone(donneesDe(j));
    const t = iso(maintenant());
    for (const row of choisies) appliquer(d, row, t);
    const extra = choisies.map(row => ({ sql: "UPDATE jeu_cartes_proposees SET statut = 'validee', decide_par = ?, decide_le = ? WHERE jeu_cle = ? AND carte_cle = ?", params: [acteur.compte, t, cle, row.carte_cle] }));
    const r = await ecrireVersion(acteur, j, { donnees: validerDonnees(d).donnees, versionAttendue: corps?.version, motif: 'cartes-proposees', extra });
    if (r.inchange) for (const e of extra) await base.executer(e.sql, e.params);
    return { validees: choisies.map(r => r.carte_cle), jeu: await detail(acteur, cle, { origine }), ...(await liste(acteur, cle, { origine })) };
  }

  /** `POST /jeux/:cle/cartes-proposees/rejeter` { cartes: [clés] } : la proposition reste, marquée rejetée. */
  async function rejeter(acteur, cle, corps = {}, { origine = '' } = {}) {
    await exigerGestion(acteur);
    await ligneJeu(cle);
    const cartes = Array.isArray(corps?.cartes) ? corps.cartes.filter(c => typeof c === 'string').slice(0, MAX_CARTES) : [];
    if (cartes.length === 0) throw echec(400, 'proposition-aucune', 'Aucune map à rejeter.');
    const t = iso(maintenant());
    for (const c of cartes) await base.executer("UPDATE jeu_cartes_proposees SET statut = 'rejetee', decide_par = ?, decide_le = ?, maj_le = ? WHERE jeu_cle = ? AND carte_cle = ? AND statut = 'a-valider'", [acteur.compte, t, t, cle, c]);
    return liste(acteur, cle, { origine });
  }

  async function propositionAValider(cle, carte) {
    const row = await ligne(cle, carte);
    if (!row) throw echec(404, 'proposition-introuvable', 'Proposition introuvable.');
    if (row.statut !== 'a-valider') throw echec(409, 'proposition-decidee', 'Cette proposition a déjà été validée ou rejetée.');
    return row;
  }

  /**
   * `POST /jeux/:cle/cartes-proposees/:carte/image` : « Remplacer l'image » d'une proposition, par un fichier
   * `{ type, donnees, nom }` ou une adresse https publique `{ url }` (téléchargée par le serveur, bornée).
   */
  async function remplacerImage(acteur, cle, carte, corps = {}, { origine = '' } = {}) {
    await exigerGestion(acteur);
    await ligneJeu(cle);
    const row = await propositionAValider(cle, carte);
    let verifiee;
    let url = null;
    if (typeof corps?.url === 'string' && corps.url.trim()) {
      url = corps.url.trim();
      verifiee = (await telechargerImage(url, undefined)).verifiee;
    } else verifiee = verifierImageJeu(corps ?? {});
    const empreinte = await empreinteSha256(verifiee.octets);
    const fichier = (await imageExistante(cle, empreinte)) ?? (await images.deposerVerifiee(acteur, cle, verifiee, corps?.nom || `${carte}-manuelle`)).id;
    const p = jsonOu(row.donnees, {});
    const donnees = { ...p, imageManuelle: true, imageManuelleUrl: url, vueDessus: true };
    delete donnees.erreur;
    await ecrireLigne(cle, carte, { fournisseur: row.fournisseur, statut: 'a-valider', donnees, empreinte: row.empreinte, fichier, existante: row });
    return liste(acteur, cle, { origine });
  }

  /** `PUT /jeux/:cle/cartes-proposees/:carte/echelle` { points: [x1, y1, x2, y2], distance } : calibrage à deux points. */
  async function calibrer(acteur, cle, carte, corps = {}, { origine = '' } = {}) {
    await exigerGestion(acteur);
    await ligneJeu(cle);
    const row = await propositionAValider(cle, carte);
    let echelle;
    try {
      echelle = lireEchelle({ points: corps?.points, distance: corps?.distance }, 'echelle');
    } catch (e) {
      if (e instanceof Invalide) throw echec(400, 'echelle-invalide', 'Calibrage invalide : deux points distincts et une distance réelle en mètres.');
      throw e;
    }
    const p = jsonOu(row.donnees, {});
    await ecrireLigne(cle, carte, { fournisseur: row.fournisseur, statut: 'a-valider', donnees: { ...p, echelle, echelleManuelle: true }, empreinte: row.empreinte, fichier: row.fichier, existante: row });
    return liste(acteur, cle, { origine });
  }

  /** Suppression d'un profil : ses propositions (instruction SQL à joindre au lot). */
  const purge = cle => ({ sql: 'DELETE FROM jeu_cartes_proposees WHERE jeu_cle = ?', params: [cle] });

  return { liste, preparer, valider, rejeter, remplacerImage, calibrer, purge };
}
