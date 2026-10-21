// 前回の続き（F-FILE-13）：開いていたフォルダとファイル、表示していたファイルを覚え、起動したときに何を戻すかを決める。
// 判断はすべてここの純粋な関数にし、保存先（localStorage）とブラウザの許可の確かめ方は呼ぶ側が渡す。

import type { DirEntry, FileRef, RecentAccess } from "../files/types";
import type { KeyValue } from "./drafts";
import type { StartWith } from "./workspace";

/** 開いていた文書。path は開いていたフォルダの中のファイル（フォルダからの相対パス）、draft は下書きの何番目か（0 から）。 */
export type SessionDoc = { path: string } | { draft: number };

/** 前回の続き（終えたときの状態）。 */
export interface Session {
  /** フォルダを開いていたか（フォルダそのものは、前回のフォルダとして IndexedDB に覚えている）。 */
  folder: boolean;
  /** 開いていた文書（開いていた順）。戻せないもの（1 つだけ選んだファイル・中身の無い無題）は入れない。 */
  docs: SessionDoc[];
  /** 表示していた文書の、docs の中の位置。無ければ null。 */
  active: number | null;
}

/** 前回の続きの保存先（ブラウザでは localStorage）。 */
export interface SessionStore {
  load(): Session | null;
  save(session: Session): void;
}

/**
 * 起動したときの始め方。default は前回の続きが無い（初めて開いた・以前の版）ので今までどおり、sample は設定でサンプルを開く、
 * resume はフォルダを開き直して続きを戻す、ask は許可を求める「前回の続きを開く」を示す、docs はフォルダを開かずに戻せるもの（下書き）だけを戻す。
 */
export type StartPlan = "default" | "sample" | "resume" | "ask" | "docs";

/**
 * 起動したときの始め方を決める（F-FILE-13）。
 *
 * @param session 前回の続き（無ければ null）
 * @param sampleAtStart 設定「起動時にサンプルを開く」が有効か
 * @param access 前回のフォルダを開く許可の状態（フォルダを開けないブラウザでは "none"）
 * @returns 始め方
 * @example
 * planStart(null, false, "none")                                   // → "default"（初めて開いた）
 * planStart({ folder: true, docs: [], active: null }, false, "granted") // → "resume"
 * planStart({ folder: true, docs: [], active: null }, false, "prompt")  // → "ask"
 * planStart({ folder: true, docs: [], active: null }, false, "denied")  // → "docs"
 * planStart({ folder: true, docs: [], active: null }, true, "granted")  // → "sample"（設定が優先）
 */
export function planStart(session: Session | null, sampleAtStart: boolean, access: RecentAccess): StartPlan {
  if (sampleAtStart) return "sample";
  if (!session) return "default";
  if (!session.folder) return "docs";
  if (access === "granted") return "resume";
  if (access === "prompt") return "ask";
  return "docs";
}

/**
 * 下書きに残す中身があるか（空白だけのテキストは中身が無いとみなす。F-FILE-11）。
 *
 * @param d 文書か下書き
 * @returns テキストに空白以外の文字があれば true
 * @example
 * hasContent({ text: "package P;" }) // → true
 * hasContent({ text: " \n" })        // → false（空白だけ）
 * hasContent({ text: "" })           // → false
 */
export const hasContent = (d: { text: string }): boolean => d.text.trim() !== "";

/**
 * フォルダの中身から、パスの合うファイルを入れ子まで探す。
 *
 * @param entries フォルダの中身
 * @param path フォルダからの相対パス
 * @returns 見つかったファイルの参照。無ければ null
 * @example
 * findFile(entries, "models/b.sysml") // → { …, path: "models/b.sysml" }
 * findFile(entries, "gone.sysml")     // → null（消された）
 */
