"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AceConnector = exports.ConnectionError = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const events_1 = require("events");
const child_process_1 = __importDefault(require("child_process"));
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
const pipeline = util_1.default.promisify(stream_1.default.pipeline);
// TODO PERHAPS EXECA
const execFilePromise = util_1.default.promisify(child_process_1.default.execFile);
const DOWNLOAD_ASSETS_CONFIG = {
    base: `https://raw.githubusercontent.com/zardoy/ace-connector/master/src/download-links/`,
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
        return (await got_1.default(`${DOWNLOAD_ASSETS_CONFIG.base}/${component}`)).body.trim();
    }
    /**
     * Downloads Ace Stream
     * @param savePath Path to save executable file. It's recommended to use temp path
     */
    static async downloadAceStreamInstaller(savePath) {
        const downloadUrl = await AceConnector.getDownloadComponentUrl("installer");
        await pipeline(got_1.default.stream(downloadUrl)
            .on("downloadProgress", progress => {
            console.log(progress.percent * 100 + "%");
        }), fs_1.default.createWriteStream(savePath));
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
        try {
            // todo-low response type
            // todo-high check with timeout
            let { statusCode, body: data } = await got_1.default(`http://localhost:${this.httpApiPort}/webui/api/service?method=get_version`, {
                responseType: "json"
            });
            if (data.error)
                throw new Error(data.error);
            this.updateStatus({
                status: "connected",
                version: data.result.version
            });
            return true;
        }
        catch (err) {
            this.updateStatus({ status: "disconnected" });
            return false;
        }
    }
    /**
     * Fire it from `patchAvailable` event to patch AceStream
     */
    async patchAceStream() {
        if (!this.engineExecutable) {
            // engine isn't found
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
    async connectInternal() {
        // -- CHECKING WETHER ACE STREAM IS INSTALLED OR NOT
        // REGISTRY VALUE
        const engineExecPath = await (async () => {
            if (this.options.aceEngineExecutablePath) {
                return this.options.aceEngineExecutablePath;
            }
            console.time("registry_read");
            const { keyValue: engineExecPath } = await winreg_wrapper_1.getRegistryKey("HKCU\\SOFTWARE\\AceStream\\EnginePath");
            if (!engineExecPath) {
                throw new ConnectionError("ACE_ENGINE_NOT_INSTALLED", "Can't read registry value");
            }
            console.timeEnd("registry_read");
            return engineExecPath;
        })();
        if (!fs_1.default.existsSync(engineExecPath)) {
            throw new ConnectionError("ACE_ENGINE_NOT_INSTALLED", `Can't find ace engine from registry path: ${engineExecPath}`);
        }
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
            this.portFileObserver = fs_1.default.watch(engineDir, (eventName, filename) => {
                if (filename !== path_1.default.basename(enginePortFile))
                    return;
                // note: if file just created, then "change" event will be emited
                if (eventName === "change") {
                    this.checkHttpConnection();
                }
                else if (!fs_1.default.existsSync(enginePortFile)) { // engine stopped
                    this.updateStatus({ status: "disconnected" });
                }
            });
        })();
        // -- CHECK FOR PATCHES
        const skipEngineStartFromPatch = await (async () => {
            if (!this.options.checkForPatch)
                return;
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
            if (!patchNeeded)
                return;
            this.emit("patchAvailable");
            await this.patchAceStream();
        })();
        // -- CONNECT ENGINE
        await (async () => {
            const startAceEngine = async () => {
                if (this.options.autoStart && this.options.autoStart.onConnect) {
                    //todo implement retries
                    const { stderr, stdout } = await execFilePromise(engineExecPath);
                    // throw new ConnectionError("ACE_ENGINE_RUN_FAIL", `Can't open ace engine executable (${aceEngineExecPath}). You can try to open it manually.`);
                }
                else {
                    throw new ConnectionError("ACE_ENGINE_NOT_STARTED", "With these options Ace Engine needs to be started manually");
                }
            };
            // if engine port doesn't exist - it 100% need to be started
            if (!fs_1.default.existsSync(enginePortFile)) {
                await startAceEngine();
            }
            else {
                // but sometimes ace port file exists even if engine wasn't started so we need additional check 
                // FINDING ENGINE PROCESS
                // TODO-moderate FIX WEIRD RUSSIAN CHARACTERS 
                // let runningProcesses = (await si.processes()).list;
                // const aceEngineProcessFound = runningProcesses.find((process) => process.path === engineExecPath);
                const processes = await ps_list_1.default();
                const engineProcess = processes.find(process => {
                    return process.name === path_1.default.basename(this.engineExecutable.path);
                });
                if (engineProcess) {
                    // ASSUMED THAT ACE ENGINE WILL FIX PORT FILE
                    // todo-moderate review
                    await cross_port_killer_1.killer.killByPid(engineProcess.pid.toString());
                    // if (!await this.checkHttpConnection()) {
                    //     // todo: kill process and start again
                    // }
                }
                await startAceEngine();
            }
        })();
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
