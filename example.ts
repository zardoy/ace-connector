import { AceConnector } from "ace-connector";
export const aceEngine = new AceConnector({
    // default settings
    startEngineOnConnect: true, //will automatically start the engine on aceEngine.connect() if it not started yet
    startEngineRetries: 3, // can be zero
    checkBrowserAds: true, // see below
    httpPort: 6878, // default port for http API
    autoReconnect: true // see below
});
const installAceStream = async () => {
    await AceConnector.downloadInstaller();
    // open the installer
};
aceEngine.on("starting", () => {
    // engine is starting
    // update UI if needed
});
aceEngine.on("connect", () => {
    // ace engine connected successfully
    aceEngine.version; // connected engine version
});
aceEngine.on("disconnect", () => {
    // emits only if ace engine was connected

    // update UI status to disconnected
});
aceEngine.on("confirmRequired", async ({ type, message }): Promise<boolean> => {//must be defined
    // ace old version, ace auto updates enabled, ace patch available
    const userDecisionResult = await userConfirmDialog(message);
    return userDecisionResult;
});
const updateConnection = async () => {
    try {
        await aceEngine.connect();
    } catch (err) {
        if (!err.connectionError) throw err;
        if (err.NeedsInstall) {
            // suggest Ace Stream installation to user
            // if user agree to install
            installAceStream();
        } else {
            // show error to user:
            // err.techReason - detailed description of the error
            // err.message - error in general
            // err.suggestion
        }
    }
};

updateConnection().catch(err => console.error(err));