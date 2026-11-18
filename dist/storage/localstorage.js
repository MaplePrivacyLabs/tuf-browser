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