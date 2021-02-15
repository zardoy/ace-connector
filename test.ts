import axios from "axios";
import promiseRetry from "promise-retry";
import axiosRetry from "axios-retry";
import cheerio from "cheerio";

const main = async () => {
    axiosRetry(axios, { retries: 3 });
    // https://stackoverflow.com/questions/14728038/disabling-the-large-file-notification-from-google-drive
    // todo use drive-api? https://developers.google.com/drive/api/v3/manage-downloads#node.js
    const { data, headers } = await axios.get(
        "https://drive.google.com/uc?export=download&id=1PprErmACZnYmTPGoQST9Yy5ECYsOoLQq",
        {
            responseType: "stream"
        }
    );
    const contentType: string = headers["content-type"];
    if (contentType.includes("text/html")) {
        
    }
}

main().catch(err => {throw err})

// SI PROCESS BUG

// import si from "systeminformation";
// //@ts-ignore
// // import psList from "ps-list";

// (async () => {
//     // const processes = (await si.processes()).list;
//     // const processName = processes.find(process => process.path.includes("Desktop"))!.name;
//     const processes = await psList();
//     //@ts-ignore
//     console.log(processes.map(p => p.name).filter(p => p.includes("привет")));
// })();