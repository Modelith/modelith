// 選択肢を示して利用者に選ばせるダイアログ。結果は Promise で返す（Esc・枠外は null）。

import { $, esc } from "./dom";

export interface Choice {
  id: string;
  label: string;
  kind?: "primary" | "danger";
}

/** 本文の下に出す、箇条書きと注意（プラグインの権限など）。 */
export interface AskDetail {
  items: string[];
  /** 目立たせて出す注意。無ければ省く。 */
  warning?: string;
}

/** 本文の下に出す、1 つを選ぶ選択肢（ラジオボタン）。 */
export interface AskPick {
  /** 選択肢のまとまりの名前（読み上げと見出しに使う）。 */
  label: string;
  options: AskOption[];
  /** 始めに選んでおく選択肢の id。 */
  value: string;
}

/** 選択肢 1 つ。 */
export interface AskOption {
  id: string;
  label: string;
  /** 選択肢の下に出す説明。 */
  note: string;
  disabled?: boolean;
  /** これを選んだときの primary のボタンの文言（無ければ変えない）。 */
  confirm?: string;
  /** これを選んだときだけ入力欄を出すなら true（選択肢と入力欄の両方があるとき）。 */
  input?: boolean;
}

export interface AskResult {
  id: string;
  /** 入力欄を出したときの値。 */
  value: string;
  /** 選択肢を出したときに選んでいた id（出していなければ ""）。 */
  option: string;
}

/**
 * ダイアログを出し、押されたボタンの id（と入力値）を返す。入力欄を出すときはそこに、無ければ
 * primary のボタン（無ければ最初のボタン）にフォーカスを置く。Esc・枠外のクリックでは null で閉じる。
 * 入力欄があるときの Enter は primary のボタンを押したことにする。
 *
 * @param title ダイアログの見出し
 * @param text 本文（HTML としてではなく文字として出す）
 * @param choices ボタンの一覧（id・表示名・見た目の種類 primary／danger）
 * @param input 入力欄を出すなら、その初期値と読み上げ用の名前。出さなければ省く
 * @param detail 本文の下に出す箇条書きと注意（文字として出す）。出さなければ省く
 * @param pick 本文の下に出す、1 つを選ぶ選択肢。選ぶと primary のボタンの文言と入力欄の表示が変わる。出さなければ省く
 * @returns 押されたボタンの id・入力欄の値（入力欄が無い・隠れていれば ""）・選んだ選択肢の id（無ければ ""）を返す Promise。Esc・枠外なら null
 * @example
 * // 入力欄に "a.sysml" と入れて「作成」（id "ok"）を押した
 * await ask("新しいファイル", "…", [{ id: "ok", label: "作成", kind: "primary" }], { value: "", label: "ファイル名" })
 * // → { id: "ok", value: "a.sysml", option: "" }
 * // 追加先に「このブラウザ」を選んで「追加する」を押した
 * await ask("プラグインを追加", "…", choices, undefined, undefined, { label: "追加先", value: "project", options })
 * // → { id: "ok", value: "", option: "browser" }
 * // Esc を押した
 * await ask("…", "…", choices) // → null
 */
export function ask(title: string, text: string, choices: Choice[], input?: { value: string; label: string }, detail?: AskDetail, pick?: AskPick): Promise<AskResult | null> {
  const box = $("#dialog");
  $("#dialogTitle").textContent = title;
  $("#dialogText").innerHTML =
    esc(text) + (input ? `<br><input id="dialogInput" aria-label="${esc(input.label)}" value="${esc(input.value)}" style="width:100%;margin-top:8px">` : "");
  const picker = $("#dialogPick");
  picker.hidden = !pick;
  picker.innerHTML = pick ? pickHtml(pick) : "";
  const more = $("#dialogDetail");
  more.hidden = !detail;
  more.innerHTML = detail ? `<ul>${detail.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>${detail.warning ? `<p class="warn" role="note">${esc(detail.warning)}</p>` : ""}` : "";
  $("#dialogButtons").innerHTML = choices.map((c) => `<button data-id="${esc(c.id)}" class="${c.kind ?? ""}">${esc(c.label)}</button>`).join("");
  box.hidden = false;
  const field = document.querySelector<HTMLInputElement>("#dialogInput");
  const picked = (): string => document.querySelector<HTMLInputElement>('#dialogPick input[name="dialogPick"]:checked')?.value ?? "";
  if (pick) {
    const apply = (): void => applyPick(pick, choices, picked(), field);
    picker.onchange = apply;
    apply();
  }
  const focusTarget = field ?? document.querySelector<HTMLButtonElement>("#dialogButtons .primary") ?? document.querySelector<HTMLButtonElement>("#dialogButtons button");
  focusTarget?.focus();
  field?.select();
  return new Promise((resolve) => {
    const done = (r: AskResult | null): void => {
      box.hidden = true;
      box.onclick = null;
      box.onkeydown = null;
      picker.onchange = null;
      resolve(r);
    };
    const value = (): string => (field && !field.hidden ? field.value : "");
    box.onclick = (ev) => {
      const t = ev.target;
      if (t === box) return done(null);
      const b = t instanceof Element ? t.closest<HTMLButtonElement>("button[data-id]") : null;
      if (b) done({ id: b.dataset["id"] ?? "", value: value(), option: picked() });
    };
    box.onkeydown = (ev) => {
      if (ev.key === "Escape") done(null);
      const primary = choices.find((c) => c.kind === "primary");
      if (ev.key === "Enter" && field && !field.hidden && primary) done({ id: primary.id, value: value(), option: picked() });
    };
  });
}

/**
 * 選択肢（ラジオボタン）の HTML を作る。選べない選択肢は押せないようにし、説明にその理由を出す。
 *
 * @param pick 選択肢
 * @returns HTML（文字は esc で逃がす）
 * @example
 * pickHtml({ label: "追加先", value: "project", options: [{ id: "project", label: "このプロジェクト", note: "…" }] })
 * // → '<fieldset><legend>追加先</legend><label class="dopt"><input type="radio" name="dialogPick" value="project" checked><span><b>このプロジェクト</b><small>…</small></span></label></fieldset>'
 */
function pickHtml(pick: AskPick): string {
  const options = pick.options.map(
    (o) =>
      `<label class="dopt${o.disabled ? " off" : ""}"><input type="radio" name="dialogPick" value="${esc(o.id)}"${o.id === pick.value ? " checked" : ""}${o.disabled ? " disabled" : ""}>` +
      `<span><b>${esc(o.label)}</b><small>${esc(o.note)}</small></span></label>`,
  );
  return `<fieldset><legend>${esc(pick.label)}</legend>${options.join("")}</fieldset>`;
}

/**
 * 選んだ選択肢に合わせて、primary のボタンの文言と、入力欄（と、その前の改行）の表示を変える。
 *
 * @param pick 選択肢
 * @param choices ボタンの一覧
 * @param selected 選んでいる選択肢の id
 * @param field 入力欄（無ければ null）
 */
function applyPick(pick: AskPick, choices: Choice[], selected: string, field: HTMLInputElement | null): void {
  const option = pick.options.find((o) => o.id === selected);
  const primary = choices.find((c) => c.kind === "primary");
  const button = primary ? document.querySelector<HTMLButtonElement>(`#dialogButtons [data-id="${CSS.escape(primary.id)}"]`) : null;
  if (button && primary) button.textContent = option?.confirm ?? primary.label;
  if (!field) return;
  const shown = option?.input ?? true;
  field.hidden = !shown;
  const br = field.previousElementSibling;
  if (br instanceof HTMLBRElement) br.hidden = !shown;
}
