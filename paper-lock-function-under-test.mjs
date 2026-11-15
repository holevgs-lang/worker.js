const PAPER_LOCK_RENEW_INTERVAL_MS = 10;

async function withPaperLock(env, task) {
  if (!env.PAPER_LOCK) {
    throw new Error("Durable Object PAPER_LOCK is not connected");
  }

  const id = env.PAPER_LOCK.idFromName("okx-smart-trader-paper-account");
  const stub = env.PAPER_LOCK.get(id);

  const acquireResponse = await stub.fetch(
    "https://paper-lock/acquire",
    { method: "POST" }
  );
  const acquireData = await acquireResponse.json();

  if (!acquireResponse.ok || !acquireData.ok || !acquireData.token) {
    throw new Error(acquireData.error || "Failed to acquire paper account lock");
  }

  const token = acquireData.token;

  let stopHeartbeat;
  let heartbeatError = null;

  const stopSignal = new Promise(resolve => {
    stopHeartbeat = resolve;
  });

  const heartbeat = (async () => {
    while (true) {
      let heartbeatTimer;

      const outcome = await Promise.race([
        new Promise(resolve => {
          heartbeatTimer = setTimeout(
            () => resolve("renew"),
            PAPER_LOCK_RENEW_INTERVAL_MS
          );
        }),
        stopSignal.then(() => "stop")
      ]);

      if (heartbeatTimer !== undefined) {
        clearTimeout(heartbeatTimer);
      }

      if (outcome === "stop") return;

      try {
        const renewResponse = await stub.fetch(
          "https://paper-lock/renew",
          {
            method: "POST",
            headers: { "X-Paper-Lock-Token": token }
          }
        );

        const renewData = await renewResponse.json();

        if (!renewResponse.ok || !renewData.ok) {
          throw new Error(
            renewData.error || "Failed to renew paper account lock"
          );
        }
      } catch (error) {
        heartbeatError = error;
        return;
      }
    }
  })();

  const lock = {
    put: async (key, value) => {
      if (heartbeatError) {
        throw new Error(
          "Lock heartbeat failed; KV write blocked: " + String(heartbeatError)
        );
      }

      const response = await stub.fetch(
        "https://paper-lock/put",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Paper-Lock-Token": token
          },
          body: JSON.stringify({ key, value })
        }
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || "Protected KV write rejected"
        );
      }

      return data;
    }
  };

  let result;
  let taskError = null;

  try {
    result = await task(lock);

    if (heartbeatError) {
      throw new Error(
        "Paper account lock was lost: " + String(heartbeatError)
      );
    }
  } catch (error) {
    taskError = error;
  } finally {
    stopHeartbeat();
    await heartbeat;

    if (heartbeatError && !taskError) {
      taskError = new Error(
        "Paper account lock was lost: " + String(heartbeatError)
      );
    }

    try {
      const releaseResponse = await stub.fetch(
        "https://paper-lock/release",
        {
          method: "POST",
          headers: { "X-Paper-Lock-Token": token }
        }
      );

      const releaseData = await releaseResponse.json();

      if (!releaseResponse.ok || !releaseData.ok) {
        throw new Error(
          releaseData.error || "Failed to release paper account lock"
        );
      }
    } catch (releaseError) {
      if (taskError) {
        const combinedError = new Error(
          "Task failed: " + String(taskError) +
          "; lock release also failed: " + String(releaseError)
        );
        combinedError.cause = taskError;
        combinedError.releaseError = releaseError;
        throw combinedError;
      }

      throw releaseError;
    }
  }

  if (taskError) {
    throw taskError;
  }

  return result;
}

export { withPaperLock };