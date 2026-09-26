import { systemeDepuisBureau, type PontSauvegardes } from './bureau';
import { ecrireSauvegarde, lireSauvegarde, listerSauvegardes } from '../sauvegarde/fichiers';
import { creerArchive, ouvrirArchive } from '../sauvegarde/archive';

function pontMemoire(): PontSauvegardes & { fichiers: Map<string, string> } {
  const fichiers = new Map<string, string>();
  return {
    fichiers,
    dossier: async () => 'C:\\Users\\moi\\Documents\\AppliBourse Sauvegardes',
    lister: async () => [...fichiers.keys()],
    existe: async nom => fichiers.has(nom),
    lire: async nom => fichiers.get(nom)!,
    ecrire: async (nom, contenu) => void fichiers.set(nom, contenu),
    supprimer: async nom => void fichiers.delete(nom),
  };
}

describe('sauvegardes sur le bureau', () => {
  it('n’existe pas hors de l’application de bureau', () => {
    expect(systemeDepuisBureau(undefined)).toBeUndefined();
  });

  it('ne fait passer que le nom du fichier au processus principal', async () => {
    const pont = pontMemoire();
    const fichiers = systemeDepuisBureau(pont)!;
    await fichiers.ecrireTexte(`${fichiers.dossierDocuments}/sauvegardes/a.sauvegarde.json`, '{}');
    expect([...pont.fichiers.keys()]).toEqual(['a.sauvegarde.json']);
    expect(await fichiers.lireTexte('bureau:/sauvegardes/a.sauvegarde.json')).toBe('{}');
  });

  it('écrit, liste et relit une vraie sauvegarde chiffrée', async () => {
    const fichiers = systemeDepuisBureau(pontMemoire())!;
    const archive = creerArchive({
      motDePasse: 'sauvegarde-du-portefeuille',
      date: '2026-09-26T11:25:00.000Z',
      contenu: { comptes: [], titres: [], transactions: [], cours: [], parametres: [] },
      kdf: { algorithme: 'argon2id', passes: 1, memoireKio: 64, fils: 1, longueurCle: 32 },
    });
    const ecrite = await ecrireSauvegarde(fichiers, archive);
    const [listee] = await listerSauvegardes(fichiers);
    expect(listee.nom).toBe(ecrite.nom);
    const relue = await lireSauvegarde(fichiers, listee.chemin);
    expect(ouvrirArchive(relue, 'sauvegarde-du-portefeuille').ouverte).toBe(true);
  });
});
