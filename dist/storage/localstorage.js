import { storedBytes } from "./encoding.js";
import { createRawBytesWrapper, decodeRawBytesWrapper, isRawBytesWrapper, } from "./encoding.js";
export class LocalStorageBackend {
    async read(key) {
        const value = localStorage.getItem(key);
        if (value) {
            const parsed = JSON.parse(value);
            if (isRawBytesWrapper(parsed)) {
                return decodeRawBytesWrapper(parsed);
            }
            return parsed;
        }
    }
    async readRaw(key) {
        const value = localStorage.getItem(key);
        return storedBytes(value === null ? undefined : JSON.parse(value));
    }
    async write(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
    async writeRaw(key, value) {
        localStorage.setItem(key, JSON.stringify(createRawBytesWrapper(value)));
    }
    async delete(key) {
        localStorage.removeItem(key);
    }
}
//# sourceMappingURL=localstorage.js.map