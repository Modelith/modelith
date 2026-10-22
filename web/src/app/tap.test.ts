// タッチの判定（F-EDIT-10）。
import { describe, expect, it } from "vitest";
import { isDoubleTap, isTap, type TouchPoint } from "./tap";

const at = (x: number, y: number, time: number): TouchPoint => ({ x, y, time });

describe("isTap（指を置いて離すまでがタップか）", () => {
  it("ほとんど動かさず、すぐに離したらタップ（正常系）", () => {
    // Arrange
    const start = at(100, 100, 0);
    // Act
    const tap = isTap(start, at(103, 102, 90));
    // Assert
    expect(tap).toBe(true);
  });

  it("動きが 10px ちょうどならタップ、11px ならタップでない（境界値）", () => {
    // Arrange
    const start = at(0, 0, 0);
    // Act
    const results = [isTap(start, at(10, 0, 50)), isTap(start, at(11, 0, 50))];
    // Assert
    expect(results).toEqual([true, false]);
  });

  it("500 ミリ秒ちょうどならタップ、501 ミリ秒なら長押し（境界値）", () => {
    // Arrange
    const start = at(0, 0, 1000);
    // Act
    const results = [isTap(start, at(0, 0, 1500)), isTap(start, at(0, 0, 1501))];
    // Assert
    expect(results).toEqual([true, false]);
  });

  it("離した時刻が置いた時刻より前ならタップでない（異常系）", () => {
    // Arrange
    const start = at(0, 0, 1000);
    // Act
    const tap = isTap(start, at(0, 0, 999));
    // Assert
    expect(tap).toBe(false);
  });
});

describe("isDoubleTap（続く 2 回のタップがダブルタップか）", () => {
  it("すぐに、ほぼ同じ所をもう一度タップしたらダブルタップ（正常系）", () => {
    // Arrange
    const first = at(100, 100, 0);
    // Act
    const double = isDoubleTap(first, at(105, 98, 220));
    // Assert
    expect(double).toBe(true);
  });

  it("間が 400 ミリ秒ちょうどならダブルタップ、401 ミリ秒なら別々のタップ（境界値）", () => {
    // Arrange
    const first = at(0, 0, 0);
    // Act
    const results = [isDoubleTap(first, at(0, 0, 400)), isDoubleTap(first, at(0, 0, 401))];
    // Assert
    expect(results).toEqual([true, false]);
  });

  it("離れ方が 24px ちょうどならダブルタップ、25px なら別々のタップ（境界値）", () => {
    // Arrange
    const first = at(0, 0, 0);
    // Act
    const results = [isDoubleTap(first, at(0, 24, 100)), isDoubleTap(first, at(0, 25, 100))];
    // Assert
    expect(results).toEqual([true, false]);
  });

  it("2 回目の時刻が 1 回目より前ならダブルタップでない（異常系）", () => {
    // Arrange
    const first = at(0, 0, 500);
    // Act
    const double = isDoubleTap(first, at(0, 0, 300));
    // Assert
    expect(double).toBe(false);
  });
});
