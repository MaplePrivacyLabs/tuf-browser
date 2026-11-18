import { canonicalizeOLPC, Uint8ArrayToHex } from "@freedomofpress/crypto-browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalStorageBackend } from "../src/storage/localstorage.js";
import { MemoryBackend } from "../src/storage/memory.js";
import { TUFClient } from "../src/tuf.js";

const utf8 = (value: string) => new TextEncoder().encode(value);

const start = new Date("2030-01-01T00:00:00Z");
const later = new Date("2030-01-03T00:00:00Z");
const encode = (value: unknown) => utf8(JSON.stringify(value, null, 2));

const localNamespaces = new Set<string>();

async function repository(expiring = "none", consistent = true, useLocalStorage = false) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const key = { keytype: "ed25519", scheme: "ed25519", keyval: {
    public: Uint8ArrayToHex(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
  }};
  const keyid = Uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(canonicalizeOLPC(key)))));
    const extraPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const extraKey = { ...key, keyval: { public: Uint8ArrayToHex(new Uint8Array(
      await crypto.subtle.exportKey("raw", extraPair.publicKey))) } };
    const extraId = Uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest(
      "SHA-256", utf8(canonicalizeOLPC(extraKey)))));
  const role = { keyids: [keyid], threshold: 1 };
  const roles = { root: role, timestamp: role, snapshot: role, targets: { keyids: [keyid, extraId].sort().reverse(), threshold: 1 } };
  const files = new Map<string, Uint8Array>();
  const payload = utf8("first");
  let root = "";
  async function publish(version = 1, content = payload, renew = false, lowerVersion = version) {
    const hash = Uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", content)));
    const pin = async (name: string) => {
      const raw = files.get(name)!;
      return { version: lowerVersion, length: raw.length, hashes: { sha256:
        Uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(raw)))) } };
    };
    for (const type of ["root", "targets", "snapshot", "timestamp"]) {
      const signed = { _type: type, spec_version: "1.0.31", version: type === "root" ? 1 : type === "timestamp" ? version : lowerVersion,
        expires: type === expiring && !renew ? "2030-01-02T00:00:00Z" : "2031-01-01T00:00:00Z",
        ...(type === "root" ? { keys: { [keyid]: key, [extraId]: extraKey }, roles, consistent_snapshot: consistent } : {}),
        ...(type === "targets" ? { targets: { "file.txt": { length: content.length, hashes: { sha256: hash } } } } : {}),
        ...(type === "snapshot" ? { meta: { "targets.json": await pin("targets.json") } } : {}),
        ...(type === "timestamp" ? { meta: { "snapshot.json": await pin("snapshot.json") } } : {}),
      };
      const sig = Uint8ArrayToHex(new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, utf8(canonicalizeOLPC(signed)))));
      const raw = encode({ signed, signatures: [{ keyid, sig }] });
      files.set(`${type}.json`, raw);
      if (type !== "root") files.set(`${type === "timestamp" ? version : lowerVersion}.${type}.json`, raw);
      if (type === "root") root = new TextDecoder().decode(raw);
    }
    files.set(`${hash}.file.txt`, content);
    files.set("file.txt", content);
  }
  async function rotateRoot(snapshotKey = false, targetsThreshold = 2) {
    const metadata = JSON.parse(new TextDecoder().decode(files.get("root.json")));
    metadata.signed.version = 2;
    if (snapshotKey) metadata.signed.roles.snapshot = { keyids: [extraId], threshold: 1 };
    else metadata.signed.roles.targets.threshold = targetsThreshold;
    metadata.signatures[0].sig = Uint8ArrayToHex(new Uint8Array(await crypto.subtle.sign(
      "Ed25519", pair.privateKey, utf8(canonicalizeOLPC(metadata.signed)))));
    files.set("2.root.json", encode(metadata));
  }
  await publish();
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const name = new URL(url).pathname.slice(1);
    requests.push(name);
    const data = files.get(name);
    return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
  }));
  const namespace = useLocalStorage ? `expiry-test-${crypto.randomUUID()}` : "test";
  if (useLocalStorage) localNamespaces.add(namespace);
  const backend = useLocalStorage ? new LocalStorageBackend() : new MemoryBackend();
  const client = () => new TUFClient("https://repo.invalid/", root, namespace, undefined,
    useLocalStorage ? undefined : { backend });
  return { client, backend, files, publish, rotateRoot, requests, namespace };
}

afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals();
  for (const namespace of localNamespaces) {
    for (const role of ["root", "timestamp", "snapshot", "targets"]) {
      localStorage.removeItem(`${namespace}/${role}.json`);
    }
  }
  localNamespaces.clear();
});

describe("trusted metadata freshness", () => {
  for (const role of ["root", "timestamp", "snapshot", "targets"]) {
    it(`rejects expired cached ${role} on refresh and direct target access`, async () => {
      const repo = await repository(role);
      await repo.client().updateTUF();
      vi.setSystemTime(later);
      const error = `Freeze attack on the ${role} metafile.`;
      await expect(repo.client().updateTUF()).rejects.toThrow(error);
      await expect(repo.client().getTarget("file.txt")).rejects.toThrow(error);
      await expect(repo.client().listSignedTargets()).rejects.toThrow(error);
      expect(repo.requests.some(name => name.endsWith("file.txt"))).toBe(false);
    });
  }
  for (const role of ["root", "timestamp", "snapshot", "targets"]) {
    it(`rejects ${role} at the exact expiration instant`, async () => {
      const repo = await repository(role);
      await repo.client().updateTUF();
      vi.setSystemTime(new Date("2030-01-02T00:00:00Z"));
      const error = `Freeze attack on the ${role} metafile.`;
      await expect(repo.client().updateTUF()).rejects.toThrow(error);
      await expect(repo.client().getTarget("file.txt")).rejects.toThrow(error);
    });
  }
  it("deletes timestamp and snapshot rollback floors on snapshot-key rotation", async () => {
    const repo = await repository();
    await repo.client().updateTUF();
    await repo.rotateRoot(true);
    repo.files.delete("timestamp.json");
    await expect(repo.client().updateTUF()).rejects.toThrow("Failed to fetch file: 404");
    expect((await repo.backend.read("test/root.json"))?.signed.version).toBe(2);
    expect(await repo.backend.read("test/timestamp.json")).toBeUndefined();
    expect(await repo.backend.read("test/snapshot.json")).toBeUndefined();
  });
  for (const role of ["snapshot", "targets"]) {
    it(`rejects an expired downloaded ${role} after a new timestamp`, async () => {
      const repo = await repository(role);
      await repo.client().updateTUF();
      await repo.publish(2);
      vi.setSystemTime(later);
      await expect(repo.client().updateTUF()).rejects.toThrow(`Freeze attack on the ${role} metafile.`);
      expect((await repo.backend.read(`test/${role}.json`))?.signed.version).toBe(1);
    });
  }
  it("preserves unsorted signed role keys during a healthy root rotation", async () => {
    const repo = await repository();
    await repo.client().updateTUF();
    await repo.rotateRoot(false, 1);
    await repo.client().updateTUF();
    expect((await repo.backend.read("test/root.json"))?.signed.version).toBe(2);
    await repo.client().updateTUF();
    expect(new TextDecoder().decode(await repo.client().getTarget("file.txt"))).toBe("first");
  });
  it("round-trips pretty-printed hash-pinned metadata through the default localStorage cache", async () => {
    const repo = await repository("none", true, true);
    await repo.client().updateTUF();
    expect(localStorage.getItem(`${repo.namespace}/snapshot.json`)).toContain("__raw_bytes__");
    await repo.client().updateTUF();
    expect(new TextDecoder().decode(await repo.client().getTarget("file.txt"))).toBe("first");
    await repo.publish(2, utf8("second"));
    await repo.client().updateTUF();
    expect(new TextDecoder().decode(await repo.client().getTarget("file.txt"))).toBe("second");
  });
  for (const role of ["root", "timestamp", "snapshot", "targets"]) {
    it(`rejects expired ${role} through the default localStorage cache`, async () => {
      const repo = await repository(role, true, true);
      await repo.client().updateTUF();
      vi.setSystemTime(later);
      const error = `Freeze attack on the ${role} metafile.`;
      await expect(repo.client().updateTUF()).rejects.toThrow(error);
      await expect(repo.client().getTarget("file.txt")).rejects.toThrow(error);
      await expect(repo.client().listSignedTargets()).rejects.toThrow(error);
    });
  }
  it("does not renew an expired trusted timestamp with the same version", async () => {
    const repo = await repository("timestamp");
    await repo.client().updateTUF();
    await repo.publish(1, undefined, true);
    vi.setSystemTime(later);
    await expect(repo.client().updateTUF()).rejects.toThrow("Freeze attack on the timestamp metafile.");
  });
  it("rejects a higher-version expired timestamp without losing rollback state", async () => {
    const repo = await repository("timestamp");
    await repo.client().updateTUF();
    await repo.publish(2);
    vi.setSystemTime(later);
    await expect(repo.client().updateTUF()).rejects.toThrow("Freeze attack on the timestamp metafile.");
    expect((await repo.backend.read("test/timestamp.json"))?.signed.version).toBe(1);
  });
  it("rejects rollback replay after a successful newer refresh", async () => {
    const repo = await repository();
    await repo.client().updateTUF();
    const old = repo.files.get("timestamp.json")!;
    await repo.publish(2);
    await repo.client().updateTUF();
    repo.files.set("timestamp.json", old);
    await expect(repo.client().updateTUF()).rejects.toThrow("New timestamp file has a lower version that the currently cached one.");
    expect((await repo.backend.read("test/timestamp.json"))?.signed.version).toBe(2);
  });
  it("resumes after a timestamp was persisted but snapshot download failed", async () => {
    const repo = await repository();
    await repo.client().updateTUF();
    await repo.publish(2, utf8("second"));
    const snapshot = repo.files.get("2.snapshot.json")!;
    repo.files.delete("2.snapshot.json");
    await expect(repo.client().updateTUF()).rejects.toThrow("Failed to fetch file: 404");
    await expect(repo.client().getTarget("file.txt")).rejects.toThrow("Cached snapshot version does not match trusted timestamp.");
    repo.files.set("2.snapshot.json", snapshot);
    await repo.client().updateTUF();
    expect(new TextDecoder().decode(await repo.client().getTarget("file.txt"))).toBe("second");
  });
  it("rechecks cached targets against a rotated root threshold", async () => {
    const repo = await repository();
    await repo.client().updateTUF();
    await repo.rotateRoot();
    await expect(repo.client().updateTUF()).rejects.toThrow("Failed verifying cached targets role signature(s).");
    await expect(repo.client().getTarget("file.txt")).rejects.toThrow("Failed verifying cached targets role signature(s).");
  });
  it("rejects cached bytes that do not satisfy a new timestamp's same-version hash pin", async () => {
    const repo = await repository();
    await repo.client().updateTUF();
    await repo.publish(2, utf8("other"), false, 1);
    repo.files.delete("1.snapshot.json");
    await expect(repo.client().updateTUF()).rejects.toThrow("Failed to fetch file: 404");
    await expect(repo.client().getTarget("file.txt")).rejects.toThrow("Cached snapshot: sha256 hash mismatch");
  });
  for (const consistent of [true, false]) {
    it(`serves healthy cached and newly published targets (consistent=${consistent})`, async () => {
      const repo = await repository("none", consistent);
      await repo.client().updateTUF();
      await repo.client().updateTUF();
      expect(new TextDecoder().decode(await repo.client().getTarget("file.txt"))).toBe("first");
      expect(repo.requests.at(-1)).toMatch(consistent ? /^[a-f0-9]+\.file\.txt$/ : /^file\.txt$/);
      await repo.publish(2, utf8("second"));
      await repo.client().updateTUF();
      expect(new TextDecoder().decode(await repo.client().getTarget("file.txt"))).toBe("second");
    });
  }
});
