import type { BlobStore, StoredObject } from "./types";

function copyObject(object: StoredObject): StoredObject {
  return { ...object, bytes: new Uint8Array(object.bytes) };
}

export class MemoryBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredObject>();

  async put(object: StoredObject): Promise<void> {
    this.objects.set(object.key, copyObject(object));
  }

  async get(key: string): Promise<StoredObject | null> {
    const object = this.objects.get(key);
    return object ? copyObject(object) : null;
  }

  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects.values()]
      .filter((object) => object.key.startsWith(prefix))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(copyObject);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }
}

const R2_DELETE_BATCH = 1000;

export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(object: StoredObject): Promise<void> {
    await this.bucket.put(object.key, object.bytes, {
      httpMetadata: { contentType: object.contentType },
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    const bytes = new Uint8Array(await object.arrayBuffer());
    return {
      key,
      bytes,
      contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
    };
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor });
      for (const item of page.objects) {
        objects.push({ key: item.key, bytes: new Uint8Array(), contentType: "application/octet-stream" });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return objects;
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    const keys = (await this.list(prefix)).map((object) => object.key);
    // R2 accepts at most 1000 keys per bulk delete.
    for (let start = 0; start < keys.length; start += R2_DELETE_BATCH) {
      await this.bucket.delete(keys.slice(start, start + R2_DELETE_BATCH));
    }
  }
}
