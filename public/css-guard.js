(function(){
  var isCss = function(node){
    if (!node || node.tagName !== 'SCRIPT') return false;
    var src = node.getAttribute('src') || '';
    return src.indexOf('/_next/static/css/') !== -1 && src.endsWith('.css');
  };
  var convert = function(node){
    if (!isCss(node) || !node.parentNode) return;
    var link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', node.getAttribute('src'));
    node.parentNode.replaceChild(link, node);
  };
  var scan = function(){
    document.querySelectorAll('script[src*="/_next/static/css/"]').forEach(convert);
  };
  var observer = new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes && m.addedNodes.forEach(convert);
    });
  });
  var head = document.head || document.getElementsByTagName('head')[0];
  if (head) observer.observe(head, { childList: true, subtree: true });
  scan();
})();
