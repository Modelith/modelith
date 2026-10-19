// v1 のプラグインの権限の言葉と、隔離用のページ（F-PLUG-7、ADR-0018 §3.1）の単体テスト。
// 隔離用のページは web/public に置いた静的なファイル。2 つのページが CSP の connect-src だけで違うことを確かめる。
import { describe, expect, it } from "vitest";
import STRICT_PAGE from "../../public/plugin-sandbox.html?raw";
import NETWORK_PAGE from "../../public/plugin-sandbox-network.html?raw";
import { NETWORK_SANDBOX_CSP, permissionLines, SANDBOX_CSP, sandboxPage } from "./permissions";
import { commandItems, stopNotice } from "./view";

/**
 * ページの CSP（meta）の中身を取り出す。
 *
 * @param html ページの HTML
 * @returns CSP の文字列。無ければ null
 */
const cspOf = (html: string): string | null => /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] ?? null;

/**
 * ページから、HTML のコメントと CSP の meta を除いたもの（2 つのページで同じはずの部分）。
 *
 * @param html ページの HTML
 * @returns 除いた後の HTML
 */
const body = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");

describe("隔離用のページ（F-PLUG-7）", () => {
  it("外部と通信できないページの CSP は、ADR-0018 §3.1 のとおり", () => {
    // Arrange・Act
    const csp = cspOf(STRICT_PAGE);
    // Assert
    expect(csp).toBe(SANDBOX_CSP);
    expect(csp).toBe("default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'");
  });

  it("外部と通信できるページは、connect-src だけが違う", () => {
    // Arrange・Act
    const csp = cspOf(NETWORK_PAGE);
    // Assert
    expect(csp).toBe(NETWORK_SANDBOX_CSP);
    expect(csp?.replace(/connect-src [^;]*$/, "")).toBe(SANDBOX_CSP.replace(/connect-src [^;]*$/, ""));
  });

  it("2 つのページの起動のコードは同じ", () => {
    // Arrange・Act
    const [strict, network] = [body(STRICT_PAGE), body(NETWORK_PAGE)];
    // Assert
    expect(network).toBe(strict);
  });

  it("Worker の中で、プラグインのコードより先に EventSource・Worker・SharedWorker を消す（ADR-0018 §3.1）", () => {
    // Arrange・Act
    const page = body(STRICT_PAGE);
    // Assert
    expect(page).toContain('for (const name of ["EventSource", "Worker", "SharedWorker"])');
    expect(page.indexOf("PRELUDE, \"\\n\", data.code")).toBeGreaterThan(0);
  });
});

describe("sandboxPage（ページの選び方）", () => {
  it.each<[Parameters<typeof sandboxPage>[0], string]>([
    [[], "plugin-sandbox.html"],
    [["model:read", "edits:propose", "storage"], "plugin-sandbox.html"],
    [["network"], "plugin-sandbox-network.html"],
  ])("%o → %s", (permissions, page) => {
    // Arrange・Act
    const got = sandboxPage(permissions);
    // Assert
    expect(got).toBe(page);
  });
});

describe("permissionLines（権限の言葉）", () => {
  it("宣言の順に、言葉とマニフェストの名前を並べる", () => {
    // Arrange・Act
    const got = permissionLines(["network", "storage"]);
    // Assert
    expect(got).toEqual(["インターネットなど外部と通信する（network）", "このブラウザに、プラグイン用のデータを保存する（storage）"]);
  });

  it("権限が無ければ、無いことを示す（境界値: 0 個）", () => {
    // Arrange・Act
    const got = permissionLines([]);
    // Assert
    expect(got).toEqual(["追加の権限はありません"]);
  });
});

describe("commandItems・stopNotice（メニューと停止の知らせ）", () => {
  it("実行中のプラグインのコマンドだけを、メニューの項目にする", () => {
    // Arrange
    const commands = [{ id: "fill", title: "要求に ID を付ける" }];
    // Act
    const got = commandItems([
      { id: "jp.a", name: "要求の ID の補完", state: "running", commands },
      { id: "jp.b", name: "起動中のもの", state: "starting", commands },
      { id: "jp.c", name: "止めたもの", state: "stopped", commands },
    ]);
    // Assert
    expect(got).toEqual([{ plugin: "jp.a", command: "fill", label: "要求に ID を付ける", tooltip: "プラグイン「要求の ID の補完」のコマンド" }]);
  });

  it("止めたときは、止まったと言い切らない（ADR-0018 §3.1）", () => {
    // Arrange・Act
    const got = stopNotice("要求の ID の補完");
    // Assert
    expect(got).toBe("プラグイン「要求の ID の補完」に停止を指示しました。完全に止まるまで数秒かかることがあります");
  });
});
