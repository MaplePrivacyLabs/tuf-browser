import { FileBackend } from "../storage.js";
import { Metafile } from "../types.js";
export declare class LocalStorageBackend implements FileBackend {
    read(key: string): Promise<Metafile | undefined>;
    write(key: string, value: Metafile): Promise<void>;
    writeRaw(key: string, value: Uint8Array): Promise<void>;
    delete(key: string): Promise<void>;
}
