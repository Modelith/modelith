import { describe, expect, it } from "vitest";
import { DriveError, RestDriveClient, type DrivePicker, type Http, type HttpResponse, type TokenSource } from "./drive-client";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

const res = (status: number, body: unknown = ""): HttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

/** 決まった応答を順に返す HTTP と、渡したトークンの記録。 */
function setup(...responses: HttpResponse[]) {
  const calls: Call[] = [];
  const http: Http = async (url, init) => {
    calls.push({ url, ...init });
    const r = responses.shift();
    if (!r) throw new Error("想定外の呼び出し");
    return r;
  };
  let n = 0;
  const tokens: TokenSource = { token: async () => `t${n}`, renew: async () => `t${++n}` };
  const picker: DrivePicker = { pickFile: async (t) => ({ id: "f1", name: `picked-with-${t}` }), pickFolder: async () => null };
  return { client: new RestDriveClient(http, tokens, picker), calls };
}

describe("RestDriveClient（ADR-0012）", () => {
  it("メタデータは名前と版だけを取り、トークンを付けて呼ぶ", async () => {
    // Arrange
    const { client, calls } = setup(res(200, { name: "m.sysml", version: "7" }));
    // Act
    const meta = await client.meta("a/b");
    // Assert
    expect(meta).toEqual({ name: "m.sysml", version: "7" });
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://www.googleapis.com/drive/v3/files/a%2Fb?fields=name,version&supportsAllDrives=true");
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer t0");
  });

  it("内容は alt=media で取る", async () => {
    // Arrange
    const { client, calls } = setup(res(200, "package A;"));
    // Act
    const text = await client.download("f1");
    // Assert
    expect(text).toBe("package A;");
    expect(calls[0]?.url).toContain("/drive/v3/files/f1?alt=media");
  });

  it("上書きは upload の PATCH（uploadType=media）で送り、新しい版を返す", async () => {
    // Arrange
    const { client, calls } = setup(res(200, { name: "m.sysml", version: "8" }));
    // Act
    const version = await client.update("f1", "package B;");
    // Assert
    expect(version).toBe("8");
    expect(calls[0]).toMatchObject({ method: "PATCH", body: "package B;", headers: { "Content-Type": "text/plain; charset=utf-8" } });
    expect(calls[0]?.url).toContain("/upload/drive/v3/files/f1?uploadType=media");
  });

  it("新規作成は multipart で、フォルダと名前を指定する", async () => {
    // Arrange
    const { client, calls } = setup(res(200, { id: "new1", name: "u.sysml", version: "1" }));
    // Act
    const item = await client.create("folder-9", "u.sysml", "package U;");
    // Assert
    expect(item).toEqual({ id: "new1", name: "u.sysml", version: "1" });
    expect(calls[0]?.headers["Content-Type"]).toBe("multipart/related; boundary=modelith-boundary");
    expect(calls[0]?.body).toContain('{"name":"u.sysml","parents":["folder-9"],"mimeType":"text/plain"}');
    expect(calls[0]?.body).toContain("\r\n\r\npackage U;\r\n--modelith-boundary--");
  });

  it("401（トークン切れ）なら一度だけ取り直してやり直す", async () => {
    // Arrange
    const { client, calls } = setup(res(401), res(200, "ok"));
    // Act
    const text = await client.download("f1");
    // Assert
    expect(text).toBe("ok");
    expect(calls.map((c) => c.headers["Authorization"])).toEqual(["Bearer t0", "Bearer t1"]);
  });

  it("取り直しても 401 なら、それ以上やり直さず DriveError（異常系）", async () => {
    // Arrange
    const { client, calls } = setup(res(401), res(401));
    // Act
    const result = client.download("f1");
    // Assert
    await expect(result).rejects.toMatchObject({ name: "DriveError", status: 401 });
    expect(calls).toHaveLength(2);
  });

  it("失敗の応答は、Drive の説明を含む DriveError にする（異常系: 404）", async () => {
    // Arrange
    const { client } = setup(res(404, { error: { message: "File not found: f9." } }));
    // Act
    const result = client.meta("f9");
    // Assert
    await expect(result).rejects.toThrow(new DriveError(404, "File not found: f9."));
  });

  it("応答の形が違えば、黙って続けず DriveError（異常系）", async () => {
    // Arrange
    const { client } = setup(res(200, { name: "m.sysml" }));
    // Act
    const result = client.meta("f1");
    // Assert
    await expect(result).rejects.toBeInstanceOf(DriveError);
  });

  it("Picker には今のトークンを渡す", async () => {
    // Arrange
    const { client } = setup();
    // Act
    const item = await client.pickFile();
    // Assert
    expect(item?.name).toBe("picked-with-t0");
  });
});
