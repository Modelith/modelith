// C-9 Content-Security-Policy の中身と差し込み（CspTest）
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, injectCsp } from "./csp";

describe("contentSecurityPolicy", () => {
  const directives = new Map(contentSecurityPolicy().split("; ").map((d) => {
    const [name, ...rest] = d.split(" ");
    return [name, rest.join(" ")] as const;
  }));

  it("既定は配信元だけで、使わない種類は閉じる", () => {
    // Assert
    expect(directives.get("default-src")).toBe("'self'");
    expect(directives.get("object-src")).toBe("'none'");
    expect(directives.get("base-uri")).toBe("'none'");
    expect(directives.get("form-action")).toBe("'none'");
  });

  it("スクリプトは配信元と wasm だけで、インラインと eval は許さない（エスケープ漏れの保険）", () => {
    // Assert
    expect(directives.get("script-src")).toBe("'self' 'wasm-unsafe-eval'");
    expect(contentSecurityPolicy()).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(contentSecurityPolicy()).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy()).not.toMatch(/https?:|\*/);
  });

  it("アプリが使うもの（style 属性・data: の favicon・同梱フォント・Worker・隔離の iframe）は許す", () => {
    // Assert
    expect(directives.get("style-src")).toBe("'self' 'unsafe-inline'");
    expect(directives.get("img-src")).toBe("'self' data:");
    expect(directives.get("font-src")).toBe("'self'");
    expect(directives.get("worker-src")).toBe("'self'");
    expect(directives.get("frame-src")).toBe("'self'");
    expect(directives.get("connect-src")).toBe("'self'");
  });

  it("meta では効かない frame-ancestors は書かない", () => {
    // Assert
    expect(directives.has("frame-ancestors")).toBe(false);
  });
});

describe("injectCsp", () => {
  it("charset の <meta> の直後に差し込む（文字コードの判定より後）", () => {
    // Arrange
    const html = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>x</title>\n</head>';
    // Act
    const out = injectCsp(html, "default-src 'self'");
    // Assert
    expect(out).toBe('<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">\n<title>x</title>\n</head>');
  });

  it("charset が無ければ <head> の直後に差し込む（異常系）", () => {
    // Arrange
    const html = "<head>\n<title>x</title>\n</head>";
    // Act
    const out = injectCsp(html, "default-src 'self'");
    // Assert
    expect(out).toBe('<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">\n<title>x</title>\n</head>');
  });

  it("既定のポリシーを 1 回だけ差し込む", () => {
    // Act
    const out = injectCsp('<head>\n<meta charset="utf-8">\n</head>');
    // Assert
    expect(out.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(out).toContain(`content="${contentSecurityPolicy()}"`);
  });
});
