"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceConnector = exports.ConnectionError = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const events_1 = require("events");
const util_1 = __importDefault(require("util"));
const md5_file_1 = __importDefault(require("md5-file"));
const events_2 = require("events");
const cross_port_killer_1 = require("cross-port-killer");
const os_1 = __importDefault(require("os"));
const winreg_wrapper_1 = require("./winreg-wrapper");
const ps_list_1 = __importDefault(require("ps-list"));
const got_1 = __importDefault(require("got"));
const stream_1 = __importDefault(require("stream"));
const lodash_1 = require("lodash");
const execa_1 = __importDefault(require("execa"));
const debug_1 = __importDefault(require("@prisma/debug"));
const open_1 = __importDefault(require("open"));
const pipeline = util_1.default.promisify(stream_1.default.pipeline);
// todo-low use package.json name
const debug = debug_1.default("ace-connector");
const DOWNLOAD_ASSETS_CONFIG = {
    base: `https://raw.githubusercontent.com/zardoy/ace-connector/main/src/download-links`,
    components: {
        installer: true,
        patchBrowserAds: true
    }
};
class ConnectionError extends Error {
    constructor(type, reason) {
        super();
        this.type = type;
        this.reason = reason;
        this.name = "ConnectionError";
    }
}
exports.ConnectionError = ConnectionError;
const defaultOptions = {
    autoStart: {
        onConnect: true,
        onSuspend: true,
    },
    maxStartRetries: 3,
    checkForPatch: true,
    httpPort: 6878,
    autoInstall: false
};
class AceConnector extends events_1.EventEmitter {
    constructor(userOptions) {
        super();
        /**
         * Represents the last status (useful is the real status is `checking`).
         * `null` in case if `connect()` wasn't called
         */
        this.lastConnectedStatus = null;
        this.engine = {
            status: "disconnected",
        };
        this.httpApiPort = 6878;
        if (process.platform !== "win32")
            throw new Error("Only Windows platform is supported.");
        this.options = lodash_1.defaultsDeep(defaultOptions, userOptions);
    }
    static async getDownloadComponentUrl(component) {
        const url = `${DOWNLOAD_ASSETS_CONFIG.base}/${component}`;
        debug("Getting component download url: " + url);
        return (await got_1.default(url)).body.trim();
    }
    /**
     * Downloads Ace Stream
     * @param savePath Path to save executable file. It's recommended to use temp path
     */
    static async downloadAceStreamInstaller(savePath) {
        debug("Starting AceStream download to " + savePath);
        const downloadUrl = await AceConnector.getDownloadComponentUrl("installer");
        await pipeline(got_1.default.stream(downloadUrl)
            .on("downloadProgress", progress => {
            console.log(progress.percent * 100 + "%");
        }), fs_1.default.createWriteStream(savePath));
        debug("Download complete");
    }
    /**
     * Use this instead of `this.emit("updateStatus", ...)`;
     */
    updateStatus(newEngineStatus) {
        if (newEngineStatus.status === "disconnected" ||
            newEngineStatus.status === "connected") {
            this.lastConnectedStatus = newEngineStatus.status;
        }
        this.engine = newEngineStatus;
        this.emit("updateStatus", newEngineStatus.status);
    }
    /**
     * Check wether Ace Engine is available on HTTP or not
     */
    async checkHttpConnection() {
        debug("Starting http API check");
        let statusCode;
        try {
            // todo-low response type
            // todo-high check with timeout
            let response = await got_1.default(`http://localhost:${this.httpApiPort}/webui/api/service?method=get_version`, {
                responseType: "json"
            });
            statusCode = response.statusCode;
            const data = response.body;
            if (data.error)
                throw new Error(data.error);
            this.updateStatus({
                status: "connected",
                version: data.result.version
            });
            // todo-moderate Checking http connection <- group : result (red | lime)
            debug("Check http connection success. Code: " + statusCode);
            return true;
        }
        catch (err) {
            debug("Checking http error. Status code " + statusCode);
            this.updateStatus({ status: "disconnected" });
            return false;
        }
    }
    /**
     * Fire it from `patchAvailable` event to patch AceStream
     */
    async patchAceStream() {
        debug("Starting auto-patch");
        if (!this.engineExecutable) {
            return;
        }
        const patchConfig = AceConnector.filesToPatch[0];
        const downloadPatchLink = await AceConnector.getDownloadComponentUrl(patchConfig.componentToDownloadAndReplace);
        // todo-high replace with write
        const filePathToPatch = path_1.default.resolve(this.engineExecutable.dir, patchConfig.relativePath);
        await fs_1.default.promises.unlink(filePathToPatch);
        await pipeline(got_1.default.stream(downloadPatchLink), fs_1.default.createWriteStream(filePathToPatch));
        // todo-moderate check md5 hash
        this.emit("autoPatchCompleted");
    }
    /**
     * Will skip download if executable already exists on this step
     */
    async installAceStream(savePath) {
        const installDownloadedAceStream = async () => {
            // todo-moderate autohotkey
            await execa_1.default(savePath, {
                stdio: "inherit"
            });
            this.emit("installComplete");
        };
        this.emit("beforeInstall");
        // todo rewrite with promises
        if (!fs_1.default.existsSync(savePath)) {
            await AceConnector.downloadAceStreamInstaller(savePath);
        }
        else {
            debug("Skipping installer downloading as it already downloaded: " + savePath);
        }
        let preventAutoInstallation = false;
        this.emit("installerDownloaded", {
            handleLaunchManually: () => {
                preventAutoInstallation = true;
                return installDownloadedAceStream;
            }
        });
        if (!preventAutoInstallation) {
            await installDownloadedAceStream();
        }
        else {
            debug("Auto installation prevent. Waiting for ");
        }
        await events_2.once(this, "installComplete");
    }
    async connect() {
        this.emit("updateStatus", "checking");
        try {
            await this.connectInternal();
        }
        catch (err) {
            if (this.options.autoInstall &&
                err instanceof ConnectionError &&
                err.type === "ACE_ENGINE_NOT_INSTALLED") {
                await this.installAceStream(path_1.default.join(os_1.default.tmpdir(), "ace-connector--ace-stream-installer.exe"));
                await new Promise(resolve => setTimeout(resolve, 1000));
                await this.connectInternal();
            }
            else {
                throw err;
            }
        }
    }
    async getEnginePid() {
        var _a;
        // TODO-moderate FIX WEIRD RUSSIAN CHARACTERS 
        // let runningProcesses = (await si.processes()).list;
        // const aceEngineProcessFound = runningProcesses.find((process) => process.path === engineExecPath);
        const processes = await ps_list_1.default();
        return (_a = processes.find(process => {
            return process.name === path_1.default.basename(this.engineExecutable.path);
        })) === null || _a === void 0 ? void 0 : _a.pid.toString();
    }
    async connectInternal() {
        // -- CHECKING WETHER ACE STREAM IS INSTALLED OR NOT
        // GET ACE STREAM ENGINE PATH
        debug("connection start");
        const { engineExecPath, source: pathSource } = await (async () => {
            if (this.options.aceEngineExecutablePath) {
                return {
                    source: "options",
                    engineExecPath: this.options.aceEngineExecutablePath
                };
            }
            const { keyValue: engineExecPath } = await winreg_wrapper_1.getRegistryKey("HKCU\\SOFTWARE\\AceStream\\EnginePath");
            if (!engineExecPath) {
                throw new ConnectionError("ACE_ENGINE_NOT_INSTALLED", "Can't read registry value");
            }
            return {
                engineExecPath,
                source: "registry"
            };
        })();
        debug(`Successfuly get engine exec path from ${pathSource}: ${engineExecPath}`);
        if (!fs_1.default.existsSync(engineExecPath)) {
            throw new ConnectionError("ACE_ENGINE_NOT_INSTALLED", `Can't find ace engine from registry path: ${engineExecPath}`);
        }
        debug("Engine exec exists");
        const engineDir = path_1.default.dirname(engineExecPath);
        this.engineExecutable = {
            path: engineExecPath,
            dir: engineDir
        };
        let enginePortFile = path_1.default.join(engineDir, "acestream.port");
        // -- WATCH ENGINE STATUS
        (() => {
            if (!this.options.autoStart)
                return;
            // DROPING PREV FILE OBSERVER IF EXISTS
            if (this.portFileObserver) {
                this.portFileObserver.close();
                this.portFileObserver = undefined;
            }
            // CREATING NEW ONE TO TRACK ACE ENGINE STATUS
            debug("Starting observer");
            this.portFileObserver = fs_1.default.watch(engineDir, (eventName, filename) => {
                var _a;
                if (filename !== path_1.default.basename(enginePortFile))
                    return;
                // note: if file just created, then "change" event will be emited
                if (eventName === "change") {
                    debug(`Port file touched. Checking connection`);
                    this.checkHttpConnection();
                }
                else if (!fs_1.default.existsSync(enginePortFile)) {
                    debug(`Port file removed. Engine has stopped`);
                    this.updateStatus({ status: "disconnected" });
                    if ((_a = this.options.autoStart) === null || _a === void 0 ? void 0 : _a.onSuspend) {
                        debug(`options.autoStart.onSuspend set to true, restarting engine...`);
                        void (async () => {
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            void this.connect();
                        })();
                    }
                }
            });
        })();
        // -- CHECK FOR PATCHES
        const skipEngineStartFromPatch = await (async () => {
            if (!this.options.checkForPatch)
                return;
            debug("Checking for patches");
            const patchNeededResults = await Promise.all(AceConnector.filesToPatch.map(fileToPatch => 
            // it returns Promise, not function
            (async () => {
                const pathToPachFile = path_1.default.join(engineDir, fileToPatch.relativePath);
                if (fs_1.default.existsSync(pathToPachFile) &&
                    //cheking file md5 hash
                    await md5_file_1.default(pathToPachFile) !== fileToPatch.expectedMD5) {
                    return true;
                }
                else {
                    return false;
                }
            })()));
            const patchNeeded = patchNeededResults.includes(true);
            if (!patchNeeded) {
                debug("No patches needed");
                return;
            }
            ;
            debug("Patches available. Starting auto-patch");
            this.emit("patchAvailable");
            await this.patchAceStream();
            debug("Patched successfully");
        })();
        // -- CONNECT ENGINE
        await (async () => {
            const startEngine = async () => {
                var _a;
                if ((_a = this.options.autoStart) === null || _a === void 0 ? void 0 : _a.onConnect) {
                    //todo implement retries
                    debug("Starting engine");
                    await open_1.default(engineExecPath);
                    debug("Engine should be started");
                    // throw new ConnectionError("ACE_ENGINE_RUN_FAIL", `Can't open ace engine executable (${aceEngineExecPath}). You can try to open it manually.`);
                }
                else {
                    throw new ConnectionError("ACE_ENGINE_NOT_STARTED", "With these options Ace Engine needs to be started manually");
                }
            };
            // if engine port doesn't exist - it 100% need to be started
            // todo-moderate rewrite with double-check
            if (!fs_1.default.existsSync(enginePortFile)) {
                debug("Port file doesn't exist");
                await startEngine();
            }
            else {
                debug("Port file exists. Searching for engine in process list");
                // but sometimes ace port file exists even if engine wasn't started so we need additional check 
                const enginePid = await this.getEnginePid();
                if (enginePid) {
                    debug("Engine process found");
                    const apiAvailable = this.checkHttpConnection();
                    if (!apiAvailable) {
                        debug("Api seems to be unavailable. Killing engine process");
                        await cross_port_killer_1.killer.killByPid(enginePid);
                        await startEngine();
                    }
                }
                else {
                    debug("Can't find engine process");
                    await startEngine();
                }
            }
        })();
    }
    async disconnect() {
        const enginePid = await this.getEnginePid();
        if (enginePid) {
            await cross_port_killer_1.killer.killByPid(enginePid);
            if (this.portFileObserver) {
                this.portFileObserver.close();
                this.portFileObserver = undefined;
            }
            this.updateStatus({ status: "disconnected" });
            return true;
        }
        return false;
    }
    execute() {
        // execute methods on Ace Stream Engine
    }
}
exports.AceConnector = AceConnector;
AceConnector.RECOMMENDED_VERSION = "3.1.32";
AceConnector.filesToPatch = [
    {
        relativePath: "lib/acestreamengine.CoreApp.pyd",
        expectedMD5: "ed68c75e473fe2642dbaa058fde1a912",
        componentToDownloadAndReplace: "patchBrowserAds"
    }
];
;
