import { FileBackend } from "./storage.js";
export type { FileBackend } from "./storage.js";
export interface TUFClientOptions {
    disableCache?: boolean;
    backend?: FileBackend;
}
export declare class TUFClient {
    private repositoryUrl;
    private targetBaseUrl;
    private startingRoot;
    private namespace;
    private backend;
    constructor(repositoryUrl: string, startingRoot: string, namespace: string, targetBaseUrl?: string, options?: TUFClientOptions);
    private getCacheKey;
    private getFromCache;
    private setInCache;
    private fetchMetafileBase;
    private validateMetadata;
    private fetchMetafileJson;
    private fetchMetafileBinary;
    private bootstrapRoot;
    private verifyHashes;
    private loadRoot;
    private updateRoot;
    private updateTimestamp;
    private updateSnapshot;
    private updateTargets;
    private cachedChainMatches;
    private checkExpiry;
    private trustedTargets;
    private trustedCachedRole;
    listSignedTargets(): Promise<string[]>;
    private fetchTarget;
    updateTUF(): Promise<void>;
    getTarget(name: string): Promise<ArrayBuffer>;
}
