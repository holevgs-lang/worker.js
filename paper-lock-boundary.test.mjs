import assert from "node:assert/strict";
import { PaperLock } from "./worker-lock-source.mjs";

class MemoryStorage {
  constructor() {
    this.data = new Map();
    this.failPut = false;
    this.failDelete = false;
  }
  async get(key) {
    return this.data.get(key);
  }
  async put(key, value) {
    if (this.failPut) throw new Error("SYNTHETIC_STORAGE_PUT_FAILURE");
    this.data.set(key, structuredClone(value));
  }
  async delete(key) {
    if (this.failDelete) throw new Error("SYNTHETIC_STORAGE_DELETE_FAILURE");
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
  }
  async put(key, value) {
    this.data.set(key, value);
  }
}

function makeRequest(path, token, rawBody) {
  const headers = {};
  if (token) headers["X-Paper-Lock-Token"] = token;
  if (rawBody !== undefined) headers["Content-Type"] = "application/json";

  return new Request("https://paper-lock" + path, {
    method: "POST",
    headers,
    body: rawBody
  });
}

async function result(response) {
  return {
    status: response.status,
    data: await response.json()
  };
}

function fixture(withKV = true) {
  const storage = new MemoryStorage();
  const state = new MemoryState(storage);
  const env = withKV ? { TRADER_KV: new MemoryKV() } : {};
  const lock = new PaperLock(state, env);
  return { storage, state, env, lock };
}

async function acquire(lock) {
  const r = await result(await lock.fetch(makeRequest("/acquire")));
  assert.equal(r.status, 200);
  return r.data.token;
}

// TEST 9: Некорректный JSON отклоняется
{
  const f = fixture();
  await f.lock.ready;
  const token = await acquire(f.lock);

  const r = await result(
    await f.lock.fetch(
      makeRequest("/put", token, '{"key": "paper:state",')
    )
  );

  assert.equal(r.status, 400);
  assert.equal(f.env.TRADER_KV.data.size, 0);
  console.log("PASS 9: malformed JSON rejected without KV write");
}

// TEST 10: Запрещённый KV-ключ отклоняется
{
  const f = fixture();
  await f.lock.ready;
  const token = await acquire(f.lock);

  const r = await result(
    await f.lock.fetch(
      makeRequest("/put", token, JSON.stringify({
        key: "connection_test",
        value: "SHOULD_NOT_BE_WRITTEN"
      }))
    )
  );

  assert.equal(r.status, 400);
  assert.equal(f.env.TRADER_KV.data.size, 0);
  console.log("PASS 10: forbidden KV key rejected");
}

// TEST 11: Отсутствующий TRADER_KV не приводит к записи
{
  const f = fixture(false);
  await f.lock.ready;
  const token = await acquire(f.lock);

  const r = await result(
    await f.lock.fetch(
      makeRequest("/put", token, JSON.stringify({
        key: "paper:state",
        value: "SYNTHETIC"
      }))
    )
  );

  assert.equal(r.status, 500);
  assert.equal(f.lock.lockRecord.token, token);
  console.log("PASS 11: missing KV binding handled; lock retained");
}

// TEST 12: Ошибка сохранения блокировки не меняет lockRecord
{
  const f = fixture();
  await f.lock.ready;

  f.storage.failPut = true;

  await assert.rejects(
    f.lock.fetch(makeRequest("/acquire")),
    /SYNTHETIC_STORAGE_PUT_FAILURE/
  );

  assert.equal(f.lock.lockRecord, null);
  assert.equal(await f.storage.get("paper-lock"), undefined);
  console.log("PASS 12: storage put failure does not create in-memory lock");
}

// TEST 13: Ошибка удаления блокировки не очищает lockRecord
{
  const f = fixture();
  await f.lock.ready;
  const token = await acquire(f.lock);

  f.storage.failDelete = true;

  await assert.rejects(
    f.lock.fetch(makeRequest("/release", token)),
    /SYNTHETIC_STORAGE_DELETE_FAILURE/
  );

  assert.equal(f.lock.lockRecord.token, token);
  assert.equal((await f.storage.get("paper-lock")).token, token);
  console.log("PASS 13: storage delete failure preserves lock record");

  f.storage.failDelete = false;

  const release = await result(
    await f.lock.fetch(makeRequest("/release", token))
  );

  assert.equal(release.status, 200);
  assert.equal(f.lock.lockRecord, null);
  assert.equal(await f.storage.get("paper-lock"), undefined);
  console.log("PASS 13b: release succeeds after storage recovery");
}

console.log("");
console.log("ALL 5 ADDITIONAL TESTS PASSED");
console.log("External requests: 0");
console.log("Real KV access: 0");
console.log("Account state changes: 0");
