const http = require('http'), fs = require('fs'), path = require('path');
const PORT = 8021;
const ROOT = path.join(__dirname, 'endpoint-explorer');
const MIME = { '.html':'text/html;charset=utf-8', '.js':'application/javascript;charset=utf-8', '.css':'text/css;charset=utf-8', '.json':'application/json' };
http.createServer((req,res)=>{
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e,d)=>{
    if (e) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});
    res.end(d);
  });
}).listen(PORT, ()=>console.log('Explorer on '+PORT));
