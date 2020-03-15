const Apify = require('apify');

const { log } = Apify.utils;
const sourceUrl = 'https://www.folkhalsomyndigheten.se/smittskydd-beredskap/utbrott/aktuella-utbrott/covid-19/aktuellt-epidemiologiskt-lage/';
const LATEST = 'LATEST';

Apify.main(async () => {
    const requestQueue = await Apify.openRequestQueue();
    const kvStore = await Apify.openKeyValueStore('COVID-19-SWEDEN');
    const dataset = await Apify.openDataset('COVID-19-SWEDEN-HISTORY');

    await requestQueue.addRequest({ url: sourceUrl });
    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        useApifyProxy: true,
        apifyProxyGroups: ['SHADER'],
        handlePageTimeoutSecs: 60 * 2,
        handlePageFunction: async ({ $ }) => {
            log.info('Page loaded.');
            const now = new Date();

            const rows = $($('#content-primary table')[0]).find('tr').get();
            rows.shift(); // remove title
            const totalRow = rows.pop();

            const infectedByRegion = rows.map((r) => {
                const columns = $(r).find('td');
                const region = $(columns[0]).text();
                const infectedCount = parseInt($(columns[1]).text(), 10);
                return {
                    region,
                    infectedCount,
                };
            });

            const data = {
                infected: $($(totalRow).find('td')[1]).text(),
                infectedByRegion,
                sourceUrl,
                lastUpdatedAtApify: new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, now.getMinutes())).toISOString(),
                readMe: 'https://apify.com/tugkan/covid-se',
            };

            // Compare and save to history
            const latest = await kvStore.getValue(LATEST) || {};
            delete latest.lastUpdatedAtApify;
            const actual = Object.assign({}, data);
            delete actual.lastUpdatedAtApify;

            if (JSON.stringify(latest) !== JSON.stringify(actual)) {
                log.info('Data did change :( storing new to dataset.');
                await dataset.pushData(data);
            }

            await kvStore.setValue(LATEST, data);
            log.info('Data stored, finished.');
        },

        // This function is called if the page processing failed more than maxRequestRetries+1 times.
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed twice.`);
        },
    });

    // Run the crawler and wait for it to finish.
    await crawler.run();

    console.log('Crawler finished.');
});
