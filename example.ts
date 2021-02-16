process.env["DEBUG"] = "ace-connector";

import { AceConnector } from "./src";

export const aceConnector = new AceConnector();

(async () => {
    await aceConnector.connect();
    console.log("Ace Stream installed!");
})()
    .catch(err => { throw err; });


// currently using for testing library
// todo add real example