export function findFile(entries: readonly DirEntry[], path: string): FileRef | null {
  for (const e of entries) {
    if (e.kind === "file" && e.ref.path === path) return e.ref;
    if (e.kind === "dir") {
      const hit = findFile(e.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 今開いている文書から、前回の続きとして覚えるものを作る。
 * 無題の文書は中身のあるものだけを下書きの順番で、ファイルは開いているフォルダの中のものだけをパスで覚える。
 *
 * @param docs 開いている文書（開いた順）
 * @param activeKey 表示している文書のキー（無ければ null）
 * @param entries 開いているフォルダの中身（フォルダを開いていなければ null）
 * @returns 前回の続き。表示している文書を覚えられなければ active は null
 * @example
 * // 無題（中身あり）・フォルダの a.sysml・1 つだけ選んだ one.sysml を開き、a.sysml を表示
 * sessionFrom(docs, a.key, entries) // → { folder: true, docs: [{ draft: 0 }, { path: "a.sysml" }], active: 1 }
 * sessionFrom([], null, null)       // → { folder: false, docs: [], active: null }
 */
export function sessionFrom(docs: readonly { key: string; ref: FileRef | null; text: string }[], activeKey: string | null, entries: readonly DirEntry[] | null): Session {
  const out: SessionDoc[] = [];
  let active: number | null = null;
  let drafts = 0;
  for (const d of docs) {
    let item: SessionDoc | null = null;
    if (!d.ref) {
      if (hasContent(d)) item = { draft: drafts++ };
    } else if (entries) {
      const f = findFile(entries, d.ref.path);
      if (f && f.provider === d.ref.provider && f.id === d.ref.id) item = { path: d.ref.path };
    }
    if (!item) continue;
    if (d.key === activeKey) active = out.length;
    out.push(item);
  }
  return { folder: entries !== null, docs: out, active };
}

/**
 * 前回の続きから、戻す文書の順番と表示する文書を決める。
 * 無い下書き・重なり・開けなかったフォルダのファイルは除き、前回の続きに無い下書きは最後に足す（下書きは失わない）。
 *
 * @param session 前回の続き
 * @param draftCount 戻した下書きの数
 * @param folderOpen フォルダを開き直せたか
 * @returns 戻す文書の順番と、表示する文書の items の中の位置（戻せなければ null）
 * @example
 * restoreOrder({ folder: true, docs: [{ path: "a.sysml" }, { draft: 0 }], active: 0 }, 1, true)
 * // → { items: [{ path: "a.sysml" }, { draft: 0 }], active: 0 }
 * restoreOrder({ folder: true, docs: [{ path: "a.sysml" }, { draft: 0 }], active: 0 }, 1, false)
 * // → { items: [{ draft: 0 }], active: null }（フォルダを開けなかった）
 * restoreOrder({ folder: false, docs: [], active: null }, 2, false)
 * // → { items: [{ draft: 0 }, { draft: 1 }], active: null }（前回の続きに無い下書き）
 */
export function restoreOrder(session: Session, draftCount: number, folderOpen: boolean): { items: SessionDoc[]; active: number | null } {
  const items: SessionDoc[] = [];
  const drafts = new Set<number>();
  const paths = new Set<string>();
  let active: number | null = null;
  session.docs.forEach((d, i) => {
    if ("draft" in d) {
      if (d.draft >= draftCount || drafts.has(d.draft)) return;
      drafts.add(d.draft);
    } else {
      if (!folderOpen || paths.has(d.path)) return;
      paths.add(d.path);
    }
    if (i === session.active) active = items.length;
    items.push(d);
  });
  for (let i = 0; i < draftCount; i++) if (!drafts.has(i)) items.push({ draft: i });
  return { items, active };
}

/**
 * 前回の続きを戻した後に、何を表示するかを決める。文書を戻せなければ、フォルダを開いているか、すべて閉じて終えたなら何も開かず（F-FILE-14）、
 * そうでなければサンプルを開く（今までの起動と同じ）。
 *
 * @param openDocs 戻した文書の数
 * @param folderOpen フォルダを開き直せたか
 * @param drafts 下書きを戻した結果（restoreDrafts の戻り値）
 * @returns "show"（戻した文書を表示する）・"nothing"（何も開かない）・"sample"（サンプルを開く）
 * @example
 * afterRestore(2, true, "drafts")   // → "show"
 * afterRestore(0, true, "sample")   // → "nothing"（フォルダの中のファイルはすべて閉じていた・消された）
 * afterRestore(0, false, "nothing") // → "nothing"（すべて閉じて終えた）
 * afterRestore(0, false, "sample")  // → "sample"
 */
export function afterRestore(openDocs: number, folderOpen: boolean, drafts: StartWith): "show" | "nothing" | "sample" {
  if (openDocs > 0) return "show";
  if (folderOpen || drafts === "nothing") return "nothing";
  return "sample";
}

/**
 * 開いている無題の文書から、手を付けていないサンプル（名前とテキストが同じもの）を探す。起動のたびにサンプルを増やさないため。
 *
 * @param docs 開いている文書
 * @param sample サンプルの名前とテキスト
 * @returns 見つかった文書のキー。無ければ null
 * @example
 * sampleDraft(docs, { name: "electric-kettle.sysml", text: SAMPLE }) // → "doc:1"（そのまま残っている）
 * sampleDraft(docs, { name: "electric-kettle.sysml", text: SAMPLE }) // → null（編集した・閉じた）
 */
export function sampleDraft(docs: readonly { key: string; ref: FileRef | null; name: string; text: string }[], sample: { name: string; text: string }): string | null {
  return docs.find((d) => !d.ref && d.name === sample.name && d.text === sample.text)?.key ?? null;
}

const KEY = "modelith-session-v1";

/**
 * 保存先から読んだ値が、開いていた文書の形か。
 *
 * @param v JSON から読んだ値
 * @returns { path: 文字列 } か { draft: 0 以上の整数 } なら true
 * @example
 * isSessionDoc({ path: "a.sysml" }) // → true
 * isSessionDoc({ draft: 0 })        // → true
 * isSessionDoc({ draft: -1 })       // → false
 */
const isSessionDoc = (v: unknown): v is SessionDoc =>
  !!v && typeof v === "object" && (typeof (v as { path?: unknown }).path === "string" || (Number.isInteger((v as { draft?: unknown }).draft) && (v as { draft: number }).draft >= 0));

/**
 * 保存した前回の続き（JSON）を読む。形の合わない文書は除き、表示していた文書の位置が範囲の外なら null にする。
 *
 * @param json 保存した JSON（無ければ null）
 * @returns 前回の続き。無い・JSON が壊れている・形が合わないときは null
 * @example
 * parseSession('{"folder":true,"docs":[{"path":"a.sysml"}],"active":0}') // → { folder: true, docs: [{ path: "a.sysml" }], active: 0 }
 * parseSession('{"folder":false,"docs":[],"active":3}')                  // → { folder: false, docs: [], active: null }
 * parseSession("{not json")                                              // → null
 * parseSession(null)                                                     // → null（初めて開いた）
 */
export function parseSession(json: string | null): Session | null {
  if (json === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as { folder?: unknown; docs?: unknown; active?: unknown };
  if (typeof o.folder !== "boolean" || !Array.isArray(o.docs)) return null;
  const all: unknown[] = o.docs;
  const docs = all.filter(isSessionDoc).map((d) => ("path" in d ? { path: d.path } : { draft: d.draft }));
  const at = o.active;
  const active = typeof at === "number" && Number.isInteger(at) && at >= 0 && at < all.length && isSessionDoc(all[at]) ? all.slice(0, at).filter(isSessionDoc).length : null;
  return { folder: o.folder, docs, active };
}

/**
 * キーと値の保存先（ブラウザでは localStorage）に前回の続きを置く SessionStore を作る（キーは modelith-session-v1）。
 *
 * @param kv キーと値の保存先
 * @returns 前回の続きの読み書き
 * @example
 * kvSessionStore(kv).load() // → null（まだ何も置いていない）
 * kvSessionStore(kv).save({ folder: false, docs: [{ draft: 0 }], active: 0 }) // → 次の load() で同じものを返す
 */
export function kvSessionStore(kv: KeyValue): SessionStore {
  return {
    /**
     * 置いてある前回の続きを読む。
     *
     * @returns 前回の続き。無い・壊れているときは null
     * @example
     * load() // → { folder: true, docs: [{ path: "a.sysml" }], active: 0 }
     * load() // → null（初めて開いた）
     */
    load() {
      return parseSession(kv.get(KEY));
    },
    /**
     * 前回の続きを置き換える。
     *
     * @param session 置く前回の続き
     */
    save(session) {
      kv.set(KEY, JSON.stringify(session));
    },
  };
}
