/**
 *
 * @param fullPath full key registry path, must include registry hive!
 */
export declare const getRegistryKey: getRegistryKeyType;
declare type getRegistryKeyType = (fullPath: string) => Promise<{
    keyValue: string;
}>;
export {};
