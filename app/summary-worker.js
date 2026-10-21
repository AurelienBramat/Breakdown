// Worker thread: parse one game's tracking file and summarize it, off the server's main thread.
const { parentPort } = require('worker_threads');
const fs = require('fs');
const { parseTracking, summarize } = require('./tracking-summary');

parentPort.on('message', ({ gameId, file, roles }) => {
  try { parentPort.postMessage({ gameId, summary: summarize(parseTracking(fs.readFileSync(file, 'utf8')), roles) }); }
  catch (e) { parentPort.postMessage({ gameId, error: e.message }); }
});
