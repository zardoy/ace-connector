import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import * as child_process from "child_process";
import * as util from "util";
import si from "systeminformation";
import md5File from "md5-file";
import axios from "axios";
import TypedEmitter from "typed-emitter";
import { killer } from "cross-port-killer";

import { getRegistryKey } from "./winreg-wrapper";
import psList from "ps-list";

// TODO PERHAPS EXECA
const execFilePromise = util.promisify(child_process.execFile);

const DOWNLOAD_ASSETS_CONFIG = {
    base: `https://raw.githubusercontent.com/zardoy/ace-connector/master/src/download-links/`,
    components: {
        installer: true,
        patchBrowserAds: true
    }
};
type DownloadableComponent = keyof typeof DOWNLOAD_ASSETS_CONFIG["components"]; 

type ConnectionErrorType = "ACE_ENGINE_NOT_INSTALLED" | "ACE_ENGINE_READ_PORT_ERROR" | "ACE_ENGINE_RUN_FAIL" | "ACE_ENGINE_NOT_STARTED";

type EngineConnectionStatus = "checking" | "disconnected" | "starting" | "connected";


export class ConnectionError extends Error {
    constructor(public type: ConnectionErrorType, public reason: string) {
        super();
        this.name = "ConnectionError";
    }
}

// TODO auto fill JSDoc defaults
export interface AceConnectorOptions {
    /**
     * If `true` will start engine on `connect()` (if it not started of course)
     */
    autoStartOnConnect: boolean,
    /**
     * Watch options for engine status
     */
    watchOptions: {
        /**
         * If `true` AceConnector will watch for engine status. It was disconnected you will get `updateStatus` event immediately
         */
        enabled: boolean,
        /**
         * If `true` AceConnector will started engine immediately after it was suspended
         */
        autoRestart: boolean
    },
    maxStartRetries: number,
    /**
     * AceStream opens ads in a browser when you request stream (TODO).
     * 
     * Checks if patches are available (only on `connect()`). If `true`, `patchAvailable` event will be emited.
     * To prevent auto downloading and applying the patch you need to return `false` from this event.
     * 
     * In case if AceStream is running and auto-patch requested, AceStream will be shutted down.
     */
    checkForPatch: boolean;
    /**
     * This port will be used for communication with Ace Stream Engine.
     */
    httpPort: number,
    /**
     * You can specify 
     * If not specified AceConnector will get this value from the registry
     */
    aceEngineExecutablePath?: string
}

const defaultOptions: AceConnectorOptions = {
    autoStartOnConnect: true,
    watchOptions: {
        enabled: true,
        autoRestart: true
    },
    maxStartRetries: 3,
    checkForPatch: true,
    httpPort: 6878
};

export type AceConnectorEvents = {
    /**
     * Emitted on connection status update
     */
    updateStatus(engineStatus: EngineConnectionStatus): void;
    /**
     * Emitted when patch available for Ace Stream.
     * @returns if `false` auto downloading and applying the patch will be prevented.
     */
    patchAvailable(): void | boolean;
    /**
     * Emitted when patching is done.
     * @returns `false` auto-start will be prevented
     */
    autoPatchCompleted(): void | boolean;
};

type EngineStatus = {
    status: Exclude<EngineConnectionStatus, "connected">;
} | {
    status: Extract<EngineConnectionStatus, "connected">;
    version: string;
};

type FilesToPatch = Array<{
    /**
     * From the engine directory
     */
    relativePath: string;
    expectedMD5: string;
    componentToDownloadAndReplace: DownloadableComponent
}>;

export class AceConnector extends (EventEmitter as new () => TypedEmitter<AceConnectorEvents>) {
    static filesToPatch: FilesToPatch = [
        {
            relativePath: "lib/acestreamengine.CoreApp.pyd",
            expectedMD5: "ed68c75e473fe2642dbaa058fde1a912",
            componentToDownloadAndReplace: "patchBrowserAds"
        }
    ];
    
    options: AceConnectorOptions;
    /**
     * Represents the last status (useful is the real status is `checking`).
     * `null` in case if `connect()` wasn't called
     */
    lastConnectedStatus: Extract<EngineConnectionStatus, "connected" | "disconnected"> | null = null;
    engine: EngineStatus = {
        status: "disconnected",
    };
    engineExecutable: {
        path: string;
        dir: string;
    } | undefined;
    private portFileObserver: fs.FSWatcher | undefined;

    constructor(userOptions?: Partial<typeof defaultOptions>) {
        super();
        if (process.platform !== "win32") throw new Error("Only Windows platform is supported.");
        this.options = { ...defaultOptions, ...userOptions };
    }

    /**
     * Use this instead of `this.emit("updateStatus", ...)`;
     */
    updateStatus(newEngineStatus: EngineStatus) {
        if (
            newEngineStatus.status === "disconnected" ||
            newEngineStatus.status === "connected"
        ) {
            this.lastConnectedStatus = newEngineStatus.status;
        }
        this.engine = newEngineStatus;
        this.emit("updateStatus", newEngineStatus.status);
    }

