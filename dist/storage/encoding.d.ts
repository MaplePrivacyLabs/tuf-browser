import { Metafile } from "../types.js";
export declare function isRawBytesWrapper(value: unknown): value is {
    __raw_bytes__: string;
};
export declare function decodeRawBytesWrapper(wrapper: {
    __raw_bytes__: string;
}): Metafile;
export declare function createRawBytesWrapper(value: Uint8Array): {
    __raw_bytes__: string;
};
export declare function storedBytes(value: unknown): Uint8Array | undefined;
