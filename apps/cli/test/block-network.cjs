'use strict';
/**
 * Preloaded with `node --require` to PROVE the offline demo never touches the network:
 * any attempt to open a socket, resolve a name, or call fetch/http(s) terminates the process with
 * exit code 99 and a message. Listening on a loopback port (the dashboard) is still allowed.
 */
const net = require('node:net');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const dgram = require('node:dgram');

function die(what) {
  process.stderr.write(`NETWORK ACCESS ATTEMPTED: ${what}\n`);
  process.exit(99);
}

net.Socket.prototype.connect = function connect() {
  die('net.Socket#connect');
};
net.connect = net.createConnection = () => die('net.connect');
tls.connect = () => die('tls.connect');
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']) {
  if (typeof dns[name] === 'function') dns[name] = () => die(`dns.${name}`);
  if (dns.promises && typeof dns.promises[name] === 'function')
    dns.promises[name] = () => die(`dns.promises.${name}`);
}
http.request = http.get = () => die('http.request');
https.request = https.get = () => die('https.request');
dgram.createSocket = () => die('dgram.createSocket');
globalThis.fetch = () => die('fetch');