    async checkHttpConnection() {
        try {
            let { status, data } = await axios.get(`http://localhost:6878/webui/api/service?method=get_version`);//check with timeout
            if (data.error) throw new Error(data.error);
            this.updateStatus({
                status: "connected",
                version: data.result.version
            });
            return true;
        } catch (err) {
            this.updateStatus({ status: "disconnected" });
            return false;
        }
    }

    async getDownloadComponentLink(component: keyof typeof DOWNLOAD_ASSETS_CONFIG.components): Promise<string> {
        return (await axios.get(`${DOWNLOAD_ASSETS_CONFIG.base}/${component}`)).data;
    }

    /**
     * Fire it from `patchAvailable` event to patch AceStream
     */
    async patchAceStream() {
        const downloadPatchLink = await this.getDownloadComponentLink("patchBrowserAds");
        const { data } = await axios.get(downloadPatchLink);

    }

    async connect(): Promise<void> {
        this.emit("updateStatus", "checking");
        try {
            await this.connectInternal();
        } catch (err) {
            throw err;
        }
    }
    
    private async connectInternal(): Promise<void> {
        // -- CHECKING WETHER ACE STREAM IS INSTALLED OR NOT
        // REGISTRY VALUE
        const engineExecPath = await (async (): Promise<string> => {
            if (this.options.aceEngineExecutablePath) {
                return this.options.aceEngineExecutablePath;
            }
            console.time("registry_read");
            const { keyValue: engineExecPath } = await getRegistryKey("HKCU\\SOFTWARE\\AceStream\\EnginePath");
            if(!engineExecPath) {
                throw new ConnectionError("ACE_ENGINE_NOT_INSTALLED", "Can't read registry value");
            }
            console.timeEnd("registry_read");
            return engineExecPath;
        })();
        if (!fs.existsSync(engineExecPath)) {
            throw new ConnectionError(
                "ACE_ENGINE_NOT_INSTALLED",
                `Can't find ace engine from registry path: ${engineExecPath}`
            );
        }
        const engineDir = path.dirname(engineExecPath);
        this.engineExecutable = {
            path: engineExecPath,
            dir: engineDir
        };

        let enginePortFile = path.join(engineDir, "acestream.port");
        // -- WATCH ENGINE STATUS
        (() => {
            if (!this.options.watchOptions.enabled) return;
            // DROPING PREV FILE OBSERVER IF EXISTS
            if (this.portFileObserver) {
                this.portFileObserver.close();
                this.portFileObserver = undefined;
            }
            // CREATING NEW ONE TO TRACK ACE ENGINE STATUS
            this.portFileObserver = fs.watch(engineDir, (eventName, filename) => {
                if (filename !== path.basename(enginePortFile)) return;
                // note: if file just created, then "change" event will be emited
                if (eventName === "change") {
                    this.checkHttpConnection();
                } else if (!fs.existsSync(enginePortFile)) {// engine stopped
                    this.updateStatus({ status: "disconnected" });
                }
            });
        })();

        // -- CHECK FOR PATCHES
        await (async () => { 
            if (!this.options.checkForPatch) return;
            const patchNeededResults = await Promise.all(
                AceConnector.filesToPatch.map(fileToPatch =>
                    // it returns Promise, not function
                    (async () => {
                        const pathToPachFile = path.join(engineDir, fileToPatch.relativePath);
                        if (
                            fs.existsSync(pathToPachFile) &&
                            //cheking file md5 hash
                            await md5File(pathToPachFile) !== fileToPatch.expectedMD5
                        ) {
                            return true;
                        } else {
                            return false;
                        }
                    })()
                )
            );
            const patchNeeded = patchNeededResults.includes(true);
            if (patchNeeded) {
                const eventResult = this.emit("patchAvailable");
                if (eventResult !== false) {
                    await this.patchAceStream();
                }
            }
        })();
        // -- CONNECT ENGINE
        await (async () => {
            const startAceEngine = async (): Promise<void> => {
                if (this.options.autoStartOnConnect) {
                    //todo implement retries
                    const { stderr, stdout } = await execFilePromise(engineExecPath);
                    // throw new ConnectionError("ACE_ENGINE_RUN_FAIL", `Can't open ace engine executable (${aceEngineExecPath}). You can try to open it manually.`);
                } else {
                    throw new ConnectionError("ACE_ENGINE_NOT_STARTED", "");
                }
            };
    
            // if engine port doesn't exist - it 100% need to be started
            if (!fs.existsSync(enginePortFile)) {
                await startAceEngine();
            } else {
                // but sometimes ace port file exists even if engine wasn't started so we need additional check 
                // FINDING ENGINE PROCESS

                // TODO-moderate FIX WEIRD RUSSIAN CHARACTERS 
                // let runningProcesses = (await si.processes()).list;
                // const aceEngineProcessFound = runningProcesses.find((process) => process.path === engineExecPath);
                const processes = await psList();
                const engineProcess = processes.find(process => {
                    return process.name === path.basename(this.engineExecutable!.path);
                });
                if (engineProcess) {
                    // ASSUMED THAT ACE ENGINE WILL FIX PORT FILE
                    // todo-moderate review
                    await killer.killByPid(engineProcess.pid.toString());
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
};