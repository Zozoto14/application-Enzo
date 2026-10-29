/**
 * Limites de débit (rate limiting) de l'Esport, en fenêtre fixe, dans la
 * table `limites` (migration 0007) : rien en mémoire, donc valable quel que
 * soit le nombre de processus du serveur.
 *
 * Complète l'anti-force brute des codes d'invitation (service.mjs : attente
 * doublée après 5 échecs) : ici on borne le VOLUME d'appels coûteux ou
 * sensibles, même réussis.
 *
 * La fenêtre est approximative (lecture puis écriture, sans verrou) : sous
 * forte concurrence, quelques appels de plus peuvent passer. C'est voulu :
 * pas de transaction longue, et l'ordre de grandeur suffit.
 */

import { echec, iso } from './outils.mjs';

/** Règles : nombre d'appels permis par fenêtre (secondes), par clé. */
export const LIMITES = {
  // Ouverture de session (chaque appel interroge le relais) : par adresse IP.
  session: { max: 30, fenetreS: 60 },
  // Création (ou changement) du profil Esport : « création de compte », par IP et par compte.
  profil_ip: { max: 20, fenetreS: 3600 },
  profil: { max: 10, fenetreS: 3600 },
  // Création de team : par compte.
  team: { max: 10, fenetreS: 3600 },
  // Invitations créées : par compte.
  invitation: { max: 30, fenetreS: 3600 },
  // Demandes de compte (members.create) : par compte (en plus du plafond de demandes en attente).
  demande_compte: { max: 10, fenetreS: 3600 },
  // Codes d'invitation présentés (réussis ou non) : par IP, en plus de l'anti-force brute.
  acceptation_ip: { max: 30, fenetreS: 3600 },
  // Exports RGPD et exports CSV : par compte.
  export: { max: 30, fenetreS: 3600 },
  // Bot Discord : codes de liaison demandés (par compte), codes tapés dans Discord (par utilisateur
  // Discord : anti-force brute), commandes (par utilisateur Discord), relances (par événement).
  discord_code: { max: 20, fenetreS: 3600 },
  discord_lier: { max: 10, fenetreS: 600 },
  discord_commande: { max: 40, fenetreS: 60 },
  discord_relance: { max: 3, fenetreS: 3600 },
  // Aperçus de liens (Ressources) : chaque appel fait une requête sortante du serveur.
  apercu: { max: 60, fenetreS: 3600 },
  // Assistant IA des profils de jeu (brouillon, vérification manuelle, test) : par compte, en plus du plafond mensuel.
  ia: { max: 20, fenetreS: 3600 },
  // Statistiques d'usage : lots de l'app (un toutes les 45 s au plus, plus les envois au départ de la page), par compte.
  usage: { max: 150, fenetreS: 3600 },
  // Section CM : imports Trello (gros fichiers analysés par le serveur), clips proposés et dépôts d'informations, par compte.
  cm_import: { max: 20, fenetreS: 3600 },
  cm_clip: { max: 30, fenetreS: 3600 },
  cm_depot: { max: 30, fenetreS: 3600 },
  // Sponsors : imports CSV de prospects (aperçu compris), par compte.
  sp_import: { max: 30, fenetreS: 3600 },
  // Réseaux : imports CSV de relevés (aperçu compris) ; messages de test Discord.
  rs_import: { max: 60, fenetreS: 3600 },
  rs_test: { max: 30, fenetreS: 3600 },
  // Visuels : rendus envoyés et images importées dans l'éditeur (chacun lu et vérifié par le serveur).
  cm_visuel: { max: 200, fenetreS: 3600 },
  // Drive (migration 0027) : fichiers rangés (et versions) par heure ; liens de ZIP (lecture lourde du disque).
  cm_drive: { max: 600, fenetreS: 3600 },
  cm_drive_zip: { max: 20, fenetreS: 3600 },
  // Trombinoscope (migration 0030) : photos envoyées et fiches enregistrées, par compte et par heure.
  trombi_photo: { max: 30, fenetreS: 3600 },
  trombi_fiche: { max: 120, fenetreS: 3600 },
  // Badges (migration 0032) : créations et attributions, par compte et par heure.
  trombi_badges: { max: 300, fenetreS: 3600 },
};

/**
 * Compte un appel `genre` pour `qui` ; lève 429 (avec `attente` en secondes)
 * au-delà de la limite. `qui` vide (IP inconnue) : rien n'est compté.
 */
export async function limiter(base, genre, qui, maintenant) {
  const regle = LIMITES[genre];
  if (!regle) throw new Error(`Limite inconnue : ${genre}`);
  if (!qui) return;
  const cle = `${genre}:${String(qui).slice(0, 120)}`;
  const t = maintenant;
  const l = await base.premier('SELECT debut, n FROM limites WHERE cle = ?', [cle]);
  const debut = l ? Date.parse(l.debut) : NaN;
  const dansFenetre = Number.isFinite(debut) && t - debut < regle.fenetreS * 1000;
  if (dansFenetre && Number(l.n) >= regle.max) {
    const e = echec(429, 'trop-de-requetes', 'Trop de demandes en peu de temps : réessayez dans un moment.');
    e.attente = Math.max(1, Math.ceil((debut + regle.fenetreS * 1000 - t) / 1000));
    throw e;
  }
  if (dansFenetre) {
    await base.executer('UPDATE limites SET n = n + 1 WHERE cle = ?', [cle]);
  } else {
    await base.executer(
      'INSERT INTO limites (cle, debut, n) VALUES (?, ?, 1) ON CONFLICT (cle) DO UPDATE SET debut = excluded.debut, n = 1',
      [cle, iso(t)],
    );
  }
}

/** Cron : efface les fenêtres finies depuis longtemps (plus d'un jour). */
export async function purgerLimites(base, maintenant) {
  const r = await base.executer('DELETE FROM limites WHERE debut < ?', [iso(maintenant - 86_400_000)]);
  return Number(r?.changements ?? 0);
}
