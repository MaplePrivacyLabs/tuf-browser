import { createRawBytesWrapper, decodeRawBytesWrapper, isRawBytesWrapper, storedBytes, } from "./encoding.js";
export class MemoryBackend {
    constructor() {
        this.cache = new Map();
    }
    async read(key) {
        const value = this.cache.get(key);
        if (!value)
            return undefined;
        if (isRawBytesWrapper(value)) {
            return decodeRawBytesWrapper(value);
        }
        return value;
    }
    async readRaw(key) {
        return storedBytes(this.cache.get(key));
    }
    async write(key, value) {
        this.cache.set(key, value);
    }
    async writeRaw(key, value) {
        this.cache.set(key, createRawBytesWrapper(value));
    }
    async delete(key) {
        this.cache.delete(key);
    }
}
//# sourceMappingURL=memory.js.map