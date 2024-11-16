import { DatabaseSync } from 'node:sqlite';
import fs from "fs";
import config from "./config.json" with { type: "json" };
import createLogger from "./logging.js";

const logger = createLogger('Database');

export default class FetchDatabase {

    #isNew = false;
    #handle = null;

    constructor() {
        logger.debug(`Opening database: ${config.databaseFile}`);

        this.#isNew = fs.existsSync(config.databaseFile);
        this.#handle = new DatabaseSync(config.databaseFile);

        if (!this.#handle)
            throw new Error('Failed to create database.');

        if (this.#isNew)
            return;

        logger.debug('Creating new database schema.');
        this.#handle.exec(`CREATE TABLE NOUS42 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            modified INTEGER,
            issued INTEGER,
            tcpodNo TEXT,
            updated INTEGER,
            filePath TEXT
        );`);
        this.#handle.exec(`CREATE UNIQUE INDEX UX_NOUS42_modified ON NOUS42(issued);`);
        this.#handle.exec(`CREATE UNIQUE INDEX UX_NOUS42_issued ON NOUS42(issued);`);
    }

    getLatest() {
        return this.#handle.prepare('SELECT * FROM NOUS42 ORDER BY issued DESC LIMIT 1').get();
    }

    updateIssued(latestModified, issued) {
        logger.debug(`Updating ${issued} modified to ${latestModified}`);
        const upModStmt = this.#handle.prepare('UPDATE NOUS42 SET modified=@modified WHERE issued=@issued');
        upModStmt.run({'modified': latestModified, 'issued': issued});
    }

    insertNew(latestModified, latestJson, filePath) {
        logger.debug(`Inserting new TCPOD ${latestJson.message.header.tcpod.full}`);
        const dbInsertStmt = this.#handle.prepare('INSERT INTO NOUS42(modified, issued, tcpodNo, updated, filePath) VALUES (@modified, @issued, @tcpodNo, @updated, @filePath);');
        dbInsertStmt.run({
            'modified': latestModified,
            'issued': latestJson.message.header.issued.date.getTime(),
            'tcpodNo': latestJson.message.header.tcpod.full,
            'updated': latestJson.message.header.correction || latestJson.message.header.amendment ? 1 : 0,
            'filePath': filePath
        });
    }
}