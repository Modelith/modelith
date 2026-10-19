// v1 のプラグインの許可（F-PLUG-6、ADR-0018 §5）の判断の単体テスト。尋ね直す条件の境界を確かめる。
import { describe, expect, it } from "vitest";
import type { Permission } from "./generated/protocol";
import { parseTrustStore, trustCheck, trustPrompt, trustRecord, type TrustRecord, type TrustSubject } from "./trust";

/** 許可を覚えた答え。 */
const allowed = (permissions: Permission[], over: Partial<TrustRecord> = {}): TrustRecord => ({ decision: "allowed", permissions, version: "1.0.0", sha256: "aa", ...over });
/** 今のプラグイン。 */
const now = (permissions: Permission[], over: Partial<TrustSubject> = {}): TrustSubject => ({ permissions, version: "1.0.0", sha256: "aa", ...over });

describe("trustCheck（尋ねるか）", () => {
  it("F-PLUG-6: 初めて動かすときは尋ねる", () => {
    // Arrange・Act
    const got = trustCheck(undefined, now([]));
    // Assert
    expect(got).toEqual({ kind: "ask", reason: "first", added: [] });
  });

  it("F-PLUG-6: 同じプラグインは、尋ねずに動かす", () => {
    // Arrange・Act
    const got = trustCheck(allowed(["model:read", "network"]), now(["network", "model:read"]));
    // Assert
    expect(got).toEqual({ kind: "allowed" });
  });

  it("F-PLUG-6: 権限が 1 つ増えたら、増えた権限を添えて尋ねる（境界値: +1）", () => {
    // Arrange・Act
    const got = trustCheck(allowed(["model:read"]), now(["model:read", "edits:propose"]));
    // Assert
    expect(got).toEqual({ kind: "ask", reason: "permissions", added: ["edits:propose"] });
  });

  it("F-PLUG-6: 権限が減っただけなら、尋ねない（境界値: -1）", () => {
    // Arrange・Act
    const got = trustCheck(allowed(["model:read", "edits:propose"]), now(["model:read"]));
    // Assert
    expect(got).toEqual({ kind: "allowed" });
  });

  it("F-PLUG-6: 権限を入れ替えたら（数は同じ）、増えた権限について尋ねる", () => {
    // Arrange・Act
    const got = trustCheck(allowed(["model:read"]), now(["storage"]));
    // Assert
    expect(got).toEqual({ kind: "ask", reason: "permissions", added: ["storage"] });
  });

  it.each([
    ["ファイル", { sha256: "bb" }],
    ["バージョン", { version: "1.0.1" }],
  ])("F-PLUG-6: 外部と通信できるプラグインの%sが変わったら、尋ねる", (_, change) => {
    // Arrange・Act
    const got = trustCheck(allowed(["network"]), now(["network"], change));
    // Assert
    expect(got).toEqual({ kind: "ask", reason: "changed", added: [] });
  });

  it.each([
    ["ファイル", { sha256: "bb" }],
    ["バージョン", { version: "2.0.0" }],
  ])("F-PLUG-6: 外部と通信できないプラグインは、%sが変わっても尋ねない", (_, change) => {
    // Arrange・Act
    const got = trustCheck(allowed(["model:read", "edits:propose"]), now(["model:read", "edits:propose"], change));
    // Assert
    expect(got).toEqual({ kind: "allowed" });
  });

  it("F-PLUG-6: 外部との通信が新しく増えたら、権限が増えたとして尋ねる", () => {
    // Arrange・Act
    const got = trustCheck(allowed(["model:read"]), now(["model:read", "network"], { sha256: "bb" }));
    // Assert
    expect(got).toEqual({ kind: "ask", reason: "permissions", added: ["network"] });
  });

  it("F-PLUG-6: 許可しなかったプラグインは、変わっても尋ねない（一覧の「許可する…」で尋ねる）", () => {
    // Arrange・Act
    const got = trustCheck({ ...allowed([]), decision: "denied" }, now(["network"], { sha256: "bb" }));
    // Assert
    expect(got).toEqual({ kind: "denied" });
  });
});

