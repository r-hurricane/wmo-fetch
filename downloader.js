import config from "./config.json" with { type: "json" };
import createLogger from "./logging.js";

const logger = createLogger('Download');

export default class Downloader {
    async fetchTcpod(headOnly) {
        const url = config.baseUrl + config.wmoFiles[0];
        return await fetch(url, { method: headOnly ? 'HEAD' : 'GET' });
    }

    async fetchTcpodModified() {
        logger.debug('Fetching latest TCOPD modifed date');
        const tcpod = await this.fetchTcpod(true);
        const modTxt = tcpod.headers.get('Last-Modified');
        if (!modTxt)
            throw Error('Failed to get latest TCPOD last-modified header from NOAA');
        return new Date(modTxt).getTime();
    }

    async fetchTcpodText() {
        logger.debug('Fetching latest TCOPD');
        const resp = await this.fetchTcpod(false);
        const txt = await resp.text();
        if (!txt)
            throw new Error('Failed to retreive latest TCPOD txt from NOAA');
        return txt;
    }
}