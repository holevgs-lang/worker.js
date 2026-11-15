const PAPER_LOCK_RENEW_INTERVAL_MS = 10;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function withPaperLock(env, task) {
  if (!env.PAPER_LOCK) {
    throw new Error("Durable Object PAPER_LOCK не подключён");
  }

  const id = env.PAPER_LOCK.idFromName("okx-smart-trader-paper-account");
  const stub = env.PAPER_LOCK.get(id);

  // Каждый запрос к Durable Object имеет ограниченное время ожидания.
  async function requestPaperLock(path, token, body, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const headers = {
        "Accept": "application/json"
      };

      if (token) {
        headers["X-Paper-Lock-Token"] = token;
      }

      const options = {
        method: "POST",
        headers,
        signal: controller.signal
      };

      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }

      const response = await stub.fetch(
        `https://paper-lock${path}`,
        options
      );

      let data;

      try {
        data = await response.json();
      } catch {
        throw new Error("Durable Object вернул некорректный JSON");
      }

      if (!response.ok || data?.ok !== true) {
        throw new Error(
          data?.error || `HTTP ${response.status}`
        );
      }

      return data;

    } catch (error) {
      if (timedOut) {
        throw new Error(
          `PaperLock ${path}: превышено время ожидания ${timeoutMs} мс`
        );
      }

      throw new Error(
        `PaperLock ${path}: ${String(error)}`
      );

    } finally {
      clearTimeout(timeout);
    }
  }

  // Получаем блокировку.
  const acquireData = await requestPaperLock(
    "/acquire",
    null,
    undefined,
    15000
  );

  const token = acquireData.token;

  if (typeof token !== "string" || !token) {
    throw new Error("PaperLock: не получен токен блокировки");
  }

  let heartbeatError = null;
  let heartbeatStopped = false;
  let stopHeartbeatResolve;

  const stopHeartbeatSignal = new Promise(resolve => {
    stopHeartbeatResolve = resolve;
  });

  // Продлеваем блокировку до завершения основной операции.
  const heartbeat = (async () => {
    while (!heartbeatStopped) {
      const action = await Promise.race([
        sleep(PAPER_LOCK_RENEW_INTERVAL_MS).then(() => "renew"),
        stopHeartbeatSignal.then(() => "stop")
      ]);

      if (action === "stop" || heartbeatStopped) {
        return;
      }

      try {
        await requestPaperLock(
          "/renew",
          token,
          undefined,
          20000
        );
      } catch (error) {
        heartbeatError = error;
        return;
      }
    }
  })();

  // Все записи состояния проходят через Durable Object.
  const lock = {
    put: async (key, value) => {
      if (heartbeatError) {
        throw new Error(
          "Запись запрещена: heartbeat блокировки завершился ошибкой: " +
          String(heartbeatError)
        );
      }

      const result = await requestPaperLock(
        "/put",
        token,
        { key, value },
        30000
      );

      if (heartbeatError) {
        throw new Error(
          "Запись завершена с неопределённым состоянием heartbeat: " +
          String(heartbeatError)
        );
      }

      return result;
    }
  };

  let taskError = null;

  try {
    const result = await task(lock);

    if (heartbeatError) {
      throw new Error(
        "PaperLock потерял подтверждение продления блокировки: " +
        String(heartbeatError)
      );
    }

    return result;

  } catch (error) {
    taskError = error;
    throw error;

  } finally {
    // Останавливаем heartbeat и дожидаемся завершения текущего запроса.
    heartbeatStopped = true;
    stopHeartbeatResolve();

    await heartbeat;

    let cleanupError = null;

    if (heartbeatError && !taskError) {
      cleanupError = new Error(
        "Ошибка heartbeat PaperLock: " + String(heartbeatError)
      );
    }

    // Освобождение блокировки также ограничено по времени.
    try {
      await requestPaperLock(
        "/release",
        token,
        undefined,
        10000
      );
    } catch (releaseError) {
      if (!taskError && !cleanupError) {
        cleanupError = releaseError;
      } else {
        console.error(
          "PaperLock release failed",
          String(releaseError)
        );
      }
    }

    if (cleanupError) {
      throw cleanupError;
    }
  }
}

export { withPaperLock };