describe("trustRecord・parseTrustStore（覚える形）", () => {
  it("権限を名前の順にそろえて覚える", () => {
    // Arrange・Act
    const got = trustRecord("allowed", now(["network", "edits:propose"], { sha256: "cc" }));
    // Assert
    expect(got).toEqual({ decision: "allowed", permissions: ["edits:propose", "network"], version: "1.0.0", sha256: "cc" });
  });

  it("覚えた JSON を読み戻せる（正常系）", () => {
    // Arrange
    const store = { format: 1 as const, plugins: { "jp.x": allowed(["model:read"]) } };
    // Act
    const got = parseTrustStore(JSON.stringify(store));
    // Assert
    expect(got).toEqual(store);
  });

  it.each([
    ["何も覚えていない", null],
    ["壊れた JSON", "{"],
    ["知らない形式", '{"format":2,"plugins":{}}'],
    ["plugins が無い", '{"format":1}'],
  ])("%s なら、何も覚えていないものとして扱う（異常系）", (_, text) => {
    // Arrange・Act
    const got = parseTrustStore(text);
    // Assert
    expect(got).toEqual({ format: 1, plugins: {} });
  });

  it("形の違う項目は捨て、ほかの項目は残す（尋ね直すほうに倒す）", () => {
    // Arrange
    const text = JSON.stringify({ format: 1, plugins: { "jp.a": allowed([]), "jp.b": { decision: "maybe" }, "jp.c": { ...allowed([]), permissions: ["fs"] } } });
    // Act
    const got = parseTrustStore(text);
    // Assert
    expect(Object.keys(got.plugins)).toEqual(["jp.a"]);
  });
});

describe("trustPrompt（許可を尋ねるダイアログの中身）", () => {
  const plugin = { name: "要求の ID の補完", id: "jp.example.fill", version: "1.0.0", permissions: ["model:read", "edits:propose"] as Permission[] };

  it("F-PLUG-6: 名前・ID・バージョンと、使う権限を示す", () => {
    // Arrange・Act
    const got = trustPrompt(plugin, { kind: "ask", reason: "first", added: [] });
    // Assert
    expect(got).toEqual({
      title: "プラグインの実行の許可",
      text: "プラグイン「要求の ID の補完」（ID：jp.example.fill、バージョン 1.0.0）を初めて実行します。このプラグインはプログラムを含みます。アプリとは切り離された場所で動き、開いているモデルのテキストを受け取って、次の権限だけを使えます。実行を許可しますか？",
      items: ["解析したモデル（要素と関係）を受け取り、問題一覧に結果を出す（model:read）", "モデルのテキストを変更する（変更は元に戻せます）（edits:propose）"],
      warning: undefined,
      confirm: "許可して実行",
      cancel: "許可しない",
    });
  });

  it("F-PLUG-6: 外部と通信できるプラグインは、モデルを外部に送信できることを示す", () => {
    // Arrange・Act
    const got = trustPrompt({ ...plugin, permissions: ["network"] }, { kind: "ask", reason: "first", added: [] });
    // Assert
    expect(got.warning).toBe("このプラグインは、あなたのモデルを外部に送信できます。提供元を信頼できる場合だけ許可してください。");
  });

  it("F-PLUG-6: 尋ね直す理由を示す（権限が増えた・中身が変わった）", () => {
    // Arrange・Act
    const grew = trustPrompt(plugin, { kind: "ask", reason: "permissions", added: ["edits:propose"] });
    const changed = trustPrompt({ ...plugin, permissions: ["network"] }, { kind: "ask", reason: "changed", added: [] });
    // Assert
    expect(grew.text).toMatch(/^プラグイン「要求の ID の補完」（ID：jp.example.fill、バージョン 1.0.0）の使う権限が、前回許可したときより増えました（増えた権限：モデルのテキストを変更する（変更は元に戻せます））。/);
    expect(changed.text).toMatch(/^外部と通信できるプラグイン「要求の ID の補完」（ID：jp.example.fill、バージョン 1.0.0）のバージョンかファイルが、前回許可したときから変わりました。/);
  });
});
