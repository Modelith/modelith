// e2e の v1 のプラグイン（ADR-0018 §3）。1 つのファイルにまとめた従来型のスクリプト（esbuild の --format=iife の出力と同じ形）。
// コマンドごとに、ホストの振る舞いを確かめるための動きをする：
//   review … 先頭に「// レビュー済み」の行を足す変更を提案する（F-PLUG-5：1 回の「元に戻す」で取り消せる）
//   stale  … 1 つ前の版に対する変更を提案する（F-PLUG-5：適用されない）
//   probe  … 通信・ブラウザの保存場所・親の画面に触れてみて、結果を知らせる（F-PLUG-7：すべて失敗するはず）
//   loop   … 止まらない処理をする（ホストは動き続け、停止できる。期限がきたら知らせる）
//   flood  … 大量の知らせ（notify）を一度に送る（F-PLUG-7：超えた分を捨て、止める）
//   count  … 保存場所の count を 1 増やし、読み直した値を知らせる（storage）
//   big    … 保存場所の上限（1 MB）を超える値を保存してみて、読み直した結果を知らせる（storage）
// 取り込み lines … テキストの 1 行を 1 つの要求にしたモデルを返す（F-PLUG-4）。「失敗」と書いたファイルは failed を返す
// 書き出し text  … 受け取った図の名前と、今のテキストを、そのまま .txt にして返す（F-PLUG-4）
// model:read を宣言していれば、レビューされていない要求ごとに診断を出す。
(() => {
  "use strict";

  // ---- @modelith/plugin-sdk の connectToHost（バンドルに含めたもの） ----
  function connectToHost(endpoint) {
    const isTagged = (data) => typeof data === "object" && data !== null && typeof data.type === "string";
    return {
      onMessage(handler) {
        const listener = (event) => {
          if (isTagged(event.data)) handler(event.data);
        };
        endpoint.addEventListener("message", listener);
        return () => endpoint.removeEventListener("message", listener);
      },
      send(message) {
        endpoint.postMessage(message);
      },
    };
  }

  // ---- プラグインの本体 ----
  const PROBE_URL = "http://localhost:4198";
  const MARK = "// レビュー済み\n";
  const host = connectToHost(self);
  let version = 0;
  let text = "";
  let nextRequest = 1;
  /** 保存場所への依頼の答えを待つもの（依頼の番号 → 答えを受け取る関数）。 */
  const waiting = new Map();

  /** 保存場所に頼み、答え（storageResult）を待つ。 */
  function storage(message) {
    const requestId = nextRequest++;
    return new Promise((resolve) => {
      waiting.set(requestId, resolve);
      host.send({ ...message, requestId });
    });
  }

  /** UTF-8 のテキストと base64 を行き来する。 */
  const toBase64 = (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));
  const fromBase64 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

  /** 要求ごとに、レビューされていないことを知らせる診断を作る。 */
  function diagnostics(model) {
    if (text.startsWith(MARK)) return [];
    return model.elements
      .filter((e) => e.kind === "requirement def")
      .map((e) => ({ range: e.range, severity: "warning", message: `要求「${e.name}」はレビューされていません`, code: "review" }));
  }

  /** 1 つ試して、成功したか（時間内に終わらなければ失敗）を返す。 */
  async function attempt(fn) {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500));
    try {
      await Promise.race([Promise.resolve().then(fn), timeout]);
      return "ok";
    } catch {
      return "blocked";
    }
  }

  /** 通信・保存場所・親の画面に触れてみる。 */
  async function probe() {
    const r = {
      fetch: await attempt(() => fetch(`${PROBE_URL}/fetch`)),
      xhr: await attempt(() => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open("GET", `${PROBE_URL}/xhr`); x.onload = res; x.onerror = rej; x.send(); })),
      ws: await attempt(() => new Promise((res, rej) => { const w = new WebSocket(`${PROBE_URL.replace("http", "ws")}/ws`); w.onopen = res; w.onerror = rej; })),
      es: await attempt(() => new Promise((res, rej) => { const s = new EventSource(`${PROBE_URL}/es`); s.onopen = res; s.onerror = rej; })),
      import: await attempt(() => importScripts(`${PROBE_URL}/remote.js`)),
      storage: typeof localStorage === "undefined" ? "none" : "available",
      idb: await attempt(() => new Promise((res, rej) => { const q = indexedDB.open("modelith-probe"); q.onsuccess = res; q.onerror = () => rej(q.error); })),
      parent: typeof parent === "undefined" ? "none" : "available",
    };
    return Object.entries(r).map(([k, v]) => `${k}=${v}`).join(" ");
  }

  host.onMessage(async (m) => {
    if (m.type === "storageResult") {
      waiting.get(m.requestId)?.(m);
      waiting.delete(m.requestId);
    } else if (m.type === "import") {
      const lines = fromBase64(m.base64).split("\n").filter((l) => l.trim());
      if (lines.includes("失敗")) host.send({ type: "failed", requestId: m.requestId, message: "要求の一覧ではありません" });
      else host.send({ type: "imported", requestId: m.requestId, fileName: m.fileName, text: `package 要求一覧 {\n${lines.map((l) => `    requirement def ${l.trim()};\n`).join("")}}\n` });
    } else if (m.type === "export") {
      host.send({ type: "exported", requestId: m.requestId, fileName: "モデル", mediaType: "text/plain; charset=utf-8", base64: toBase64(`図：${m.view ?? "（なし）"}\n${text}`) });
    } else if (m.type === "activate") host.send({ type: "ready" });
    else if (m.type === "didChange") {
      version = m.version;
      text = m.text;
      if (m.model) host.send({ type: "diagnostics", version, items: diagnostics(m.model) });
    } else if (m.type === "runCommand") {
      const at = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
      if (m.command === "review") host.send({ type: "proposeEdits", version, edits: [{ range: at, newText: MARK }], label: "レビュー済みの印" });
      else if (m.command === "stale") host.send({ type: "proposeEdits", version: version - 1, edits: [{ range: at, newText: MARK }] });
      else if (m.command === "probe") host.send({ type: "notify", level: "info", message: `確認の結果：${await probe()}` });
      else if (m.command === "loop") for (;;) { /* 止まらない */ }
      else if (m.command === "flood") for (let i = 0; i < 5000; i++) host.send({ type: "notify", level: "info", message: `知らせ ${i}` });
      else if (m.command === "count") {
        const now = (await storage({ type: "storageGet", key: "count" })).value ?? 0;
        await storage({ type: "storageSet", key: "count", value: now + 1 });
        host.send({ type: "notify", level: "info", message: `保存した回数：${(await storage({ type: "storageGet", key: "count" })).value}` });
      } else if (m.command === "big") {
        await storage({ type: "storageSet", key: "big", value: "x".repeat(1024 * 1024) });
        const got = await storage({ type: "storageGet", key: "big" });
        host.send({ type: "notify", level: "info", message: `大きな値：${got.value === undefined ? "保存されていません" : "保存されました"}` });
      }
      host.send({ type: "commandDone", requestId: m.requestId });
    }
  });
})();
