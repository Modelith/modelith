// e2e の v1 のプラグイン（ADR-0018 §3）。1 つのファイルにまとめた従来型のスクリプト（esbuild の --format=iife の出力と同じ形）。
// コマンドごとに、ホストの振る舞いを確かめるための動きをする：
//   review … 先頭に「// レビュー済み」の行を足す変更を提案する（F-PLUG-5：1 回の「元に戻す」で取り消せる）
//   stale  … 1 つ前の版に対する変更を提案する（F-PLUG-5：適用されない）
//   probe  … 通信・ブラウザの保存場所・親の画面に触れてみて、結果を知らせる（F-PLUG-7：すべて失敗するはず）
//   loop   … 止まらない処理をする（ホストは動き続け、停止できる）
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
    if (m.type === "activate") host.send({ type: "ready" });
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
      host.send({ type: "commandDone", requestId: m.requestId });
    }
  });
})();
