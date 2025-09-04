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

      // Fix wrong preloads / modulepreloads
      d.querySelectorAll('link[rel="preload"][as="script"][href$=".css"],link[rel="preload"][as="script"][href*="/_next/static/css/"]').forEach(l => {
        l.setAttribute('as', 'style');
        fixedPreloads++;
      });
      d.querySelectorAll('link[rel="modulepreload"][href$=".css"],link[rel="modulepreload"][href*="/_next/static/css/"]').forEach(l => {
        l.setAttribute('rel', 'preload');
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
      
      // Intercept DOM insertions to prevent execution of CSS as script
      const isCssUrl = (u) => typeof u === 'string' && (u.endsWith('.css') || u.indexOf('/_next/static/css/') !== -1);
      const toStylesheet = (url) => {
        const ln = d.createElement('link');
        ln.setAttribute('rel', 'stylesheet');
        ln.setAttribute('href', url);
        return ln;
      };
      const patchInserter = (proto) => {
        if (!proto) return;
        const origAppend = proto.appendChild; 
        const origInsertBefore = proto.insertBefore; 
        proto.appendChild = function(child){
          try{
            if (child && child.tagName === 'SCRIPT'){
              const src = child.getAttribute('src') || '';
              if (isCssUrl(src)){
                replaced++;
                return origAppend.call(this, toStylesheet(src));
              }
            }
            if (child && child.tagName === 'LINK'){
              const rel = child.getAttribute('rel') || '';
              const as = child.getAttribute('as') || '';
              const href = child.getAttribute('href') || '';
              if ((rel === 'preload' || rel === 'modulepreload') && as === 'script' && isCssUrl(href)){
                child.setAttribute('rel','preload');
                child.setAttribute('as','style');
                fixedPreloads++;
              }
            }
          }catch(_){ }
          return origAppend.call(this, child);
        };
        proto.insertBefore = function(child, ref){
          try{
            if (child && child.tagName === 'SCRIPT'){
              const src = child.getAttribute('src') || '';
              if (isCssUrl(src)){
                replaced++;
                return origInsertBefore.call(this, toStylesheet(src), ref);
              }
            }
            if (child && child.tagName === 'LINK'){
              const rel = child.getAttribute('rel') || '';
              const as = child.getAttribute('as') || '';
              const href = child.getAttribute('href') || '';
              if ((rel === 'preload' || rel === 'modulepreload') && as === 'script' && isCssUrl(href)){
                child.setAttribute('rel','preload');
                child.setAttribute('as','style');
                fixedPreloads++;
              }
            }
          }catch(_){ }
          return origInsertBefore.call(this, child, ref);
        };
      };
      patchInserter(HTMLElement.prototype);
      patchInserter(HTMLHeadElement && HTMLHeadElement.prototype);
      patchInserter(HTMLBodyElement && HTMLBodyElement.prototype);
      
      // Patch document.write to rewrite any CSS-as-script markup
      const origWrite = (d as any).write?.bind(d);
      if (origWrite){
        (d as any).write = function(html){
          try{
            if (typeof html === 'string'){
              html = html.replace(/<script([^>]*?)src=("|')([^"']*\/_next\/static\/css\/[^"']*?\.css)\2([^>]*)><\/script>/gi, '<link rel="stylesheet" href="$3">');
              html = html.replace(/<link([^>]*?)rel=("|')preload\2([^>]*?)as=("|')script\4([^>]*?)href=("|')([^"']*?\.css)\6([^>]*)>/gi, '<link rel="preload" as="style" href="$7">');
            }
          }catch(_){ }
          return origWrite(html);
        };
      }
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
