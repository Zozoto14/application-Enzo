/**
 * Graines de DATA › Ressources (espace CM) : un lien et un fichier (PDF au nom long, rangé dans le dossier système
 * « Ressources » du Drive du club, migration 0051). Sert aux essais à l'écran et au contrôle de débordement sur
 * téléphone (scripts/e2e-debordement-mobile.mjs). Sans stockage : le lien seulement.
 */

import { createHash } from 'node:crypto';
import { iso, nouvelId } from '../noyau/outils.mjs';
import { cleRecherche } from '../noyau/cm/drive/regles.mjs';

export async function semerRessources(base, { maintenant = () => Date.now(), stockage } = {}) {
  const t = iso(maintenant());
  const lot = [
    {
      sql: "INSERT INTO cm_liens (id, team_id, titre, url, hote, description, categorie, epingle, position, cree_par, cree_le, maj_par, maj_le, acces, genre) VALUES (?, NULL, ?, ?, ?, ?, ?, 1, 1024, 'principal', ?, 'principal', ?, 'tous', 'lien')",
      params: [nouvelId(), 'Banque d’images du club', 'https://unsplash.com/', 'unsplash.com', 'Photos libres de droits pour les visuels.', 'Design', t, t],
    },
  ];
  if (stockage) {
    const octets = new TextEncoder().encode('%PDF-1.4\n% Charte graphique de démonstration\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    const cle = `club/drive/${nouvelId()}.media`;
    await stockage.deposer(cle, octets, { type: 'application/pdf' });
    const dossier = nouvelId();
    const fichier = nouvelId();
    const element = nouvelId();
    const ressource = nouvelId();
    const nom = 'Charte-graphique-officielle-saison-2026-version-definitive-tres-longue.pdf';
    const meta = JSON.stringify({ format: 'pdf' });
    lot.push(
      { sql: "INSERT INTO cm_drive_dossiers (id, portee, team_id, parent_id, nom, cle, restreint, cree_le, maj_le) VALUES (?, 'club', NULL, NULL, NULL, 'ressources', 1, ?, ?) ON CONFLICT DO NOTHING", params: [dossier, t, t] },
      { sql: "INSERT INTO cm_fichiers (id, portee, team_id, cle_stockage, type_mime, taille, nom_original, empreinte, depose_par, meta, cree_le) VALUES (?, 'club', NULL, ?, 'application/pdf', ?, ?, ?, 'principal', ?, ?)", params: [fichier, cle, octets.length, nom, createHash('sha256').update(octets).digest('hex'), meta, t] },
      {
        sql: "INSERT INTO cm_drive_fichiers (id, portee, team_id, dossier_id, nom, nom_cle, fichier_id, version, type_mime, genre, taille, meta, origine, origine_id, ressource_id, cree_par, cree_le, maj_par, maj_le) VALUES (?, 'club', NULL, (SELECT id FROM cm_drive_dossiers WHERE portee = 'club' AND cle = 'ressources'), ?, ?, ?, 1, 'application/pdf', 'document', ?, ?, 'ressource', ?, ?, 'principal', ?, 'principal', ?)",
        params: [element, nom, cleRecherche(nom), fichier, octets.length, meta, ressource, ressource, t, t],
      },
      { sql: "INSERT INTO cm_drive_versions (id, element_id, version, fichier_id, nom, type_mime, taille, meta, cree_par, cree_le) VALUES (?, ?, 1, ?, ?, 'application/pdf', ?, ?, 'principal', ?)", params: [nouvelId(), element, fichier, nom, octets.length, meta, t] },
      {
        sql: "INSERT INTO cm_liens (id, team_id, titre, url, hote, description, categorie, epingle, position, cree_par, cree_le, maj_par, maj_le, acces, genre, element_id, source) VALUES (?, NULL, ?, '', '', ?, 'Charte', 0, 2048, 'principal', ?, 'principal', ?, 'tous', 'fichier', ?, 'envoi')",
        params: [ressource, 'Charte graphique officielle de la saison 2026', 'La version à jour, à utiliser pour tous les visuels.', t, t, element],
      },
    );
  }
  await base.lot(lot);
}
