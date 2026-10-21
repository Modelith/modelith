// v1 のプラグインの取り込みと書き出しの判断（F-PLUG-4、ADR-0018 §3・§4）の単体テスト。
import { describe, expect, it } from "vitest";
import { acceptOf, base64Bytes, base64ToBytes, bytesToBase64, exportFileName, importedDocName, mediaTypeOf, sizeText } from "./transfer";

describe("base64Bytes", () => {
  it.each([
    ["詰め物なし", "YWJj", 3],
    ["詰め物 1 つ", "YWI=", 2],
    ["詰め物 2 つ", "YQ==", 1],
    ["空（境界値）", "", 0],
  ])("%s の base64 は、元のバイト数を返す", (_, input, bytes) => {
    // Arrange・Act
    const got = base64Bytes(input);
    // Assert
    expect(got).toBe(bytes);
  });

  it.each([
    ["長さが 4 の倍数でない", "YWJ"],
    ["使えない文字", "Y*=="],
    ["詰め物が 3 つ", "Y==="],
    ["途中の詰め物", "YQ==YWJj"],
  ])("%s ものは null（異常系）", (_, input) => {
    // Arrange・Act
    const got = base64Bytes(input);
    // Assert
    expect(got).toBeNull();
  });
});

describe("bytesToBase64・base64ToBytes", () => {
  it("区切りの大きさ（32 KB）を超えるバイト列も、行き来して元に戻る（境界値）", () => {
    // Arrange
    const bytes = new Uint8Array(0x8000 + 1).map((_, i) => i % 256);
    // Act
    const back = base64ToBytes(bytesToBase64(bytes));
    // Assert
    expect(back).toEqual(bytes);
  });

  it("空のバイト列は空の文字列（境界値）", () => {
    // Arrange・Act
    const got = bytesToBase64(new Uint8Array([]));
    // Assert
    expect(got).toBe("");
  });
});

describe("importedDocName（取り込んだテキストの新しい文書の名前、C-6）", () => {
  it.each([
    ["拡張子を .sysml にする", "要求一覧.reqif", [], "要求一覧.sysml"],
    ["開いている文書と重なれば番号を付ける", "要求一覧.reqif", ["要求一覧.sysml"], "要求一覧-2.sysml"],
    ["番号も重なれば次の番号", "a.reqif", ["a.sysml", "a-2.sysml"], "a-3.sysml"],
    ["パスは最後の名前だけを使う", "../../etc/a.reqif", [], "a.sysml"],
    ["使えない文字は置き換える", "a:b?.xml", [], "a_b_.sysml"],
    ["拡張子が無い", "要求", [], "要求.sysml"],
    ["名前が残らない（境界値）", "../", [], "imported.sysml"],
    ["点で始まる名前は、点を除く", ".hidden", [], "hidden.sysml"],
  ])("%s", (_, fileName, used, expected) => {
    // Arrange・Act
    const got = importedDocName(fileName, new Set(used));
    // Assert
    expect(got).toBe(expected);
  });
});

describe("exportFileName", () => {
  it.each([
    ["宣言と同じ拡張子の名前はそのまま", "要求一覧.csv", ".csv", "要求一覧.csv"],
    ["大文字と小文字の違いは同じ拡張子とみなす", "要求一覧.CSV", ".csv", "要求一覧.CSV"],
    ["拡張子が無ければ補う", "要求一覧", ".csv", "要求一覧.csv"],
    ["点の無い拡張子も補う", "要求一覧", "csv", "要求一覧.csv"],
    ["宣言と違う拡張子は置き換える（異常系）", "要求一覧.html", ".csv", "要求一覧.csv"],
    ["実行ファイルの拡張子も置き換える（異常系）", "report.exe", ".csv", "report.csv"],
    ["拡張子が 2 つあれば最後だけを置き換える", "a.tar.gz", ".csv", "a.tar.csv"],
    ["パスは最後の名前だけを使い、使えない文字を置き換える", "../x/a?.csv", ".csv", "a_.csv"],
    ["パス付きで拡張子が違う", "../x.html", ".csv", "x.csv"],
    ["点で始まる名前は、点を除いてから補う", ".html", ".csv", "html.csv"],
    ["宣言が空なら、名前のまま（境界値）", "a.html", "", "a.html"],
    ["空なら export（境界値）", "", ".csv", "export.csv"],
  ])("%s", (_, fileName, extension, expected) => {
    // Arrange・Act
    const got = exportFileName(fileName, extension);
    // Assert
    expect(got).toBe(expected);
  });
});

describe("mediaTypeOf", () => {
  it.each([
    ["種類/副種類", "text/csv", "text/csv"],
    ["引数つき", "text/csv; charset=utf-8", "text/csv; charset=utf-8"],
    ["形が違う（異常系）", "<script>", "application/octet-stream"],
    ["改行を含む（異常系）", "text/html\n", "application/octet-stream"],
    ["空（境界値）", "", "application/octet-stream"],
  ])("%s", (_, input, expected) => {
    // Arrange・Act
    const got = mediaTypeOf(input);
    // Assert
    expect(got).toBe(expected);
  });
});

describe("acceptOf・sizeText", () => {
  it("拡張子に点を補ってつなぐ", () => {
    // Arrange・Act
    const got = acceptOf([".reqif", "xml"]);
    // Assert
    expect(got).toBe(".reqif,.xml");
  });

  it.each([
    [0, "0 バイト"],
    [1023, "1023 バイト"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [20 * 1024 * 1024, "20 MB"],
  ])("%d バイトは「%s」（境界値）", (bytes, expected) => {
    // Arrange・Act
    const got = sizeText(bytes);
    // Assert
    expect(got).toBe(expected);
  });
});
