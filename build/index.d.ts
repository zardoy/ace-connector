import TypedEmitter from "typed-emitter";
import { Progress } from "got";
declare const DOWNLOAD_ASSETS_CONFIG: {
    base: string;
    components: {
        installer: boolean;
        patchBrowserAds: boolean;
    };
};
declare type DownloadableComponent = keyof typeof DOWNLOAD_ASSETS_CONFIG["components"];
export declare type ConnectionErrorType = "ACE_ENGINE_NOT_INSTALLED" | "ACE_ENGINE_READ_PORT_ERROR" | "ACE_ENGINE_RUN_FAIL" | "ACE_ENGINE_NOT_STARTED";
export declare type EngineConnectionStatus = "checking" | "disconnected" | "starting" | "connected";
export declare class ConnectionError extends Error {
    type: ConnectionErrorType;
    reason: string;
    constructor(type: ConnectionErrorType, reason: string);
}
export interface AceConnectorOptions {
    /**
     * Set this to null to prevent watching port file
     */
    autoStart: null | {
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
    maxStartRetries: number;
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
    httpPort: number;
    /**
     * You can specify
     * If not specified AceConnector will get this value from the registry
     */
    aceEngineExecutablePath?: string;
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
export declare const defaultOptions: AceConnectorOptions;
declare type InstallerDownloadedEvent = {
    /**
     * Call it to prevent auto-installation. Must be called instantly.
     *
     * @returns Function to begin auto-installation
     */
    handleLaunchManually: () => () => void;
};
export declare type AceConnectorEvents = {
    /**
     * Emitted on connection status update
     */
    updateStatus(engineStatus: EngineConnectionStatus): void;
    /**
     * Emitted when patch available for Ace Stream.
     */
    patchAvailable(): void;
    /**
     * Emitted when patching is done.
     */
    autoPatchCompleted(): void;
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
export declare type EngineStatus = {
    status: Exclude<EngineConnectionStatus, "connected">;
} | {
    status: Extract<EngineConnectionStatus, "connected">;
    version: string;
};
declare type FilesToPatch = Array<{
    /**
     * From the engine directory
     */
    relativePath: string;
    expectedMD5: string;
    componentToDownloadAndReplace: DownloadableComponent;
}>;
declare const AceConnector_base: new () => TypedEmitter<AceConnectorEvents>;
export declare class AceConnector extends AceConnector_base {
    static RECOMMENDED_VERSION: string;
    static filesToPatch: FilesToPatch;
    static getDownloadComponentUrl(component: keyof typeof DOWNLOAD_ASSETS_CONFIG.components): Promise<string>;
    /**
     * Downloads Ace Stream
     * @param savePath Path to save executable file. It's recommended to use temp path
     */
    static downloadAceStreamInstaller(savePath: string): Promise<void>;
    options: AceConnectorOptions;
    /**
     * Represents the last status (useful is the real status is `checking`).
     * `null` in case if `connect()` wasn't called
     */
    lastConnectedStatus: Extract<EngineConnectionStatus, "connected" | "disconnected"> | null;
    engine: EngineStatus;
    engineExecutable: {
        path: string;
        dir: string;
    } | undefined;
    httpApiPort: number;
    private portFileObserver;
    constructor(userOptions?: Partial<typeof defaultOptions>);
    /**
     * Use this instead of `this.emit("updateStatus", ...)`;
     */
    private updateStatus;
    /**
     * Check wether Ace Engine is available on HTTP or not
     */
    checkHttpConnection(): Promise<boolean>;
    /**
     * Fire it from `patchAvailable` event to patch AceStream
     */
    patchAceStream(): Promise<void>;
    /**
     * Will skip download if executable already exists on this step
     */
    installAceStream(savePath: string): Promise<void>;
    connect(): Promise<void>;
    private getEnginePid;
    private connectInternal;
    disconnect(): Promise<boolean>;
    execute(): void;
}
export {};
