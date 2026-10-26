// ファイルの一覧の右クリックのメニュー（F-FILE-19）の単体テスト。
import { describe, expect, it } from "vitest";
import { FILE_MENU_LABEL, deleteFolderText, deleteText, fileMenuItems } from "./file-menu";

describe("fileMenuItems（メニューの項目）", () => {
  it("ファイルは開く・名前の変更・削除・2 つのパスのコピー", () => {
    // Assert
    expect(fileMenuItems("file").filter((a) => a !== null).map((a) => FILE_MENU_LABEL[a])).toEqual(["開く", "名前の変更", "削除…", "パスのコピー", "相対パスのコピー"]);
  });

  it("フォルダは新しいファイル・新しいフォルダー・名前の変更・削除・2 つのパスのコピー", () => {
    // Assert
    expect(fileMenuItems("dir").filter((a) => a !== null)).toEqual(["newFile", "newFolder", "rename", "delete", "copyPath", "copyRelative"]);
  });

  it("開いたフォルダそのものは、名前の変更・削除・相対パスのコピーを出さない（境界値）", () => {
    // Assert
    expect(fileMenuItems("root").filter((a) => a !== null)).toEqual(["newFile", "newFolder", "copyPath"]);
  });
});

describe("deleteText（削除を確かめる文）", () => {
  it("ファイルの名前と元に戻せないことを示し、配置ファイルも消すことを添える", () => {
    // Assert
    expect(deleteText("a.sysml", false, [], "a.layout.json")).toBe(
      "「a.sysml」を削除しますか？ 図の配置のファイル（a.layout.json）も削除します。削除したものは元に戻せません。",
    );
  });

  it("フォルダは中身ごと消すことと、失われる未保存の変更を示す", () => {
    // Assert
    expect(deleteText("models", true, ["b.sysml", "c.sysml"], null)).toBe(
      "フォルダ「models」を中身ごと削除しますか？ 未保存の変更のある「b.sysml」「c.sysml」も閉じ、変更は失われます。削除したものは元に戻せません。",
    );
  });

  it("配置ファイルも未保存の変更も無ければ、名前と元に戻せないことだけ（境界値）", () => {
    // Assert
    expect(deleteText("a.sysml", false, [], null)).toBe("「a.sysml」を削除しますか？ 削除したものは元に戻せません。");
  });
});

describe("deleteFolderText（フォルダごとの削除の確かめ、F-PROJ-4）", () => {
  it("中のすべてが消えることと、元に戻せないことを示す", () => {
    // Assert
    expect(deleteFolderText("project", [])).toBe(
      "フォルダ「project」を、中のすべてのファイルごとパソコンから削除しますか？ モデルのファイル以外（画像・文書など）も消えます。削除したものは元に戻せません。",
    );
  });

  it("失われる未保存の変更を示す", () => {
    // Assert
    expect(deleteFolderText("project", ["a.sysml"])).toContain("未保存の変更のある「a.sysml」も閉じ、変更は失われます。");
  });
});
