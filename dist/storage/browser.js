import { createRawBytesWrapper, decodeRawBytesWrapper, isRawBytesWrapper, } from "./encoding.js";
export class ExtensionStorageBackend {
    async read(key) {
        const result = await browser.storage.local.get(key);
        const value = result[key];
        if (isRawBytesWrapper(value)) {
            return decodeRawBytesWrapper(value);
        }
        return value;
    }
    async write(key, value) {
        await browser.storage.local.set({ [key]: value });
    }
    async writeRaw(key, value) {
        await browser.storage.local.set({ [key]: createRawBytesWrapper(value) });
    }
    async delete(key) {
        await browser.storage.local.remove(key);
    }
}
//# sourceMappingURL=browser.js.map