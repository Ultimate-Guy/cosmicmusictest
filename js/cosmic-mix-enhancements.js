(() => {
  // Lightweight UX layer for Cosmic Music. It works with the existing player
  // without replacing the legal catalog/playback implementation.
  const boot = () => {
    const root = document.querySelector('#cosmic-music-root');
    if (!root || root.dataset.cosmicMixReady) return;
    root.dataset.cosmicMixReady = 'true';

    const addMixButton = () => {
      const content = root.querySelector('#music-content');
      const hero = content?.querySelector('.hero');
      if (!hero || hero.querySelector('#cosmic-smart-mix')) return;
      const button = document.createElement('button');
      button.id = 'cosmic-smart-mix';
      button.className = 'hero-action';
      button.textContent = '✦ Cosmic Mix';
      button.title = 'Start a fresh mix from the tracks currently shown';
      button.addEventListener('click', () => {
        const cards = [...content.querySelectorAll('.track-card')];
        const shuffled = cards.sort(() => Math.random() - 0.5);
        shuffled.slice(0, Math.min(6, shuffled.length)).forEach((card, i) => {
          if (i === 0) card.click();
        });
      });
      hero.appendChild(button);
    };

    const observe = new MutationObserver(addMixButton);
    observe.observe(root, { childList: true, subtree: true });
    addMixButton();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
