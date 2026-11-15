import assert from "node:assert/strict";
import { PaperLock } from "./worker-lock-source.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  async get(key) {
    return this.data.get(key);
  }
  async put(key, value) {
    this.data.set(key, structuredClone(value));
  }
  async delete(key) {
    this.data.delete(key);
  }
}

class MemoryState {
  constructor(storage) {
    this.storage = storage;
  }
  blockConcurrencyWhile(callback) {
    return callback();
  }
}

class MemoryKV {
  constructor() {
    this.data = new Map();
    this.active = 0;
    this.maxActive = 0;
    this.failNextPut = false;
  }
  async put(key, value) {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await sleep(20);
      if (this.failNextPut) {
        this.failNextPut = false;
        throw new Error("SYNTHETIC_KV_FAILURE");
      }
      this.data.set(key, value);
    } finally {
      this.active--;
    }
  }
}

function request(path, token, body) {
  const headers = {};
  if (token) headers["X-Paper-Lock-Token"] = token;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  return new Request("https://paper-lock" + path, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function readResponse(response) {
  return {
    status: response.status,
    data: await response.json()
  };
}

const storage = new MemoryStorage();
const state = new MemoryState(storage);
const kv = new MemoryKV();
const env = { TRADER_KV: kv };
const lock = new PaperLock(state, env);

await lock.ready;

// 1. Два одновременных захвата
const acquireResults = await Promise.all([
  lock.fetch(request("/acquire")),
  lock.fetch(request("/acquire"))
]);

const acquireData = await Promise.all(
  acquireResults.map(readResponse)
);

assert.equal(
  acquireData.filter(x => x.status === 200 && x.data.ok).length,
  1
);
assert.equal(
  acquireData.filter(x => x.status === 409).length,
  1
);

const firstToken = acquireData.find(x => x.status === 200).data.token;
console.log("PASS 1: simultaneous acquire — only one lock granted");

// 2. Восстановление блокировки новым экземпляром
const restartedLock = new PaperLock(state, env);
await restartedLock.ready;

const restartResult = await readResponse(
  await restartedLock.fetch(request("/acquire"))
);
assert.equal(restartResult.status, 409);
console.log("PASS 2: persisted lock restored by new instance");

// 3. Неверный токен не может записывать KV
const invalidPut = await readResponse(
  await lock.fetch(
    request("/put", "INVALID_TOKEN", {
      key: "paper:state",
      value: "SHOULD_NOT_BE_WRITTEN"
    })
  )
);

assert.equal(invalidPut.status, 409);
assert.equal(kv.data.has("paper:state"), false);
console.log("PASS 3: invalid token rejected without KV write");

// 4. Просроченная блокировка не может записывать
lock.lockRecord.expiresAt = Date.now() - 1000;

const expiredPut = await readResponse(
  await lock.fetch(
    request("/put", firstToken, {
      key: "paper:state",
      value: "EXPIRED_WRITE"
    })
  )
);

assert.equal(expiredPut.status, 409);
assert.equal(kv.data.has("paper:state"), false);
console.log("PASS 4: expired lock rejected");

// 5. Новый захват и проверка продления
const newAcquire = await readResponse(
  await lock.fetch(request("/acquire"))
);
assert.equal(newAcquire.status, 200);

const currentToken = newAcquire.data.token;
const previousExpiry = lock.lockRecord.expiresAt;
await sleep(10);

const renewResult = await readResponse(
  await lock.fetch(request("/renew", currentToken))
);

assert.equal(renewResult.status, 200);
assert.ok(renewResult.data.expiresAt > previousExpiry);

const wrongRenew = await readResponse(
  await lock.fetch(request("/renew", "WRONG_TOKEN"))
);
assert.equal(wrongRenew.status, 409);
console.log("PASS 5: valid renewal succeeds; invalid renewal rejected");

// 6. Две одновременные записи должны выполняться последовательно
kv.maxActive = 0;

const putResults = await Promise.all([
  lock.fetch(request("/put", currentToken, {
    key: "paper:state",
    value: "SYNTHETIC_STATE"
  })),
  lock.fetch(request("/put", currentToken, {
    key: "paper:instruments",
    value: "SYNTHETIC_INSTRUMENTS"
  }))
]);

for (const response of putResults) {
  assert.equal(response.status, 200);
}

assert.equal(kv.maxActive, 1);
assert.equal(kv.data.get("paper:state"), "SYNTHETIC_STATE");
assert.equal(kv.data.get("paper:instruments"), "SYNTHETIC_INSTRUMENTS");
console.log("PASS 6: concurrent KV writes serialized");

// 7. Ошибка KV не должна терять блокировку
kv.failNextPut = true;

await assert.rejects(
  lock.fetch(request("/put", currentToken, {
    key: "paper:state",
    value: "FAIL_TEST"
  })),
  /SYNTHETIC_KV_FAILURE/
);

assert.equal(lock.lockRecord.token, currentToken);
console.log("PASS 7: KV failure propagated; lock retained");

// 8. Старый токен не может освободить новую блокировку
lock.lockRecord.expiresAt = Date.now() - 1000;

const replacement = await readResponse(
  await lock.fetch(request("/acquire"))
);

assert.equal(replacement.status, 200);
const replacementToken = replacement.data.token;
assert.notEqual(replacementToken, currentToken);

const staleRelease = await readResponse(
  await lock.fetch(request("/release", currentToken))
);

assert.equal(staleRelease.status, 409);
assert.equal(lock.lockRecord.token, replacementToken);

const validRelease = await readResponse(
  await lock.fetch(request("/release", replacementToken))
);

assert.equal(validRelease.status, 200);
assert.equal(lock.lockRecord, null);
assert.equal(await storage.get("paper-lock"), undefined);

console.log("PASS 8: stale release cannot clear replacement lock");

console.log("");
console.log("ALL 8 SYNTHETIC TESTS PASSED");
console.log("External requests: 0");
console.log("Real KV access: 0");
console.log("Account state changes: 0");

