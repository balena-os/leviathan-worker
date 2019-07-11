/*
 * Copyright 2018 balena
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

const retry = require('bluebird-retry');
const utils = require('../common/utils');
const isNumber = require('lodash/isNumber');
const { fs } = require('mz');
const rp = require('request-promise');
const { Progress } = require('resin-cli-visuals');
const { promiseStream } = require('./utils');

module.exports = class Worker {
  constructor(deviceType, url) {
    this.deviceType = deviceType;
    this.url = url;
  }

  flash(os) {
    return new Promise(async (resolve, reject) => {
      await os.configure();

      const progress = new Progress('Flashing image');

      const req = rp.post({ uri: `http://${this.url}/dut/flash` });

      req.catch(error => {
        reject(error);
      });
      req.finally(() => {
        if (lastStatus !== 'done') {
          reject(new Error('Unexpected end of TCP connection'));
        }

        resolve();
      });

      let lastStatus;
      req.on('data', data => {
        const computedLine = RegExp('(.*): (.*)').exec(data.toString());

        if (computedLine) {
          if (computedLine[1] === 'error') {
            req.cancel();
            reject(new Error(computedLine[2]));
          }

          if (computedLine[1] === 'progress') {
            // Hide any errors as the lines we get can be half written
            const state = JSON.parse(computedLine[2]);
            if (state != null && isNumber(state.percentage)) {
              progress.update(state);
            }
          }

          if (computedLine[1] === 'status') {
            lastStatus = computedLine[2];
          }
        }
      });

      await promiseStream(fs.createReadStream(os.image.path).pipe(req));
    });
  }

  async select(worker) {
    await rp.post({ uri: `http://${this.url}/select`, body: worker, json: true });
  }

  async on() {
    await rp.post(`http://${this.url}/dut/on`);
  }

  async off() {
    await rp.post(`http://${this.url}/dut/off`);
  }

  async network(network) {
    await rp.post({ uri: `http://${this.url}/dut/network`, body: network, json: true });
  }

  async proxy(proxy) {
    return rp.post({ uri: `http://${this.url}/proxy`, body: proxy, json: true });
  }

  async ip(target) {
    return rp.get({ uri: `http://${this.url}/dut/ip`, body: { target }, json: true });
  }

  async teardown() {
    return rp.post({ uri: `http://${this.url}/teardown`, json: true });
  }

  async executeCommandInHostOS(
    command,
    target,
    timeout = {
      interval: 10000,
      tries: 30
    }
  ) {
    return retry(
      async () => {
        let ip = /.*\.local/.test(target) ? await this.ip(target) : target;

        const result = await utils.executeCommandOverSSH(`source /etc/profile ; ${command}`, {
          host: ip,
          port: '22222',
          username: 'root'
        });

        if (result.code !== 0) {
          throw new Error(
            `"${command}" failed. stderr: ${result.stderr}, stdout: ${result.stdout}, code: ${
              result.code
            }`
          );
        }

        return result.stdout;
      },
      {
        max_tries: timeout.tries,
        interval: timeout.interval,
        throw_original: true
      }
    );
  }
};