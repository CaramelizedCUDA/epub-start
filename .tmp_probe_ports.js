import net from 'node:net';
const ports = [7890,7891,7892,7893,7894,7895,7896,7897,7898,7899,3986,9090,15721,3080];
let remaining = ports.length;
ports.forEach(p => {
  const s = net.connect({host:'127.0.0.1', port:p});
  let opened = false;
  s.setTimeout(800);
  s.on('connect', () => { opened = true; s.destroy(); });
  s.on('timeout', () => { s.destroy(); });
  s.on('error', () => { s.destroy(); });
  s.on('close', () => {
    console.log('port ' + p + ': ' + (opened ? 'OPEN' : 'closed'));
    if (--remaining === 0) process.exit(0);
  });
});
setTimeout(() => { console.log('probe-timeout'); process.exit(0); }, 12000);
