import { Signature, Signed } from "./types.js";
export declare function getRoleKeys(keys: Map<string, CryptoKey>, keyids: string[]): Map<string, CryptoKey>;
export declare function loadKeys(keys: Signed["keys"]): Promise<Map<string, CryptoKey>>;
export declare function checkSignatures(keys: Map<string, CryptoKey>, roleKeys: string[], signed: object, signatures: Signature[], threshold: number): Promise<boolean>;
