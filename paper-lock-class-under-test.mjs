const PAPER_LOCK_TTL_MS = 300;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });

export class PaperLock {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.lockRecord = null;
    this.queue = Promise.resolve();

    this.ready = this.state.blockConcurrencyWhile(async () => {
      this.lockRecord = await this.state.storage.get("paper-lock") || null;
    });
  }

  runExclusive(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method !== "POST") {
      return json({ ok: false, error: "Р В Р В°Р В·РЎР‚Р ВµРЎв‚¬РЎвЂР Р… РЎвЂљР С•Р В»РЎРЉР С”Р С• POST" }, 405);
    }

    await this.ready;

    if (url.pathname === "/acquire") {
      return this.runExclusive(async () => {
        if (
          this.lockRecord &&
          this.lockRecord.expiresAt > Date.now()
        ) {
          return json({
            ok: false,
            error: "Р вЂ™Р С‘РЎР‚РЎвЂљРЎС“Р В°Р В»РЎРЉР Р…РЎвЂ№Р в„– РЎРѓРЎвЂЎРЎвЂРЎвЂљ РЎС“Р В¶Р Вµ Р С•Р В±РЎР‚Р В°Р В±Р В°РЎвЂљРЎвЂ№Р Р†Р В°Р ВµРЎвЂљРЎРѓРЎРЏ Р Т‘РЎР‚РЎС“Р С–Р С‘Р С Р В·Р В°Р С—РЎР‚Р С•РЎРѓР С•Р С"
          }, 409);
        }

        const token = crypto.randomUUID();
        const nextLock = {
          token,
          expiresAt: Date.now() + PAPER_LOCK_TTL_MS
        };

        await this.state.storage.put("paper-lock", nextLock);
        this.lockRecord = nextLock;

        return json({ ok: true, token });
      });
    }

    if (url.pathname === "/renew") {
      return this.runExclusive(async () => {
        const token = request.headers.get("X-Paper-Lock-Token");
        if (!token || !this.lockRecord || this.lockRecord.token !== token || this.lockRecord.expiresAt <= Date.now()) {
          return json({ ok: false, error: "Р вЂР В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С”Р В° Р С‘РЎРѓРЎвЂљР ВµР С”Р В»Р В° Р С‘Р В»Р С‘ РЎвЂљР С•Р С”Р ВµР Р… Р Р…Р ВµР Т‘Р ВµР в„–РЎРѓРЎвЂљР Р†Р С‘РЎвЂљР ВµР В»Р ВµР Р…" }, 409);
        }
        const nextLock = {
          ...this.lockRecord,
          expiresAt: Date.now() + PAPER_LOCK_TTL_MS
        };

        await this.state.storage.put("paper-lock", nextLock);
        this.lockRecord = nextLock;

        return json({ ok: true, expiresAt: nextLock.expiresAt });
      });
    }

    if (url.pathname === "/put") {
      return this.runExclusive(async () => {
        const token = request.headers.get("X-Paper-Lock-Token");

        if (
          !token ||
          !this.lockRecord ||
          this.lockRecord.token !== token ||
          this.lockRecord.expiresAt <= Date.now()
        ) {
          return json({
            ok: false,
            error: "Р вЂ”Р В°Р С—Р С‘РЎРѓРЎРЉ Р С•РЎвЂљР С”Р В»Р С•Р Р…Р ВµР Р…Р В°: Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С”Р В° Р С‘РЎРѓРЎвЂљР ВµР С”Р В»Р В° Р С‘Р В»Р С‘ РЎвЂљР С•Р С”Р ВµР Р… Р Р…Р ВµР Т‘Р ВµР в„–РЎРѓРЎвЂљР Р†Р С‘РЎвЂљР ВµР В»Р ВµР Р…"
          }, 409);
        }

        if (!this.env.TRADER_KV) {
          return json({
            ok: false,
            error: "TRADER_KV Р Р…Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎРЎвЂР Р…"
          }, 500);
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            ok: false,
            error: "Р СњР ВµР С”Р С•РЎР‚РЎР‚Р ВµР С”РЎвЂљР Р…Р С•Р Вµ РЎвЂљР ВµР В»Р С• Р В·Р В°Р С—РЎР‚Р С•РЎРѓР В°"
          }, 400);
        }

        const allowedKeys = new Set([
          "paper:state",
          "paper:instruments"
        ]);

        if (
          !body ||
          !allowedKeys.has(body.key) ||
          typeof body.value !== "string"
        ) {
          return json({
            ok: false,
            error: "Р СњР ВµР Т‘Р С•Р С—РЎС“РЎРѓРЎвЂљР С‘Р СРЎвЂ№Р в„– Р С”Р В»РЎР‹РЎвЂЎ Р С‘Р В»Р С‘ Р В·Р Р…Р В°РЎвЂЎР ВµР Р…Р С‘Р Вµ KV"
          }, 400);
        }

        await this.env.TRADER_KV.put(body.key, body.value);

        return json({
          ok: true,
          key: body.key
        });
      });
    }
    if (url.pathname === "/release") {
      return this.runExclusive(async () => {
        const token = request.headers.get("X-Paper-Lock-Token");

        if (!token) {
          return json({
            ok: false,
            error: "Р СњР Вµ Р С—Р ВµРЎР‚Р ВµР Т‘Р В°Р Р… РЎвЂљР С•Р С”Р ВµР Р… Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С”Р С‘"
          }, 400);
        }

        if (!this.lockRecord || this.lockRecord.token !== token) {
          return json({ ok: false }, 409);
        }

        await this.state.storage.delete("paper-lock");
        this.lockRecord = null;

        return json({ ok: true });
      });
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
}

