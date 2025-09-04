export default function Head() {
  // Early head script to guard against any accidental CSS-as-script/load
  // Runs before interactive scripts and observes head mutations.
  const guard = `(() => {
    try {
      const d = document;
      let replaced = 0; let fixedPreloads = 0;
      const fixScript = (node) => {
        if (!(node && node.tagName === 'SCRIPT')) return;
        const src = node.getAttribute('src') || '';
        if (src.endsWith('.css') || src.includes('/_next/static/css/')) {
          const ln = d.createElement('link');
          ln.setAttribute('rel', 'stylesheet');
          ln.setAttribute('href', src);
          if (node.parentNode) node.parentNode.replaceChild(ln, node);
          replaced++;
        }
      };

      // Initial scan
      d.querySelectorAll('script[src$=".css"],script[src*="/_next/static/css/"]').forEach(fixScript);

      // Fix wrong preloads
      d.querySelectorAll('link[rel="preload"][as="script"][href$=".css"],link[rel="preload"][as="script"][href*="/_next/static/css/"]').forEach(l => {
        l.setAttribute('as', 'style');
        fixedPreloads++;
      });

      // Observe head for new script insertions
      const head = d.head || d.querySelector('head');
      if (!head) return;
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes && m.addedNodes.forEach((n) => fixScript(n as any));
        }
      });
      mo.observe(head, { childList: true, subtree: true });
      if (replaced || fixedPreloads) {
        console.info('[CSS Guard] corrected', { replacedScripts: replaced, fixedPreloads });
      }
    } catch (_) {}
  })();`;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: guard }} />
    </>
  );
}
