// Loaded in <head> so the saved theme is applied before the page paints.
(() => {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  } catch {
    // Storage can be blocked. The system theme is used then.
  }
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Not saved. The choice still applies to this page.
    }
  });
})();
