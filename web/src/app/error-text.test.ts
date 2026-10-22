import { describe, expect, it } from "vitest";
import { ConflictError } from "../files/types";
import { errorText, UNKNOWN_ERROR_TEXT } from "./error-text";

/** 文にラテン文字の語（英語の message）が混じっていないか（日本語の文だけを見せることを確かめる）。 */
const hasEnglishWord = (text: string): boolean => /[A-Za-z]{3,}/.test(text);

describe("errorText：ブラウザのエラーは name ごとの日本語の文（Q-4）", () => {
  it.each<[string, string]>([
    ["NotAllowedError", "フォルダやファイルを編集する許可がありません。もう一度開いて、ブラウザの確認で許可してください"],
    ["NotFoundError", "ファイルが見つかりません。移動したか、削除された可能性があります"],
    ["QuotaExceededError", "保存する場所の空きが足りません。空きを作ってから、もう一度試してください"],
    ["TypeMismatchError", "ファイルとフォルダの種類が合いません。同じ名前のファイルやフォルダが無いか確かめてください"],
    ["AbortError", "操作が取り消されました"],
    ["NoModificationAllowedError", "ファイルが他のアプリで使われているか、書き換えられない状態です。他のアプリを閉じてから、もう一度試してください"],
    ["InvalidStateError", "ファイルが他のアプリで使われているか、書き換えられない状態です。他のアプリを閉じてから、もう一度試してください"],
    ["NotReadableError", "ファイルを読み込めません。他のアプリで使われていないか確かめて、もう一度試してください"],
  ])("%s は決めた文にし、英語の message は見せない", (name, expected) => {
    // Arrange
    const e = new DOMException("The request is not allowed by the user agent or the platform in the current context.", name);
    // Act
    const text = errorText(e);
    // Assert
    expect(text).toBe(expected);
  });

  it("DOMException でなくても、name が同じなら同じ文にする（Error に name を付けたもの）", () => {
    // Arrange
    const e = Object.assign(new Error("not found"), { name: "NotFoundError" });
    // Act
    const text = errorText(e);
    // Assert
    expect(text).toBe("ファイルが見つかりません。移動したか、削除された可能性があります");
  });
});

describe("errorText：分からないエラーは一般的な文（Q-6、異常系）", () => {
  it.each<[string, unknown]>([
    ["知らない名前の DOMException", new DOMException("Failed to execute 'postMessage'", "DataCloneError")],
    ["TypeError（ブラウザの API の断り・プログラムの誤り）", new TypeError("Name is not allowed.")],
    ["SyntaxError", new SyntaxError("Unexpected token < in JSON")],
    ["メッセージの無い Error（境界）", new Error()],
    ["Error でない文字列", "disk full"],
    ["undefined（境界）", undefined],
    ["null（境界）", null],
    ["Object.prototype にある名前（境界：toString）", Object.assign(new Error(), { name: "toString" })],
  ])("%s", (_, e) => {
    // Arrange（e は表の値）
    // Act
    const text = errorText(e);
    // Assert
    expect(text).toBe(UNKNOWN_ERROR_TEXT);
  });

  it("一般的な文は日本語だけで、次の操作を示す", () => {
    // Arrange
    const e = new TypeError("Failed to fetch");
    // Act
    const text = errorText(e);
    // Assert
    expect(hasEnglishWord(text)).toBe(false);
    expect(text).toContain("もう一度試してください");
  });
});

describe("errorText：Modelith のエラーはメッセージをそのまま使う（正常系）", () => {
  it("日本語のメッセージの Error はそのまま", () => {
    // Arrange
    const e = new Error("このフォルダは既にプロジェクトです（modelith.json があります）");
    // Act
    const text = errorText(e);
    // Assert
    expect(text).toBe("このフォルダは既にプロジェクトです（modelith.json があります）");
  });

  it("ConflictError はそのまま", () => {
    // Arrange
    const e = new ConflictError({ provider: "local", id: "a", name: "a.sysml", path: "models/a.sysml" });
    // Act
    const text = errorText(e);
    // Assert
    expect(text).toBe("models/a.sysml は読み込んだ後に変更されています");
  });
});
