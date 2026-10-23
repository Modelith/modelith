// 他のアプリでのファイルの変更の知らせ（F-FILE-8・F-FILE-18）の単体テスト。
import { describe, expect, it } from "vitest";
import { editStartText, externalNotice, nameList } from "./external-change";

describe("nameList（ファイル名を並べる）", () => {
  it("上限までは名前をすべて並べる（境界値: ちょうど上限）", () => {
    // Assert
    expect(nameList(["a.sysml"])).toBe("「a.sysml」");
    expect(nameList(["a", "b", "c"])).toBe("「a」「b」「c」");
  });

  it("上限を超えた分は「ほか N 件」にまとめる（境界値: 上限 + 1）", () => {
    // Assert
    expect(nameList(["a", "b", "c", "d"])).toBe("「a」「b」「c」ほか 1 件");
    expect(nameList(["a", "b", "c"], 1)).toBe("「a」ほか 2 件");
  });
});

describe("externalNotice（画面に戻ったときの知らせ、F-FILE-8）", () => {
  it("読み直したファイルの名前を示す", () => {
    // Assert
    expect(externalNotice(["a.sysml", "b.sysml"], [])).toBe("他のアプリで変更された「a.sysml」「b.sysml」を読み直しました");
  });

  it("印を付けたファイルは、読み直していないことと、保存するときに選べることを示す", () => {
    // Assert
    expect(externalNotice([], ["c.sysml"])).toBe("「c.sysml」は他のアプリで変更されています。未保存の変更があるため読み直していません。保存するときに選べます");
  });

  it("両方あれば 1 つの知らせにまとめる", () => {
    // Assert
    expect(externalNotice(["a.sysml"], ["c.sysml"])).toBe(
      "他のアプリで変更された「a.sysml」を読み直しました。「c.sysml」は他のアプリで変更されています。未保存の変更があるため読み直していません。保存するときに選べます",
    );
  });

  it("どちらも無ければ知らせない（境界値: 0 件）", () => {
    // Assert
    expect(externalNotice([], [])).toBeNull();
  });
});

describe("editStartText（編集し始めたときに尋ねる文、F-FILE-18）", () => {
  it("ファイル名と、読み込むと入力が消えること・このまま編集したときの扱いを示す", () => {
    // Act
    const text = editStartText("a.sysml");
    // Assert
    expect(text).toContain("「a.sysml」は開いた後に他のアプリで変更されています");
    expect(text).toContain("いま入力した変更は消えます");
    expect(text).toContain("保存するときに上書きするかを選べます");
  });
});
