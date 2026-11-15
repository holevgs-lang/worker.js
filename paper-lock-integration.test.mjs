import { PaperLock } from "./paper-lock-class-under-test.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createHarness() {
  const storageData = new Map();
  const kvData = new Map();
  let failKV = false;
  let putStarted = null;
  let putGate = null;
  let releasePutGate = null;

  const storage = {
    async get(key) { return storageData.get(key); },
    async put(key, value) { storageData.set(key, value); },
    async delete(key) { storageData.delete(key); }
  };

  const state = {
    storage,
    blockConcurrencyWhile: callback => callback()
  };

  const env = {
    TRADER_KV: {
      async put(key, value) {
        if (putStarted) putStarted();
        if (putGate) await putGate;
        if (failKV) throw new Error("SYNTHETIC_KV_FAILURE");
        kvData.set(key, value);
      }
    }
  };

  const instance = new PaperLock(state, env);

  async function call(path, token, body) {
    const headers = {};
    if (token) headers["X-Paper-Lock-Token"] = token;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const request = new Request("https://paper-lock" + path, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const result = await instance.fetch(request);
    return {
      status: result.status,
      data: await result.json()
    };
  }

  return {
    call,
    kvData,
    setKVFailure(value) { failKV = value; },
    blockPut() {
      putGate = new Promise(resolve => {
        releasePutGate = resolve;
      });
      return new Promise(resolve => {
        putStarted = resolve;
      });
    },
    releasePut() {
      const resolve = releasePutGate;
      putGate = null;
      releasePutGate = null;
      putStarted = null;
      resolve?.();
    }
  };
}

async function test(name, fn) {
  try {
    await fn();
    console.log("PASS:", name);
  } catch (error) {
    console.error("FAIL:", name, "-", error.message);
    process.exitCode = 1;
  }
}

await test("22: simultaneous acquire grants only one owner", async () => {
  const h = createHarness();

  const results = await Promise.all([
    h.call("/acquire"),
    h.call("/acquire")
  ]);

  assert(results.filter(x => x.data.ok).length === 1, "Expected exactly one owner");
  assert(results.filter(x => x.status === 409).length === 1, "Expected one conflict");
});

await test("23: expired owner's token cannot write after replacement", async () => {
  const h = createHarness();
  const first = await h.call("/acquire");
  await sleep(350);

  const second = await h.call("/acquire");
  assert(second.data.ok, "New owner could not acquire lock");

  const staleWrite = await h.call("/put", first.data.token, {
    key: "paper:state",
    value: "{}"
  });

  assert(staleWrite.status === 409, "Stale write was not rejected");
  assert(h.kvData.size === 0, "Stale owner changed KV");
});

await test("24: stale owner cannot release replacement owner's lock", async () => {
  const h = createHarness();
  const first = await h.call("/acquire");
  await sleep(350);

  const second = await h.call("/acquire");
  assert(second.data.ok, "Replacement lock not acquired");

  const staleRelease = await h.call("/release", first.data.token);
  assert(staleRelease.status === 409, "Stale release was not rejected");

  const anotherAcquire = await h.call("/acquire");
  assert(anotherAcquire.status === 409, "New owner's lock was incorrectly removed");
});

await test("25: in-flight KV write can finish after lease expires", async () => {
  const h = createHarness();
  const owner = await h.call("/acquire");

  const started = h.blockPut();

  const writePromise = h.call("/put", owner.data.token, {
    key: "paper:state",
    value: '{"synthetic":true}'
  });

  await started;
  await sleep(350);
  h.releasePut();

  const write = await writePromise;
  assert(write.data.ok, "Expected already-started write to finish");

  const nextWrite = await h.call("/put", owner.data.token, {
    key: "paper:state",
    value: "{}"
  });

  assert(nextWrite.status === 409, "Expired owner was allowed another write");
});

await test("26: new owner can acquire after lease expiry", async () => {
  const h = createHarness();
  const first = await h.call("/acquire");

  await sleep(350);

  const second = await h.call("/acquire");
  assert(second.data.ok, "New owner could not acquire expired lock");
  assert(second.data.token !== first.data.token, "Token was not replaced");
});

await test("27: KV failure does not destroy valid lock", async () => {
  const h = createHarness();
  const owner = await h.call("/acquire");

  h.setKVFailure(true);

  let failed = false;
  try {
    await h.call("/put", owner.data.token, {
      key: "paper:state",
      value: "{}"
    });
  } catch (error) {
    failed = String(error).includes("SYNTHETIC_KV_FAILURE");
  }

  assert(failed, "Synthetic KV failure was not propagated");

  h.setKVFailure(false);

  const retry = await h.call("/put", owner.data.token, {
    key: "paper:state",
    value: '{"retry":true}'
  });

  assert(retry.data.ok, "Valid owner could not retry write");
});

await test("28: concurrent renew, put and release are serialized", async () => {
  const h = createHarness();
  const owner = await h.call("/acquire");

  const results = await Promise.all([
    h.call("/renew", owner.data.token),
    h.call("/put", owner.data.token, {
      key: "paper:state",
      value: '{"serialized":true}'
    }),
    h.call("/release", owner.data.token)
  ]);

  assert(results.every(x => x.data.ok), "One serialized operation failed");

  const next = await h.call("/acquire");
  assert(next.data.ok, "Lock was not released correctly");
});

console.log("\nPaperLock integration audit finished.");
console.log("Only local synthetic storage and KV were used.");
console.log("No Cloudflare, OKX or working account requests.");

