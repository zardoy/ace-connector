"use strict";
// todo: fork original winreg repo with this improvements
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegistryKey = void 0;
const winreg_1 = __importDefault(require("winreg"));
const util = __importStar(require("util"));
/**
 *
 * @param fullPath full key registry path, must include registry hive!
 */
const getRegistryKey = async (fullPath) => {
    const [regHive, ...keyPathParts] = fullPath.split("\\");
    const registryKey = "\\" + keyPathParts.slice(0, -1).join("\\");
    let aceRegistry = new winreg_1.default({
        hive: regHive,
        key: registryKey
    });
    const { value: keyValue } = await util.promisify(aceRegistry.get).call(aceRegistry, keyPathParts.slice(-1)[0]);
    return { keyValue };
};
exports.getRegistryKey = getRegistryKey;
