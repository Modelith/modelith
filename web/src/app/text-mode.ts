// 狭い画面のテキストの読み取り専用と「編集」ボタン（F-EDIT-10）。
// 狭い画面はモデルを見る・確かめる画面なので、テキストは初めは読み取り専用にし（触ってもキーボードが出ない）、
// 「編集」ボタンを押したときだけ編集できるようにする。広い画面では、これまでどおり常に編集できる。

import { $ } from "./dom";
import { isNarrow, NARROW_QUERY } from "./panels";

/** 狭い画面で、利用者が「編集」ボタンで編集できるようにしたか。 */
let editing = false;

/**
 * 画面の幅と「編集」ボタンの状態を、テキスト欄の読み取り専用とボタンの表示に反映する。
 */
function applyTextMode(): void {
  const ed = $<HTMLTextAreaElement>("#ed");
  ed.readOnly = isNarrow() && !editing;
  $("#btnEditText").setAttribute("aria-pressed", String(editing));
}

/**
 * 「編集」ボタンを押したときの切り替え。編集できるようにしたらテキスト欄にカーソルを置き（キーボードを出す）、
 * 読み取り専用に戻したらカーソルを外す（キーボードをしまう）。
 */
function toggleEditing(): void {
  editing = !editing;
  applyTextMode();
  const ed = $<HTMLTextAreaElement>("#ed");
  if (editing) ed.focus();
  else ed.blur();
}

/**
 * 狭い画面のテキストの読み取り専用と「編集」ボタンをつなぐ。起動時に 1 回呼ぶ。
 * 広い画面から狭い画面に変わったときは、読み取り専用に戻す。
 */
export function initTextMode(): void {
  $("#btnEditText").addEventListener("click", toggleEditing);
  window.matchMedia(NARROW_QUERY).addEventListener("change", () => {
    editing = false;
    applyTextMode();
  });
  applyTextMode();
}
