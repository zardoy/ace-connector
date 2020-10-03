// todo: fork original winreg repo with this improvements

import Registry from "winreg";
import * as util from "util";

/**
 * 
 * @param fullPath full key registry path, must include registry hive!
 */
export const getRegistryKey: getRegistryKeyType = async (fullPath) => {
    const [regHive, ...keyPathParts] = fullPath.split("\\");

    const registryKey = "\\" + keyPathParts.slice(0, -1).join("\\");
    let aceRegistry = new Registry({
        hive: regHive,
        key: registryKey
    });
    const { value: keyValue } = await util.promisify(aceRegistry.get).call(aceRegistry, keyPathParts.slice(-1)[0]);
    return { keyValue };
};

type getRegistryKeyType = (fullPath: string) => Promise<{
    keyValue: string;
}>;