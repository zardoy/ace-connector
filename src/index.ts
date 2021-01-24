import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import * as child_process from "child_process";
import * as util from "util";
import si from "systeminformation";
import md5File from "md5-file";
import axios from "axios";
import { setSync as setCodePageSync } from "stdcp";

import { getRegistryKey } from "./winreg-wrapper";

const execFilePromise = util.promisify(child_process.execFile);
const { execSync } = child_process;

const DOWNLOAD_ASSETS_CONFIG = {
    base: `https://raw.githubusercontent.com/zardoy/ace-connector/master/src/download-links/`,
    components: {
        installer: true,
        patch: true
    }
};

type ArrType<T> = T extends Array<infer U> ? U : never;

// import si from "systeminformation";

type connectionErrorType = "ACE_ENGINE_NOT_INSTALLED" | "ACE_ENGINE_READ_PORT_ERROR" | "ACE_ENGINE_RUN_FAIL" | "ACE_ENGINE_NOT_STARTED";

type engineStatusType = "checking" | "disconnected" | "starting" | "connected";

export class ConnectionError extends Error {
    constructor(public type: connectionErrorType, public reason: string) {
        super();
        this.name = "ConnectionError";
    }
}

const defaultSettings = {
    startEngineOnConnect: true,
    startEngineRetries: 3,
    checkBrowserAds: true,
    httpPort: 6878,
    rejectExecuteOnCheckingStatus: true
};

export class AceConnector extends EventEmitter {
    settings: typeof defaultSettings;

    engineStatus: engineStatusType = "disconnected";
    engineConnected: boolean = false;

    engineDir: string | undefined;
    engineVersion: number | undefined;
    portFileObserver: fs.FSWatcher | undefined;

    constructor(userSettings?: Partial<typeof defaultSettings>) {
        super();
        if (process.platform !== "win32") console.warn("Warning! We support only windows platform.");
        this.settings = { ...userSettings, ...defaultSettings };
    }

    private onEngineStart() {
        this.engineStatus = "connected";
        this.engineConnected = true;
        this.emit("connect");
    }

    private onEngineDisconnect() {
        this.engineStatus = "disconnected";
        this.engineConnected = false;
        this.emit("disconnect");
    }

    async checkHttpConnection() {
        try {
            let { status, data } = await axios.get(`http://localhost:6878/webui/api/service?method=get_version`);//check with timeout
            if (data.error) throw new Error(data.error);
            this.engineVersion = data.result.version;
            this.engineStatus = "connected";
            this.engineConnected = true;
            this.emit("connect");
            return true;
        } catch (err) {
            if (this.engineStatus === "connected") {
                this.onEngineDisconnect();
            }
            return false;
        }
    }

    async getDownloadComponentLink(component: keyof typeof DOWNLOAD_ASSETS_CONFIG.components): Promise<string> {
        return (await axios.get(`${DOWNLOAD_ASSETS_CONFIG.base}/${component}`)).data;
    }

    private async patchAceStream() {
        const downloadPatchLink = await this.getDownloadComponentLink("patch");
        const { data } = await axios.get(downloadPatchLink);
    }

    async connect(): Promise<void> {
        this.engineStatus = "checking";
        try {
            setCodePageSync(65001);
            const currentCHCP = execSync("chcp").toString();
            console.log(currentCHCP);
            // CHECKING WETHER ACE STREAM IS INSTALLED
            // 1. REGISTRY VALUE
            const { keyValue: aceEngineExecPath } = await getRegistryKey("HKCU\\SOFTWARE\\AceStream\\EnginePath");
            if (!aceEngineExecPath) {
                throw new ConnectionError("ACE_ENGINE_NOT_INSTALLED", "Can't read registry value");
            }
            // 2. ENGINE EXE FILE
            if (!fs.existsSync(aceEngineExecPath)) {
                throw new ConnectionError(
                    "ACE_ENGINE_NOT_INSTALLED",
                    `Can't find ace engine executable on this path: ${aceEngineExecPath}`
                );
            }
            // CHECK END
            this.engineDir = path.dirname(aceEngineExecPath);

            let enginePortFile = path.join(this.engineDir, "acestream.port");
            // DROPING PREV FILE OBSERVER IF EXISTS
            if (this.portFileObserver) {
                this.portFileObserver.close();
                this.portFileObserver = undefined;
            }
            // CREATING NEW ONE TO TRACK ACE ENGINE STATUS
            this.portFileObserver = fs.watch(this.engineDir, (eventName, filename) => {
                if (filename !== path.basename(enginePortFile)) return;
                // note: if file just created, then "change" event will be emited
                if (eventName === "change") {
                    this.checkHttpConnection();
                } else if (!fs.existsSync(enginePortFile)) {// engine stopped
                    this.onEngineDisconnect();
                }
            });

            // CHECK BROWSER ADS
            if (this.settings.checkBrowserAds) {
                const relativePathToPatchFile = "lib/acestreamengine.CoreApp.pyd";
                const fullPathToPachFile = path.join(this.engineDir, relativePathToPatchFile);
                // todo action if this file doesn't exist
                if (
                    fs.existsSync(fullPathToPachFile) &&
                    //cheking file md5 hash
                    await md5File(fullPathToPachFile) !== "ed68c75e473fe2642dbaa058fde1a912"
                ) {
                    // todo prompt user first
                    await this.patchAceStream();
                }
            }

            const startAceEngine = async (): Promise<void> => {
                if (this.settings.startEngineOnConnect) {
                    //todo implement retries
                    this.engineStatus = "starting";
                    const { stderr, stdout } = await execFilePromise(aceEngineExecPath);

                    // throw new ConnectionError("ACE_ENGINE_RUN_FAIL", `Can't open ace engine executable (${aceEngineExecPath}). You can try to open it manually.`);
                } else {
                    throw new ConnectionError("ACE_ENGINE_NOT_STARTED", "settings of ace connector");
                }
            };

            // if engine port doesn't exist - it 100% need to be started
            if (!fs.existsSync(enginePortFile)) {
                return startAceEngine();
            } else {
                // but sometimes ace port file exists even if engine wasn't started so we need additional check 
                // 3. FINDING ENGINE PROCESS
                let currentProcesses = await si.processes();
                const aceEngineProcess = currentProcesses.list.find((process) => process.path === aceEngineExecPath);
                if (aceEngineProcess) {
                    if (!await this.checkHttpConnection()) {
                        // todo: kill process and start again
                    }
                } else {
                    return await startAceEngine();
                }
            }
        } catch (err) {
            throw err;
        }
    }

    execute() {
        // execute methods on Ace Stream Engine
    }
};