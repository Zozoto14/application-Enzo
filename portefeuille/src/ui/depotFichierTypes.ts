/** Contrat commun aux deux versions de la zone de dépôt de fichier. */
export interface DepotFichierProps {
  onContenu(texte: string, nom: string): void;
}
