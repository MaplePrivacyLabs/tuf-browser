import { canonicalizeOLPC, Uint8ArrayToHex } from "@freedomofpress/crypto-browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalStorageBackend } from "../src/storage/localstorage.js";
import { MemoryBackend } from "../src/storage/memory.js";
import { TUFClient } from "../src/tuf.js";

const ROLES = ["root", "timestamp", "snapshot", "targets"] as const;
type Role = (typeof ROLES)[number];

const REPOSITORY_URL = "https://repo.invalid/";
const TARGET = "file.txt";

// The clock starts before EXPIRES_SOON and tests move it to or past that instant.
const START = new Date("2030-01-01T00:00:00Z");
const EXPIRES_SOON = "2030-01-02T00:00:00Z";
const AFTER_EXPIRY = new Date("2030-01-03T00:00:00Z");
const EXPIRES_LATE = "2031-01-01T00:00:00Z";

const utf8 = (value: string) => new TextEncoder().encode(value);
const text = (bytes: ArrayBuffer | Uint8Array) => new TextDecoder().decode(bytes);
const hex = (buffer: ArrayBuffer) => Uint8ArrayToHex(new Uint8Array(buffer));

// Pretty-printed on purpose: the bytes on the wire differ from canonical JSON,
// so hash pins only hold if the client keeps the raw bytes it downloaded.
const encode = (value: unknown) => utf8(JSON.stringify(value, null, 2));

