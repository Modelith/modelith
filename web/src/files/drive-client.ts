// Drive API v3 を REST で呼ぶ DriveClient（ADR-0012）。
// HTTP・アクセストークン・Picker は外から渡す。ここではリクエストの組み立てと、トークン切れの取り直しだけを受け持つ。

import type { DriveClient, DriveItem, DriveMeta } from "./google-drive";

/** fetch のうち使う部分。 */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
export type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>;

/** アクセストークン（Google Identity Services のトークン方式）。トークンはメモリにだけ置く。 */
export interface TokenSource {
  /** 今のトークン。まだ無ければ利用者に許可を求めて取る。 */
  token(): Promise<string>;
  /** 期限切れなどで使えなかったトークンを捨てて、取り直す。 */
  renew(): Promise<string>;
}

/** Google Picker（ファイルとフォルダの選択画面）。 */
export interface DrivePicker {
  pickFile(token: string): Promise<DriveItem | null>;
  pickFolder(token: string): Promise<DriveItem | null>;
}

/** Drive API が失敗した。 */
export class DriveError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Google ドライブとの通信に失敗しました（${status}）${detail ? `：${detail}` : ""}`);
    this.name = "DriveError";
  }
}

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
/** 共有ドライブのファイルも扱えるようにする。 */
const ALL_DRIVES = "supportsAllDrives=true";
const MIME = "text/plain; charset=utf-8";
const BOUNDARY = "modelith-boundary";

export class RestDriveClient implements DriveClient {
  constructor(
    private readonly http: Http,
    private readonly tokens: TokenSource,
    private readonly picker: DrivePicker,
  ) {}

  async pickFile(): Promise<DriveItem | null> {
    return this.picker.pickFile(await this.tokens.token());
  }

  async pickFolder(): Promise<DriveItem | null> {
    return this.picker.pickFolder(await this.tokens.token());
  }

  async meta(id: string): Promise<DriveMeta> {
    const r = await this.call("GET", `${API}/${encodeURIComponent(id)}?fields=name,version&${ALL_DRIVES}`);
    return parseMeta(JSON.parse(await r.text()));
  }

  async download(id: string): Promise<string> {
    return (await this.call("GET", `${API}/${encodeURIComponent(id)}?alt=media&${ALL_DRIVES}`)).text();
  }

  async update(id: string, text: string): Promise<string> {
    const r = await this.call("PATCH", `${UPLOAD}/${encodeURIComponent(id)}?uploadType=media&fields=name,version&${ALL_DRIVES}`, { "Content-Type": MIME }, text);
    return parseMeta(JSON.parse(await r.text())).version;
  }

  async create(folderId: string, name: string, text: string): Promise<DriveItem & DriveMeta> {
    const metadata = JSON.stringify({ name, parents: [folderId], mimeType: "text/plain" });
    const body =
      `--${BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${BOUNDARY}\r\nContent-Type: ${MIME}\r\n\r\n${text}\r\n--${BOUNDARY}--`;
    const r = await this.call("POST", `${UPLOAD}?uploadType=multipart&fields=id,name,version&${ALL_DRIVES}`, { "Content-Type": `multipart/related; boundary=${BOUNDARY}` }, body);
    const json = JSON.parse(await r.text()) as { id?: unknown };
    if (typeof json.id !== "string") throw new DriveError(200, "作ったファイルの ID が返りませんでした");
    return { id: json.id, ...parseMeta(json) };
  }

  /** トークンを付けて呼ぶ。401（期限切れ）なら一度だけ取り直してやり直す。 */
  private async call(method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<HttpResponse> {
    const send = (token: string): Promise<HttpResponse> =>
      this.http(url, { method, headers: { ...headers, Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body }) });
    let r = await send(await this.tokens.token());
    if (r.status === 401) r = await send(await this.tokens.renew());
    if (!r.ok) throw new DriveError(r.status, errorMessage(await r.text()));
    return r;
  }
}

function parseMeta(value: unknown): DriveMeta {
  const json = (value ?? {}) as { name?: unknown; version?: unknown };
  if (typeof json.name !== "string" || typeof json.version !== "string") throw new DriveError(200, "ファイルの情報を読めませんでした");
  return { name: json.name, version: json.version };
}

/** Drive のエラー応答（{ error: { message } }）から説明を取り出す。 */
function errorMessage(text: string): string {
  try {
    const m = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
    return typeof m === "string" ? m : "";
  } catch {
    return "";
  }
}
