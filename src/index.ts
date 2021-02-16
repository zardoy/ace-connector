import fs, { unlink, unlinkSync } from "fs";
import path from "path";
import { EventEmitter } from "events";
import child_process from "child_process";
import util from "util";
import si from "systeminformation";
import md5File from "md5-file";
import { once } from "events";
import TypedEmitter from "typed-emitter";
import { killer } from "cross-port-killer";
import os from "os";

import { getRegistryKey } from "./winreg-wrapper";
import psList from "ps-list";
import got, { Progress } from "got";

import stream from "stream";
import { defaultsDeep } from "lodash";
import execa from "execa";

const pipeline = util.promisify(stream.pipeline);

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
     * Setting this to false will prevent watching port file
     */
    autoStart: false | {
        /**
         * If `true` start engine on `connect()` if it's not started yet
         */
        onConnect: boolean;
        /**
         * If `true` AceConnector will started engine immediately after it was suspended. You also get `updateStatus` event immediately
         */
        onSuspend: boolean;
    };
    /**
     * @todo Not implemented yet
     */
    maxStartRetries: number,
    /**
     * AceStream opens ads in a browser when you request stream (TODO).
     * 
     * Checks if patches are available (only on `connect()`). If enabled and patches are available, `patchAvailable` event will be emited.
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
    aceEngineExecutablePath?: string,
    /**
     * If `true` and AceStream isn't installed it will be downloaded and installed automatically*
     * 
     * Emmited events: `beforeInstall`, `downloadInstallerProgress`, `installerDownloaded`, `installComplete`, `installError`
     * 
     * @todo auto-linked events
     * @todo-high handle errors
     */
    autoInstall: boolean;
}

const defaultOptions: AceConnectorOptions = {
    autoStart: {
        onConnect: true,
        onSuspend: true,
    },
    maxStartRetries: 3,
    checkForPatch: true,
    httpPort: 6878,
    autoInstall: false
};

type PreventableEvent = {
    preventDefault: () => void;
};

type InstallerDownloadedEvent = {
    /**
     * Call it to prevent auto-installation. Must be called instantly.
     * 
     * @returns Function to begin auto-installation
     */
    handleLaunchManually: () => () => void;
};

export type AceConnectorEvents = {
    /**
     * Emitted on connection status update
     */
    updateStatus(engineStatus: EngineConnectionStatus): void;
    // todo-moderate @returns could be prevented from downloading and applying the patch
    /**
     * Emitted when patch available for Ace Stream.
     */
    // @returns `false` auto-start onConnect will be prevented (if not disabled by settings)
    patchAvailable(): void;
    /**
     * Emitted when patching is done.
     */
    autoPatchCompleted(): void;

    // install events
    beforeInstall(): void;
    downloadInstallerProgress(progress: Progress): void;
    installerDownloaded(event: InstallerDownloadedEvent): void;
    /**
     * Still doesn't guarantee that AceStream in installed correctly
     */
    installComplete(): void;

    /**
     * @param step if `download` - network error, `execute` - local error (executing)
     */
    installError(step: "download" | "execute"): void;
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
    componentToDownloadAndReplace: DownloadableComponent;
}>;

export class AceConnector extends (EventEmitter as new () => TypedEmitter<AceConnectorEvents>) {
    static RECOMMENDED_VERSION = "3.1.32";

    static filesToPatch: FilesToPatch = [
        {
            relativePath: "lib/acestreamengine.CoreApp.pyd",
            expectedMD5: "ed68c75e473fe2642dbaa058fde1a912",
            componentToDownloadAndReplace: "patchBrowserAds"
        }
    ];

    static async getDownloadComponentUrl(component: keyof typeof DOWNLOAD_ASSETS_CONFIG.components): Promise<string> {
        return (await got(`${DOWNLOAD_ASSETS_CONFIG.base}/${component}`)).body.trim();
    }

    /**
     * Downloads Ace Stream
     * @param savePath Path to save executable file. It's recommended to use temp path
     */
    static async downloadAceStreamInstaller(savePath: string) {
        const downloadUrl = await AceConnector.getDownloadComponentUrl("installer");
        await pipeline(
            got.stream(downloadUrl)
                .on("downloadProgress", progress => {
                    console.log(progress.percent * 100 + "%");
                }),
            fs.createWriteStream(savePath)
        );
    }

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
    httpApiPort = 6878;
    private portFileObserver: fs.FSWatcher | undefined;

    constructor(userOptions?: Partial<typeof defaultOptions>) {
        super();
        if (process.platform !== "win32") throw new Error("Only Windows platform is supported.");
        this.options = defaultsDeep(defaultOptions, userOptions);
    }

    /**
     * Use this instead of `this.emit("updateStatus", ...)`;
     */
    private updateStatus(newEngineStatus: EngineStatus) {
        if (
            newEngineStatus.status === "disconnected" ||
            newEngineStatus.status === "connected"
        ) {
            this.lastConnectedStatus = newEngineStatus.status;
        }
        this.engine = newEngineStatus;
        this.emit("updateStatus", newEngineStatus.status);
    }

    /**
     * Check wether Ace Engine is available on HTTP or not
     */
    async checkHttpConnection(): Promise<boolean> {
        try {
            // todo-low response type
            // todo-high check with timeout
            let { statusCode, body: data } = await got<{ error: any, result: any; }>(
                `http://localhost:${this.httpApiPort}/webui/api/service?method=get_version`, {
                responseType: "json"
            });
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
        const filePathToPatch = path.resolve(this.engineExecutable.dir, patchConfig.relativePath);
        await fs.promises.unlink(filePathToPatch);
        await pipeline(
            got.stream(downloadPatchLink),
            fs.createWriteStream(filePathToPatch)
        );
        // todo-moderate check md5 hash
        this.emit("autoPatchCompleted");
    }

    /**
     * Will skip download if executable already exists on this step
     */
    async installAceStream(savePath: string) {
        const installDownloadedAceStream = async () => {
            // todo-moderate autohotkey
            await execa(savePath, {
                stdio: "inherit"
            });
            this.emit("installComplete");
        };

        this.emit("beforeInstall");
        // todo rewrite with promises
        if (!fs.existsSync(savePath)) {
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
        await once(this, "installComplete");
    }

    async connect(): Promise<void> {
        this.emit("updateStatus", "checking");
        try {
            await this.connectInternal();
        } catch (err) {
            if (
                this.options.autoInstall &&
                err instanceof ConnectionError &&
                err.type === "ACE_ENGINE_NOT_INSTALLED"
            ) {
                await this.installAceStream(
                    path.join(os.tmpdir(), "ace-connector--ace-stream-installer.exe")
                );
                await new Promise(resolve => setTimeout(resolve, 1000));
                await this.connectInternal();
            } else {
                throw err;
            }
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
            if (!engineExecPath) {
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
            if (!this.options.autoStart) return;
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
        const skipEngineStartFromPatch = await (async (): Promise<void | true> => {
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
            if (!patchNeeded) return;
            this.emit("patchAvailable");
            await this.patchAceStream();
        })();
        // -- CONNECT ENGINE
        await (async () => {
            const startAceEngine = async (): Promise<void> => {
                if (this.options.autoStart && this.options.autoStart.onConnect) {
                    //todo implement retries
                    const { stderr, stdout } = await execFilePromise(engineExecPath);
                    // throw new ConnectionError("ACE_ENGINE_RUN_FAIL", `Can't open ace engine executable (${aceEngineExecPath}). You can try to open it manually.`);
                } else {
                    throw new ConnectionError("ACE_ENGINE_NOT_STARTED", "With these options Ace Engine needs to be started manually");
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