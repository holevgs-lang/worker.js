import { withPaperLock } from "./paper-lock-function-under-test.mjs";

function response(data, ok = true) {
  return { ok, json: async () => data };
}

function createEnv(options = {}) {
  const stats = { acquire: 0, release: 0 };
  let locked = false;
  let releaseFailOnce = options.releaseFailOnce || false;

  const stub = {
    async fetch(url) {
      if (url.endsWith("/acquire")) {
        stats.acquire++;

        if (locked) {
          return response({ ok: false, error: "SYNTHETIC_LOCK_BUSY" }, false);
        }

        locked = true;
        return response({ ok: true, token: "test-token" });
      }

      if (url.endsWith("/release")) {
        stats.release++;

        if (releaseFailOnce) {
          releaseFailOnce = false;
          return response({ ok: false, error: "SYNTHETIC_RELEASE_FAILURE" }, false);
        }

        locked = false;
        return response({ ok: true });
      }

      if (url.endsWith("/renew")) {
        return response({ ok: true });
      }

      if (url.endsWith("/put")) {
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
    expireLock: () => { locked = false; }
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

await test("18: task error and release error are both preserved", async () => {
  const mock = createEnv({ releaseFailOnce: true });
  let caught;

  try {
    await withPaperLock(mock.env, async () => {
      throw new Error("TASK_FAILURE");
    });
  } catch (error) {
    caught = error;
  }

  if (!caught) throw new Error("Expected combined error");
  if (!String(caught).includes("TASK_FAILURE")) throw new Error("Task error missing");
  if (!String(caught).includes("SYNTHETIC_RELEASE_FAILURE")) {
    throw new Error("Release error missing");
  }
  if (caught.cause?.message !== "TASK_FAILURE") {
    throw new Error("Original error not preserved in cause");
  }
  if (!String(caught.releaseError).includes("SYNTHETIC_RELEASE_FAILURE")) {
    throw new Error("releaseError property missing");
  }
});

await test("19: release error is propagated when task succeeds", async () => {
  const mock = createEnv({ releaseFailOnce: true });
  let caught;

  try {
    await withPaperLock(mock.env, async () => "OK");
  } catch (error) {
    caught = error;
  }

  if (!caught || !String(caught).includes("SYNTHETIC_RELEASE_FAILURE")) {
    throw new Error("Release failure was not propagated");
  }
});

await test("20: original task error survives when release succeeds", async () => {
  const mock = createEnv();
  let caught;

  try {
    await withPaperLock(mock.env, async () => {
      throw new Error("ORIGINAL_TASK_FAILURE");
    });
  } catch (error) {
    caught = error;
  }

  if (caught?.message !== "ORIGINAL_TASK_FAILURE") {
    throw new Error("Original task error was replaced");
  }

  if (mock.stats.release !== 1) {
    throw new Error("Release was not attempted");
  }
});

await test("21: lock becomes available after simulated lease expiry", async () => {
  const mock = createEnv({ releaseFailOnce: true });

  try {
    await withPaperLock(mock.env, async () => "FIRST");
  } catch (error) {
    if (!String(error).includes("SYNTHETIC_RELEASE_FAILURE")) throw error;
  }

  let blocked = false;

  try {
    await withPaperLock(mock.env, async () => "SECOND");
  } catch (error) {
    blocked = String(error).includes("SYNTHETIC_LOCK_BUSY");
  }

  if (!blocked) throw new Error("Lock was not retained after failed release");

  mock.expireLock();

  const result = await withPaperLock(mock.env, async () => "RECOVERED");

  if (result !== "RECOVERED") throw new Error("Operation did not recover");
});

console.log("\nRelease failure audit finished.");
console.log("Synthetic tests only. No Cloudflare, OKX or real KV requests.");
