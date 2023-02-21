import * as fs from 'fs';
import { IncomingMessage } from 'http';
import config from '../config';
import { extname, join } from 'path';
import * as extract from 'extract-zip'; // npm i extract-zip
import { createGunzip } from 'zlib';
import { Stream } from 'stream';
import * as util from 'util';

const pipeline = util.promisify(Stream.pipeline);

class Host {

    options = {}

    constructor() { }

    private adapter: { [protocol: string]: Promise<any> } = {
        'http:': import('http'),
        'https:': import('https'),
    };

    public async fetchImage(url: knownURL): Promise<string> {
        const protocol = await this.adapter[url.url.protocol]
        const filename = await new Promise<string>((resolve, reject) => {
            protocol.get(url.url, this.options, function (response: IncomingMessage) {
                let contentType = response.headers['content-type']
                console.debug(`Content type is: ${contentType}`);
                if (contentType === undefined) {
                    throw new Error('Could not determine file name from GET response');
                }

                //application/zip
                //application/octect-stream
                let extension = 'img';
                console.log(contentType.split('/')[1])
                let type = contentType.split('/')[1]
                switch (type) {
                    case "zip":
                        extension = 'zip'
                        break;
                    case "octet-stream":
                        extension = 'img'
                        break;
                    case "gzip":
                        extension = 'gz'
                        break;
                    default:
                        throw new Error(`Unrecognized content-type: ${type}`)
                }

                //const file = fs.createWriteStream(`image.${extension}`);
                const filename = `${config.worker.runtimeConfiguration.worker.workdir}/fetchedImage.${extension}`;
                console.debug(`Writing file to ${filename}`);
                const file = fs.createWriteStream(filename);

                response.pipe(file);

                file
                    .on("finish", () => {
                        file.close();
                        console.debug("Download Completed");
                        resolve(filename)
                    })
                    .on('error', (err) => {
                        fs.promises.unlink(`${config.worker.runtimeConfiguration.worker.workdir}`);
                        reject()
                    });
            });
        });
        return filename
    }
}

class Jenkins extends Host {
    options = {
        auth: `${process.env.JENKINS_USER}:${process.env.JENKINS_PASS}`
    }
}

class BalenaCloud extends Host {
    options = {}
    // https://api.balena-cloud.com/download?deviceType=coral-dev&version=2.108.26&fileType=.zip&developmentMode=true
}

class Localhost extends Host {
    options = {}
}

type knownURL = {
    url: URL,
    type: Host
};

function setHostname(hostname: URL["hostname"]): Host {
    switch (hostname) {
        case 'jenkins.product-os.io':
            return new Jenkins()
        case 'localhost':
            return new Localhost()
        default:
            return new BalenaCloud();
    }
}

/**
 * Parse provided image to determine fetch mechanism and authentication
 * @param url - string defining the target URL of the image
 */
async function parseUrl(url: string): Promise<knownURL> {
    try {
        const domain = (new URL(url));
        const filteredUrl: knownURL = { url: domain, type: setHostname(domain.hostname) }
        return filteredUrl;
    } catch (error) {
        throw error;
    }
}



async function decompress(file: string) {
    const ext = extname(file);
    switch (ext) {
        case '.zip':
            await extract(file, { dir: config.worker.runtimeConfiguration.worker.workdir });
            // what will the file be called??
            // will be output as file - zip so must rename
            await fs.promises.rename(config.worker.runtimeConfiguration.worker.workdir, config.worker.runtimeConfiguration.worker.imageName);
            break;
        case '.gzip':
            await pipeline(
                fs.createReadStream(file),
                createGunzip(),
                fs.createWriteStream(join(config.worker.runtimeConfiguration.worker.workdir, config.worker.runtimeConfiguration.worker.imageName))
            )
            break;
        case '.img':
            await fs.promises.rename(file, join(config.worker.runtimeConfiguration.worker.workdir, config.worker.runtimeConfiguration.worker.imageName));
            break;
        default:
            throw new Error(`Unrecognized file type: ${ext}`)
    }
}

/**
 * Function to download OS images
 * @param imageURL - string defining the target URL of the image
 */
export async function downloadImage(imageUrl: string): Promise<string> {
    const URL: knownURL = await parseUrl(imageUrl);
    const name = await URL.type.fetchImage(URL)
    // decompress
    console.log(URL.url)
    return name
}









// testing
(async () => {
    try {
        console.log('starting to download')
        // await downloadImage('https://jenkins.product-os.io/job/yocto-nanopi-r2s/lastSuccessfulBuild/artifact/deploy-jenkins/image/balena.img.zip');
        let file = await downloadImage('https://api.balena-cloud.com/download?deviceType=coral-dev&version=2.108.26&fileType=.zip&developmentMode=true');
        await decompress(file)
    } catch (e) {
        console.error(e)
    }
})();