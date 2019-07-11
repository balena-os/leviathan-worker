/*
 * Copyright 2017 balena
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const Bluebird = require('bluebird');
const { Mutex } = require('async-mutex');
const express = require('express');
const expressWebSocket = require('express-ws');
const { forkCode, promiseStream } = require('./common/utils');
const { move, pathExists, remove } = require('fs-extra');
const { tmpdir } = require('os');
const { join } = require('path');
const tar = require('tar-fs');
const webSocketStream = require('websocket-stream/stream');

async function setup() {
  const mutex = new Mutex();

  const location = `${tmpdir()}/run`;
  const app = express();

  expressWebSocket(app, null, {
    perMessageDeflate: false
  });

  let child = null;

  app.ws('/start', async (ws, _req) => {
    const wsStream = webSocketStream(ws);

    try {
      const release = await mutex.acquire();

      await new Promise((resolve, reject) => {
        wsStream.on('error', console.error);
        wsStream.on('close', () => {
          if (child != null) {
            child.kill('SIGINT');
          }
          release();
        });

        let stderr = [];
        child = forkCode(
          `const Suite = require('${require.resolve('./common/suite')}');

          (async () => { 
            const suite = new Suite('${location}');
            await suite.init();
            suite.printRunQueueSummary();
            await suite.run();
          })()`,
          {
            stdio: 'pipe'
          }
        );

        child.stderr.on('data', data => {
          stderr.push(data.toString('utf-8'));
        });
        wsStream.pipe(child.stdin);
        child.stdout.pipe(wsStream);
        child.stderr.pipe(wsStream);

        child.on('exit', (code, signal) => {
          child = null;
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`CODE: ${code} SIGNAL: ${signal}`));
          }
        });
      });
    } catch (e) {
      console.error(e);
    } finally {
      ws.close();
    }
  });

  app.post('/stop', async (req, res) => {
    try {
      if (child != null) {
        child.kill('SIGINT');
      }

      child.on('exit', () => {
        child = null;
        res.send('OK');
      });
    } catch (e) {
      res.status(500);
      res.send(e.stack);
    }
  });

  app.post('/upload', async (req, res) => {
    const release = await mutex.acquire();
    const downloadLocation = join(location, '..', 'download');

    try {
      await promiseStream(req.pipe(tar.extract(downloadLocation)));

      // Cache check
      for (let name of ['image', 'suite', 'config.json']) {
        if (await pathExists(join(downloadLocation, name))) {
          await move(join(downloadLocation, name), join(location, name), { overwrite: true });
        }
      }

      res.status(200);
    } catch (e) {
      res.write(`error: ${e.message}`);
      res.status(500);
    } finally {
      await remove(downloadLocation);
      res.end();
      release();
    }
  });

  return app;
}

(async function main() {
  const PORT = 80;

  const server = await setup();

  server.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });
})();