async function sha256(bytes: Uint8Array) {
  return hex(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
}

async function generateKey() {
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const key = {
    keytype: "ed25519",
    scheme: "ed25519",
    keyval: { public: hex(await crypto.subtle.exportKey("raw", pair.publicKey)) },
  };
  const keyid = await sha256(utf8(canonicalizeOLPC(key)));
  return { pair, key, keyid };
}

interface RepositoryOptions {
  /** Role whose metadata expires at EXPIRES_SOON. Every other role expires late. */
  expiring?: Role;
  consistentSnapshot?: boolean;
  /** Use the default localStorage cache instead of an in-memory backend. */
  localStorage?: boolean;
}

interface PublishOptions {
  /** Timestamp version. */
  version?: number;
  /** Snapshot and targets version. Defaults to the timestamp version. */
  metaVersion?: number;
  content?: Uint8Array;
  /** Give the expiring role a late expiry, as a repository re-signing it would. */
  renew?: boolean;
}

interface RotateRootOptions {
  /** Hand the snapshot role to the second key instead of changing targets. */
  snapshotKey?: boolean;
  targetsThreshold?: number;
}

const localStorageNamespaces = new Set<string>();

/**
 * A signed TUF repository served through a stubbed `fetch`.
 *
 * One key signs every role. A second key is listed for targets only, so a
 * root rotation can raise the targets threshold beyond what is signed.
 */
async function createRepository(options: RepositoryOptions = {}) {
  const { expiring, consistentSnapshot = true, localStorage: useLocalStorage = false } = options;

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);

  const signer = await generateKey();
  const extra = await generateKey();

  const sign = async (signed: unknown) => {
    const message = utf8(canonicalizeOLPC(signed));
    return hex(await crypto.subtle.sign("Ed25519", signer.pair.privateKey, message));
  };

  const singleKey = { keyids: [signer.keyid], threshold: 1 };
  const roles = {
    root: singleKey,
    timestamp: singleKey,
    snapshot: singleKey,
    // Deliberately not in sorted order; the client must not reorder signed data.
    targets: { keyids: [signer.keyid, extra.keyid].sort().reverse(), threshold: 1 },
  };

  const files = new Map<string, Uint8Array>();
  const requests: string[] = [];

  const published = (name: string) => {
    const raw = files.get(name);
    if (!raw) {
      throw new Error(`${name} has not been published`);
    }
    return raw;
  };
  let trustedRoot = "";

  async function publish(options: PublishOptions = {}) {
    const { version = 1, content = utf8("first"), renew = false } = options;
    const metaVersion = options.metaVersion ?? version;
    const targetHash = await sha256(content);

    const pin = async (name: string) => {
      const raw = published(name);
      return { version: metaVersion, length: raw.length, hashes: { sha256: await sha256(raw) } };
    };

    // Order matters: snapshot pins targets, and timestamp pins snapshot.
    for (const role of ["root", "targets", "snapshot", "timestamp"] as const) {
      const roleVersion = role === "root" ? 1 : role === "timestamp" ? version : metaVersion;

      const signed: Record<string, unknown> = {
        _type: role,
        spec_version: "1.0.31",
        version: roleVersion,
        expires: role === expiring && !renew ? EXPIRES_SOON : EXPIRES_LATE,
      };
      if (role === "root") {
        signed.keys = { [signer.keyid]: signer.key, [extra.keyid]: extra.key };
        signed.roles = roles;
        signed.consistent_snapshot = consistentSnapshot;
      } else if (role === "targets") {
        signed.targets = {
          [TARGET]: { length: content.length, hashes: { sha256: targetHash } },
        };
      } else if (role === "snapshot") {
        signed.meta = { "targets.json": await pin("targets.json") };
      } else {
        signed.meta = { "snapshot.json": await pin("snapshot.json") };
      }

      const raw = encode({
        signed,
        signatures: [{ keyid: signer.keyid, sig: await sign(signed) }],
      });

      files.set(`${role}.json`, raw);
      if (role === "root") {
        trustedRoot = text(raw);
      } else {
        files.set(`${roleVersion}.${role}.json`, raw);
      }
    }

    files.set(`${targetHash}.${TARGET}`, content);
    files.set(TARGET, content);
  }

  /** Publishes root version 2, signed by the original key. */
  async function rotateRoot(options: RotateRootOptions = {}) {
    const { snapshotKey = false, targetsThreshold = 2 } = options;

    const metadata = JSON.parse(text(published("root.json")));
    metadata.signed.version = 2;
    if (snapshotKey) {
      metadata.signed.roles.snapshot = { keyids: [extra.keyid], threshold: 1 };
    } else {
      metadata.signed.roles.targets.threshold = targetsThreshold;
    }
    metadata.signatures[0].sig = await sign(metadata.signed);

    files.set("2.root.json", encode(metadata));
  }

  await publish();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const name = new URL(url).pathname.slice(1);
      requests.push(name);

      const data = files.get(name);
      return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
    }),
  );

  const namespace = useLocalStorage ? `expiry-test-${crypto.randomUUID()}` : "test";
  if (useLocalStorage) {
    localStorageNamespaces.add(namespace);
  }
  const backend = useLocalStorage ? new LocalStorageBackend() : new MemoryBackend();

  /** A new client over the same cache, as a fresh page load would create. */
  const client = () =>
    new TUFClient(
      REPOSITORY_URL,
      trustedRoot,
      namespace,
      undefined,
      useLocalStorage ? undefined : { backend },
    );

  const cached = async (role: Role) => (await backend.read(`${namespace}/${role}.json`))?.signed;

  const fetchTarget = async () => text(await client().getTarget(TARGET));

  return {
    client,
    cached,
    fetchTarget,
    files,
    published,
    publish,
    rotateRoot,
    requests,
    namespace,
  };
}

const freezeError = (role: Role) => `Freeze attack on the ${role} metafile.`;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();

  for (const namespace of localStorageNamespaces) {
    for (const role of ROLES) {
      localStorage.removeItem(`${namespace}/${role}.json`);
    }
  }
  localStorageNamespaces.clear();
});

