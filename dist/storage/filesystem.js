import * as fs from "node:fs/promises";
import * as path from "node:path";
export class FSBackend {
    async read(key) {
        try {
            const value = await fs.readFile(key, "utf8");
            return JSON.parse(value);
        }
        catch {
            return undefined;
        }
    }
    async readRaw(key) {
        try {
            return new Uint8Array(await fs.readFile(key));
        }
        catch {
            return undefined;
        }
    }
    async write(key, value) {
        await this.ensureParentDir(key);
        await fs.writeFile(key, JSON.stringify(value), "utf8");
    }
    async writeRaw(key, value) {
        await this.ensureParentDir(key);
        await fs.writeFile(key, value);
    }
    async ensureParentDir(filepath) {
        const dir = path.dirname(filepath);
        await fs.mkdir(dir, { recursive: true });
    }
    async delete(key) {
        try {
            await fs.unlink(key);
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
    }
}
//# sourceMappingURL=filesystem.js.map