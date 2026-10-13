// A strict mock of the MCSManager V10 HTTP API (per docs.mcsmanager.com), for tests only.
// - rejects requests without the X-Requested-With header or with a wrong apikey (HTTP 200 + status 403, like MCSM)
// - returns the numeric "status": 200 envelope
// - records every request so tests can assert on headers/paths
import http from 'node:http';

export async function startMock({ key, uuid = 'inst-uuid', daemon = 'daemon-id' }) {
  const requests = [];
  let logText = '\u001b[32m[Server thread/INFO]\u001b[0m: Done (12.1s)! For help, type "help"\r\n';
  let status = 3;

  const env = (st, data) => JSON.stringify({ status: st, data, time: Date.now() });

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: req.method,
        path: u.pathname,
        query: Object.fromEntries(u.searchParams),
        xrw: req.headers['x-requested-with'] ?? null,
        body: bodyText,
      });
      res.setHeader('Content-Type', 'application/json');
      const q = u.searchParams;
      if (req.headers['x-requested-with'] !== 'XMLHttpRequest') return res.end(env(403, 'Missing X-Requested-With'));
      if (q.get('apikey') !== key) return res.end(env(403, 'Invalid apikey'));

      const needsInst = u.pathname.startsWith('/api/protected_instance') || u.pathname.startsWith('/api/files') || u.pathname === '/api/instance';
      if (needsInst && (q.get('uuid') !== uuid || q.get('daemonId') !== daemon)) return res.end(env(400, 'Instance not found'));

      switch (u.pathname) {
        case '/api/instance':
          return res.end(env(200, {
            instanceUuid: uuid, status, started: 3,
            config: { nickname: 'Survival', type: 'minecraft/java', startCommand: 'java -jar secret-token-ARG.jar' },
            processInfo: { cpu: 12.5, memory: 2048000, ppid: 1, pid: 2, ctime: 3, elapsed: 4, timestamp: 5 },
            info: { currentPlayers: 1, maxPlayers: 20, version: '1.21.4', latency: 20 },
            space: 1024,
          }));
        case '/api/protected_instance/outputlog':
          return res.end(env(200, logText));
        case '/api/protected_instance/command': {
          const cmd = q.get('command');
          if (cmd === 'boom') {
            // A leaky upstream error that echoes the full URL incl. the key — our server must scrub it.
            return res.end(env(500, `Unhandled error at http://${req.headers.host}${req.url}`));
          }
          if (cmd === 'list') logText += '[Server thread/INFO]: There are 1 of a max of 20 players online: Steve\r\n';
          else logText += `[Server thread/INFO]: executed ${cmd}\r\n`;
          return res.end(env(200, true));
        }
        case '/api/protected_instance/open': status = 3; return res.end(env(200, { instanceUuid: uuid }));
        case '/api/protected_instance/stop': status = 0; return res.end(env(200, { instanceUuid: uuid }));
        case '/api/protected_instance/restart': status = 3; return res.end(env(200, { instanceUuid: uuid }));
        case '/api/protected_instance/kill': status = 0; return res.end(env(200, { instanceUuid: uuid }));
        case '/api/service/remote_services_list':
          return res.end(env(200, [
            { uuid: daemon, ip: '10.9.8.7', port: 24444, prefix: '', available: true, remarks: 'local' },
            { uuid: 'daemon-offline', ip: '10.9.8.8', port: 24444, prefix: '', available: false, remarks: 'down' },
          ]));
        case '/api/service/remote_service_instances': {
          if (q.get('daemonId') !== daemon) return res.end(env(200, { page: 1, pageSize: 50, maxPage: 1, allTags: [], data: [] }));
          return res.end(env(200, { page: 1, pageSize: 50, maxPage: 1, allTags: [], data: [
            { instanceUuid: uuid, status: 3, config: { nickname: 'Survival' }, info: {} },
            { instanceUuid: 'inst-2-uuid', status: 0, config: { nickname: 'Creative' }, info: {} },
            { instanceUuid: 'inst-3-uuid', status: 0, config: { nickname: 'creative' }, info: {} },
          ] }));
        }
        case '/api/files/list':
          return res.end(env(200, { items: [
            { name: 'world', size: 0, type: 0 },
            { name: 'server.properties', size: 1200, type: 1 },
          ], page: 0, pageSize: 50, total: 2 }));
        case '/api/files/': {
          if (req.method !== 'PUT') return res.end(env(400, 'method'));
          const target = JSON.parse(bodyText || '{}').target;
          if (target === '/server.properties') return res.end(env(200, 'motd=Hello\nmax-players=20\n'));
          return res.end(env(500, 'File not found'));
        }
        default:
          res.statusCode = 404;
          return res.end(env(404, 'not found'));
      }
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, url: `http://127.0.0.1:${port}`, requests, uuid, daemon,
    close: () => new Promise((r) => server.close(r)),
  };
}
