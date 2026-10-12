// 選択肢を示して利用者に選ばせるダイアログ。結果は Promise で返す（Esc・枠外は null）。

import { $, esc } from "./dom";

export interface Choice {
  id: string;
  label: string;
  kind?: "primary" | "danger";
}

export interface AskResult {
  id: string;
  /** 入力欄を出したときの値。 */
  value: string;
}

/** ダイアログを出し、押されたボタンの id（と入力値）を返す。 */
export function ask(title: string, text: string, choices: Choice[], input?: { value: string; label: string }): Promise<AskResult | null> {
  const box = $("#dialog");
  $("#dialogTitle").textContent = title;
  $("#dialogText").innerHTML =
    esc(text) + (input ? `<br><input id="dialogInput" aria-label="${esc(input.label)}" value="${esc(input.value)}" style="width:100%;margin-top:8px">` : "");
  $("#dialogButtons").innerHTML = choices.map((c) => `<button data-id="${esc(c.id)}" class="${c.kind ?? ""}">${esc(c.label)}</button>`).join("");
  box.hidden = false;
  const field = document.querySelector<HTMLInputElement>("#dialogInput");
  const focusTarget = field ?? document.querySelector<HTMLButtonElement>("#dialogButtons .primary") ?? document.querySelector<HTMLButtonElement>("#dialogButtons button");
  focusTarget?.focus();
  field?.select();
  return new Promise((resolve) => {
    const done = (r: AskResult | null): void => {
      box.hidden = true;
      box.onclick = null;
      box.onkeydown = null;
      resolve(r);
    };
    const value = (): string => field?.value ?? "";
    box.onclick = (ev) => {
      const t = ev.target;
      if (t === box) return done(null);
      const b = t instanceof Element ? t.closest<HTMLButtonElement>("button[data-id]") : null;
      if (b) done({ id: b.dataset["id"] ?? "", value: value() });
    };
    box.onkeydown = (ev) => {
      if (ev.key === "Escape") done(null);
      const primary = choices.find((c) => c.kind === "primary");
      if (ev.key === "Enter" && field && primary) done({ id: primary.id, value: value() });
    };
  });
}
