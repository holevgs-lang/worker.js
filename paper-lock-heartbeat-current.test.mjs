import { withPaperLock } from "./paper-lock-function-current-under-test.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function response(data, ok = true) {
  return { ok, json: async () => data };
}

function deferred() {
  let resolve;
  const promise = new Promise(r => resolve = r);
  return { promise, resolve };
}

function createEnv(options = {}) {
  const stats = {
    renewCalls: 0,
    putCalls: 0,
    releaseCalls: 0
  };

  const renewGate = deferred();
  const putGate = deferred();

  const stub = {
    async fetch(url) {
      if (url.endsWith("/acquire")) {
        return response({ ok: true, token: "test-token" });
      }

      if (url.endsWith("/renew")) {
        stats.renewCalls++;

        if (options.renew === "fail") {
          return response({ ok: false, error: "SYNTHETIC_RENEW_FAILURE" }, false);
        }

        if (options.renew === "hold") {
          await renewGate.promise;
          return response({ ok: true });
        }

        return response({ ok: true });
      }

      if (url.endsWith("/put")) {
        stats.putCalls++;

        if (options.holdPut) {
          await putGate.promise;
        }

        return response({ ok: true });
      }

      if (url.endsWith("/release")) {
        stats.releaseCalls++;
        return response({ ok: true });
      }

      throw new Error("Unexpected URL: " + url);
    }
  };

  return {
    env: {
      PAPER_LOCK: {
        idFromName: () => "synthetic-id",
        get: () => stub
      }
    },
    stats,
    renewGate,
    putGate
  };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log("PASS:", name);
  } catch (error) {
    console.error("FAIL:", name, "-", error.message);
    process.exitCode = 1;
  }
}

await runTest("14: heartbeat failure blocks subsequent KV writes", async () => {
  const mock = createEnv({ renew: "fail" });

  let blocked = false;

  await withPaperLock(mock.env, async lock => {
    await sleep(30);

    try {
      await lock.put("paper:state", "{}");
    } catch (error) {
      blocked = true;
    }
  }).then(
    () => { throw new Error("Expected heartbeat failure"); },
    error => {
      if (!String(error).includes("SYNTHETIC_RENEW_FAILURE")) throw error;
    }
  );

  if (!blocked) throw new Error("KV write was not blocked");
  if (mock.stats.putCalls !== 0) throw new Error("Unexpected KV write");
  if (mock.stats.releaseCalls !== 1) throw new Error("Lock was not released");
});

await runTest("15: heartbeat failure is detected even if task returns normally", async () => {
  const mock = createEnv({ renew: "fail" });

  let rejected = false;

  try {
    await withPaperLock(mock.env, async () => {
      await sleep(30);
      return "task-result";
    });
  } catch (error) {
    rejected = true;
  }

  if (!rejected) throw new Error("Lost lock was not reported");
  if (mock.stats.releaseCalls !== 1) throw new Error("Lock was not released");
});

await runTest("16: pending renewal delays final completion until it resolves", async () => {
  const mock = createEnv({ renew: "hold" });

  const operation = withPaperLock(mock.env, async () => {
    await sleep(30);
    return "finished";
  });

  const completedEarly = await Promise.race([
    operation.then(() => true, () => true),
    sleep(30).then(() => false)
  ]);

  if (completedEarly) {
    throw new Error("Operation unexpectedly completed while renewal was pending");
  }

  mock.renewGate.resolve();

  const result = await operation;

  if (result !== "finished") throw new Error("Unexpected task result");
  if (mock.stats.releaseCalls !== 1) throw new Error("Lock was not released");
});

await runTest("17: in-flight KV write may finish after heartbeat failure", async () => {
  const mock = createEnv({
    renew: "fail",
    holdPut: true
  });

  const operation = withPaperLock(mock.env, async lock => {
    const write = lock.put("paper:state", "{}");

    await sleep(30);
    mock.putGate.resolve();

    await write;
  });

  let rejected = false;

  try {
    await operation;
  } catch (error) {
    rejected = true;
  }

  if (!rejected) throw new Error("Heartbeat failure was not reported");
  if (mock.stats.putCalls !== 1) throw new Error("Expected one in-flight write");
  if (mock.stats.releaseCalls !== 1) throw new Error("Lock was not released");
});

console.log("\nHeartbeat audit finished.");
console.log("No Cloudflare, OKX or real KV requests were made.");

