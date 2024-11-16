import fs from "fs";
import path from "path";
import { parseWmo } from "@r-hurricane/wmo-parser";
import config from "./config.json" with { type: "json" };
import Database from "./database.js";
import Downloader from "./downloader.js";
import Notifier from "./notifier.js";
import createLogger from "./logging.js";

const logger = createLogger('WmoFetch');

const ROOT_PATH = path.resolve(config.dataPath);

async function checkUpdate() {
	// Open DB + create downloader
	const db = new Database();
	const downloader = new Downloader();
	
	// Get last record
	const lastSavedTcpod = db.getLatest();
	
	// Fetch the latest TCPOD headers
	const latestModified = await downloader.fetchTcpodModified();
	
	// If the latest modified date and last saved modified dates are the same, then no need to download
	if (lastSavedTcpod && latestModified === lastSavedTcpod.modified) {
		logger.info(`No Update: Latest TCPOD modified date ${latestModified} matches last saved TCPOD modified date ${lastSavedTcpod.modified}.`);
		return;
	}
	logger.info(`Latest TCPOD modified date ${latestModified} differs from last saved TCPOD modified date ${lastSavedTcpod?.modified}.`);
	
	// Fetch the latest TCPOD text
	const latestRaw = await downloader.fetchTcpodText();
	
	// Parse the latest TCPOD
	logger.debug('Parsing latest TCPOD');
	const latestJson = parseWmo(latestRaw);
	
	// Confirm the parsed object is not null
	if (!latestJson)
		throw new Error(`Failed to parse latest TCPOD:\n==========\n${latestRaw}\n==========`);
	
	// Confirm the designator
	const designator = latestJson.header?.designator;
	if (designator !== 'NOUS42')
		throw new Error(`WMO Designator was expected to be NOUS42 but received ${designator}`);
	
	// Confirm the station exists
	const station = latestJson.header?.station;
	if (!station)
		throw new Error(`WMO Station was expected to exist but received ${station}`);
	
	// Get the AWIPS type
	const awips = latestJson.message?.header?.awips?.toLowerCase();
	const awipsStr = awips ? `${awips.substring(0, 3)}.${awips.substring(3)}.` : '';
	
	// Confirm the tcpod number	
	const tcpodNo = latestJson.message?.header?.tcpod?.full;
	if (!tcpodNo || tcpodNo.trim().length <= 0)
		throw new Error('TCPOD Number was missing');
	
	// Confirm issued date
	const issuedDate = latestJson.message?.header?.issued?.date;
	const issued = issuedDate?.getTime();
	if (!issued || isNaN(issued))
		throw new Error('Missing TCPOD Issued Date, or was NaN');
	
	// Compare the issued time
	if (lastSavedTcpod && issued === lastSavedTcpod.issued && tcpodNo === lastSavedTcpod.tcpodNo) {
		logger.info(`Latest tcpod ${tcpodNo} issued at ${issued} matches last saved tcpod ${lastSavedTcpod.tcpodNo} issued at ${lastSavedTcpod.issued}. Updating DB.`);
		db.updateIssued(latestModified, issued);
		return;
	}
	logger.info(`Latest tcpod ${tcpodNo} issued at ${issued} does not match last saved tcpod ${lastSavedTcpod?.tcpodNo} issued at ${lastSavedTcpod?.issued}`);
	
	// Generate file path
	const issuedDateIso = issuedDate.toISOString();
	const fileDate = issuedDateIso.substring(0, issuedDateIso.lastIndexOf(':')).replace(':', '');
	const fileDir = path.join(ROOT_PATH, `${issuedDate.getFullYear()}`, `${designator.substring(0, 2).toLowerCase()}`);
	const fileName = `${designator.toLowerCase()}.${station.toLowerCase()}.${awipsStr}${fileDate}`;
	const filePath = path.join(fileDir, fileName);
	
	// Check folder exists
	if (!fs.existsSync(fileDir)) {
		logger.debug('Creating save directory: ' + fileDir);
		fs.mkdirSync(fileDir, { recursive: true });
	}
	
	// Write raw text to text file
	logger.debug(`Saving new TCPOD txt to file system: ${filePath}.txt`);
	fs.writeFileSync(filePath + '.txt', latestRaw);
	
	// Write json to file
	logger.debug(`Saving new TCPOD json to file system: ${filePath}.json`);
	fs.writeFileSync(filePath + '.json', JSON.stringify(latestJson));
	
	// Finally, insert a new row into the database
	db.insertNew(latestModified, latestJson, filePath);

	// Send new TCPOD notification
	logger.info('Successfully processed new TCPOD.');
	await new Notifier().sendSuccessEmail(latestJson);
}

(async () => {
	// Ensure starting message shows first
	const startMsg = ' WmoFetch Starting ';
	logger.debug(startMsg.padStart(50-startMsg.length, '=').padEnd(50, '='));
	await new Promise(r => setTimeout(r, 100));

	try {
		await checkUpdate();
	} catch(err) {
		logger.error('Error while processing update check');
		logger.error(err);
		await new Notifier().sendFailureEmail(err);
	}

	// And ensure the ending message shows last
	await new Promise(r => setTimeout(r, 100));
	const endMsg = ' WmoFetch Complete ';
	logger.debug(endMsg.padStart(50-endMsg.length, '=').padEnd(50, '='));
})();