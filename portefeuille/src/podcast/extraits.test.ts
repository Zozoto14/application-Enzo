import { extraireResume, pageAutorisee } from './extraits';

describe('essentiel d’un article', () => {
  it('ne lit que des pages https de médias connus', () => {
    expect(pageAutorisee('https://www.lesechos.fr/finance-marches/article')).toBe(true);
    expect(pageAutorisee('https://finance.yahoo.com/news/nvidia-123.html')).toBe(true);
    expect(pageAutorisee('http://www.lesechos.fr/a')).toBe(false);
    expect(pageAutorisee('https://lesechos.fr.pirate.com/a')).toBe(false);
    expect(pageAutorisee('https://news.google.com/rss/articles/abc')).toBe(false);
    expect(pageAutorisee(undefined)).toBe(false);
  });

  it('prend le chapeau de l’éditeur', () => {
    const html = `<html><head><meta property="og:description" content="Nvidia a publié un chiffre d&#39;affaires record de 46 milliards de dollars, porté par les centres de données. Le groupe relève ses prévisions pour le trimestre suivant."></head><body><p>Cookies : acceptez-vous ?</p></body></html>`;
    expect(extraireResume(html)).toBe(
      "Nvidia a publié un chiffre d'affaires record de 46 milliards de dollars, porté par les centres de données. Le groupe relève ses prévisions pour le trimestre suivant.",
    );
  });

  it('complète un chapeau trop court par le premier vrai paragraphe', () => {
    const html = `<meta name="description" content="Air Liquide investit.">
      <p>Acceptez les cookies pour continuer votre lecture sur notre site internet, merci beaucoup.</p>
      <p>Le groupe va construire deux électrolyseurs en Normandie, pour un montant de 400 millions d’euros, avec une mise en service prévue en 2028.</p>`;
    expect(extraireResume(html)).toBe(
      'Air Liquide investit. Le groupe va construire deux électrolyseurs en Normandie, pour un montant de 400 millions d’euros, avec une mise en service prévue en 2028.',
    );
  });

  it('rend une chaîne vide sans contenu exploitable', () => {
    expect(extraireResume('<html><body>rien</body></html>')).toBe('');
  });
});