describe("trusted metadata freshness", () => {
  describe("expired cached metadata", () => {
    it.each(ROLES)(
      "rejects expired cached %s on refresh and direct target access",
      async (role) => {
        const repo = await createRepository({ expiring: role });
        await repo.client().updateTUF();

        vi.setSystemTime(AFTER_EXPIRY);

        await expect(repo.client().updateTUF()).rejects.toThrow(freezeError(role));
        await expect(repo.client().getTarget(TARGET)).rejects.toThrow(freezeError(role));
        await expect(repo.client().listSignedTargets()).rejects.toThrow(freezeError(role));
        expect(repo.requests.some((name) => name.endsWith(TARGET))).toBe(false);
      },
    );

    it.each(ROLES)("rejects %s at the exact expiration instant", async (role) => {
      const repo = await createRepository({ expiring: role });
      await repo.client().updateTUF();

      vi.setSystemTime(new Date(EXPIRES_SOON));

      await expect(repo.client().updateTUF()).rejects.toThrow(freezeError(role));
      await expect(repo.client().getTarget(TARGET)).rejects.toThrow(freezeError(role));
    });

    it.each(ROLES)("rejects expired %s through the default localStorage cache", async (role) => {
      const repo = await createRepository({ expiring: role, localStorage: true });
      await repo.client().updateTUF();

      vi.setSystemTime(AFTER_EXPIRY);

      await expect(repo.client().updateTUF()).rejects.toThrow(freezeError(role));
      await expect(repo.client().getTarget(TARGET)).rejects.toThrow(freezeError(role));
      await expect(repo.client().listSignedTargets()).rejects.toThrow(freezeError(role));
    });
  });

  describe("expired timestamp", () => {
    it("does not renew an expired trusted timestamp with the same version", async () => {
      const repo = await createRepository({ expiring: "timestamp" });
      await repo.client().updateTUF();

      await repo.publish({ version: 1, renew: true });
      vi.setSystemTime(AFTER_EXPIRY);

      await expect(repo.client().updateTUF()).rejects.toThrow(freezeError("timestamp"));

      // The same holds when the previous refresh stored the timestamp but not its snapshot: the
      // expired timestamp must stop the refresh before it tries to complete the chain.
      const interrupted = await createRepository({ expiring: "timestamp" });
      await interrupted.client().updateTUF();

      await interrupted.publish({ version: 2 });
      interrupted.files.delete("2.snapshot.json");
      await expect(interrupted.client().updateTUF()).rejects.toThrow("Failed to fetch file: 404");
      expect((await interrupted.cached("timestamp"))?.version).toBe(2);
      expect((await interrupted.cached("snapshot"))?.version).toBe(1);

      vi.setSystemTime(AFTER_EXPIRY);
      await expect(interrupted.client().updateTUF()).rejects.toThrow(freezeError("timestamp"));
    });

    it("rejects a higher-version expired timestamp without losing rollback state", async () => {
      const repo = await createRepository({ expiring: "timestamp" });
      await repo.client().updateTUF();

      await repo.publish({ version: 2 });
      vi.setSystemTime(AFTER_EXPIRY);

      await expect(repo.client().updateTUF()).rejects.toThrow(freezeError("timestamp"));
      expect((await repo.cached("timestamp"))?.version).toBe(1);
    });
  });

  describe("expired downloaded metadata", () => {
    it.each(["snapshot", "targets"] as const)(
      "rejects an expired downloaded %s after a new timestamp",
      async (role) => {
        const repo = await createRepository({ expiring: role });
        await repo.client().updateTUF();

        await repo.publish({ version: 2 });
        vi.setSystemTime(AFTER_EXPIRY);

        await expect(repo.client().updateTUF()).rejects.toThrow(freezeError(role));
        expect((await repo.cached(role))?.version).toBe(1);
      },
    );
  });

  describe("rollback and interrupted updates", () => {
    it("rejects rollback replay after a successful newer refresh", async () => {
      const repo = await createRepository();
      await repo.client().updateTUF();
      const oldTimestamp = repo.published("timestamp.json");

      await repo.publish({ version: 2 });
      await repo.client().updateTUF();
      repo.files.set("timestamp.json", oldTimestamp);

      await expect(repo.client().updateTUF()).rejects.toThrow(
        "New timestamp file has a lower version that the currently cached one.",
      );
      expect((await repo.cached("timestamp"))?.version).toBe(2);
    });

    it("resumes after a timestamp was persisted but snapshot download failed", async () => {
      const repo = await createRepository();
      await repo.client().updateTUF();

      await repo.publish({ version: 2, content: utf8("second") });
      const snapshot = repo.published("2.snapshot.json");
      repo.files.delete("2.snapshot.json");

      await expect(repo.client().updateTUF()).rejects.toThrow("Failed to fetch file: 404");
      await expect(repo.client().getTarget(TARGET)).rejects.toThrow(
        "Cached snapshot version does not match trusted timestamp.",
      );

      repo.files.set("2.snapshot.json", snapshot);
      await repo.client().updateTUF();

      expect(await repo.fetchTarget()).toBe("second");
    });

    it("rejects cached bytes that fail a new timestamp's same-version hash pin", async () => {
      const repo = await createRepository();
      await repo.client().updateTUF();

      await repo.publish({ version: 2, metaVersion: 1, content: utf8("other") });
      repo.files.delete("1.snapshot.json");

      await expect(repo.client().updateTUF()).rejects.toThrow("Failed to fetch file: 404");
      await expect(repo.client().getTarget(TARGET)).rejects.toThrow(
        "Cached snapshot: sha256 hash mismatch",
      );
    });
  });

  describe("root rotation", () => {
    it("deletes timestamp and snapshot rollback floors on snapshot-key rotation", async () => {
      const repo = await createRepository();
      await repo.client().updateTUF();

      await repo.rotateRoot({ snapshotKey: true });
      repo.files.delete("timestamp.json");

      await expect(repo.client().updateTUF()).rejects.toThrow("Failed to fetch file: 404");
      expect((await repo.cached("root"))?.version).toBe(2);
      expect(await repo.cached("timestamp")).toBeUndefined();
      expect(await repo.cached("snapshot")).toBeUndefined();
    });

    it("rechecks cached targets against a rotated root threshold", async () => {
      const repo = await createRepository();
      await repo.client().updateTUF();

      await repo.rotateRoot();

      const error = "Failed verifying cached targets role signature(s).";
      await expect(repo.client().updateTUF()).rejects.toThrow(error);
      await expect(repo.client().getTarget(TARGET)).rejects.toThrow(error);
    });

    it("preserves unsorted signed role keys during a healthy root rotation", async () => {
      const repo = await createRepository();
      await repo.client().updateTUF();

      await repo.rotateRoot({ targetsThreshold: 1 });
      await repo.client().updateTUF();
      expect((await repo.cached("root"))?.version).toBe(2);

      await repo.client().updateTUF();
      expect(await repo.fetchTarget()).toBe("first");
    });
  });

  describe("healthy refreshes", () => {
    it.each([true, false])(
      "serves healthy cached and newly published targets (consistent=%s)",
      async (consistentSnapshot) => {
        const repo = await createRepository({ consistentSnapshot });
        await repo.client().updateTUF();
        await repo.client().updateTUF();

        expect(await repo.fetchTarget()).toBe("first");
        expect(repo.requests.at(-1)).toMatch(
          consistentSnapshot ? /^[a-f0-9]+\.file\.txt$/ : /^file\.txt$/,
        );

        await repo.publish({ version: 2, content: utf8("second") });
        await repo.client().updateTUF();

        expect(await repo.fetchTarget()).toBe("second");
      },
    );

    it("round-trips hash-pinned metadata through the default localStorage cache", async () => {
      const repo = await createRepository({ localStorage: true });
      await repo.client().updateTUF();

      expect(localStorage.getItem(`${repo.namespace}/snapshot.json`)).toContain("__raw_bytes__");

      await repo.client().updateTUF();
      expect(await repo.fetchTarget()).toBe("first");

      await repo.publish({ version: 2, content: utf8("second") });
      await repo.client().updateTUF();
      expect(await repo.fetchTarget()).toBe("second");
    });
  });
});
