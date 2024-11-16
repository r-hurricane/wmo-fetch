import config from "./config.json" with { type: "json" };
import sgMail from "@sendgrid/mail";
import createLogger from "./logging.js";

const logger = createLogger('Notifier');

sgMail.setApiKey(config.notifications.sendgridKey);

export default class Notifier {

    async sendMessage(subject, text, html) {
        const email = {
            to: config.notifications.to,
            from: config.notifications.from,
            subject,
            text,
            html
        };

        const logMessage = `Email Message <${email.from}> => <${email.to}>
-- Subject ${''.padStart(42, '-')}
${subject}
-- Text ${''.padStart(45, '-')}
${text}
-- HTML ${''.padStart(45, '-')}
${html}
${''.padStart(53, '-')}`;

        if (config.notifications.mock) {
            logger.info('!!! MOCK EMAIL - NOT SENT!!!\n' + logMessage);
        } else {
            logger.debug(logMessage);
            await sgMail.send(email);
        }
    }

    async sendSuccessEmail(tcpod) {
        const tcpodNo = tcpod.message.header.tcpod.full;
        const firstStorm = tcpod.message.atlantic.storms.at(0)?.name ||
            tcpod.message.pacific.storms.at(0)?.name;
        const updated = tcpod.message.header.amendment || tcpod.message.header.correction;

        const subject = `${updated ? 'Updated' : 'New'} TCPOD ${tcpodNo} - ${firstStorm ? 'Missions into ' + firstStorm : 'negative'}`;

        let text = `Successfully downloaded and parsed latest TCPOD ${tcpodNo}\n\n`;
        let html = `<p>${text}</p>`;

        const al = this.generateStormSummary('Atlantic', tcpod.message.atlantic);
        text += al.text;
        html += al.html;

        const pc = this.generateStormSummary('Pacific', tcpod.message.pacific);
        text += pc.text;
        html += pc.html;

        await this.sendMessage(subject, text, html);
    }

    generateStormSummary(basinName, basinData) {
        let text = `## ${basinName}\n`;
        let html = `<h2>${basinName}</h2>\n<ol>`;

        // Print NOTICE if remark has cancel but no cancel info
        const cancelPat = /(CANCEL|WILL NOT BE FLOWN)/i;
        if (basinData.remarks.filter(r => r && !!r.match(cancelPat)).length !== basinData.canceled.length) {
            const cTxt = '!! NOTICE: Remarks mention "Cancel" but the number of canceled flights did not match.';
            text += cTxt + '\n';
            html += `<li style="color: #ff9999;">${cTxt}</li>\n`;
        }

        // If there are no storms, there are negative flight requirements
        const storms = basinData.storms;
        if (!storms || storms.length <= 0) {
            return { text: text + '* Negative\n\n', html: html + '<li><strong>Negative</strong></li></ol></br>\n' };
        }

        // For each storm, pull out the name and flight summary
        for (let storm of storms) {
            text += `* ${storm.name}\n`;
            html += `<li><strong>${storm.name}</strong>\n<ul>`;

            // For each mission, print name and departure date/time
            for(let mission of storm.missions) {
                const dateTxt = mission.departure.date.toISOString()
                    .replace(':00.000Z', 'Z')
                    .replace('T', ' ');
                text += `* * ${mission.name} - ${dateTxt}\n`;
                html += `<li>${mission.name} - ${dateTxt}</li>\n`;
            }

            text += '\n';
            html += '</ul></li>\n';
        }

        return { text, html: html + '</ol>' };
    }

    async sendFailureEmail(err) {
        const subject = `Error Processing New TCPOD - ${err.message}`;
        let text = `${err}\n`;
        if (err.stack) {
            text += `\n-- Stack ${''.padStart(41, '-')}\n${err.stack}`;
        }
        if (err.cause) {
            text += `\n-- Cause ${''.padStart(41, '-')}\n${err.cause.stack || err.cause}`;
        }

        let html = `<h2>Download Error</h2><p>There was an error while downloading the latest TCPOD:</p>
<pre>${text.replace('<', '&lt;').replace('>', '&gt;')}</pre>`;
        text = `There was an error while checking and/or processing the latest TCPOD: ${text}`;

        await this.sendMessage(subject, text, html);
    }

}