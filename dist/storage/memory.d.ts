import type { FileBackend } from "../storage.js";
import type { Metafile } from "../types.js";
export declare class MemoryBackend implements FileBackend {
    private cache;
    read(key: string): Promise<Metafile | undefined>;
    write(key: string, value: Metafile): Promise<void>;
    writeRaw(key: string, value: Uint8Array): Promise<void>;
    delete(key: string): Promise<void>;
}
