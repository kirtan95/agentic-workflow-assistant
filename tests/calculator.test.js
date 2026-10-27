import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculate } from "../src/tools/calculator.js";

describe("calculator", () => {
  it("evaluates basic arithmetic", () => {
    assert.equal(calculate("2 + 3"), 5);
    assert.equal(calculate("10 - 4"), 6);
    assert.equal(calculate("6 * 7"), 42);
    assert.equal(calculate("20 / 4"), 5);
    assert.equal(calculate("10 % 3"), 1);
  });

  it("respects operator precedence", () => {
    assert.equal(calculate("2 + 3 * 4"), 14);
    assert.equal(calculate("(2 + 3) * 4"), 20);
    assert.equal(calculate("2 * 3 ^ 2"), 18); // ^ binds tighter than *
  });

  it("handles power and unary minus", () => {
    assert.equal(calculate("2 ^ 10"), 1024);
    assert.equal(calculate("-3 + 5"), 2);
    assert.equal(calculate("5 * -2"), -10);
    assert.equal(calculate("-(2 + 3)"), -5);
    // Python-style precedence: unary minus binds into the exponent's right
    // operand, but stays below ^ on the left.
    assert.equal(calculate("2 ^ -2"), 0.25);
    assert.equal(calculate("-2 ^ 2"), -4);
  });

  it("handles decimals", () => {
    assert.equal(calculate("0.1 + 0.2"), 0.30000000000000004);
    assert.equal(calculate("(15 * 1.2) ^ 2"), 324);
  });

  it("rejects division and modulo by zero", () => {
    assert.throws(() => calculate("1 / 0"), /Division by zero/);
    assert.throws(() => calculate("1 % 0"), /Modulo by zero/);
  });

  it("handles right-associative powers and chained unary minus", () => {
    assert.equal(calculate("2 ^ 2 ^ 3"), 256); // 2 ^ (2 ^ 3), not (2 ^ 2) ^ 3
    assert.equal(calculate("--5"), 5);
    assert.equal(calculate("- -5"), 5);
  });

  it("handles leading and trailing decimal points", () => {
    assert.equal(calculate(".5 + .5"), 1);
    assert.equal(calculate("5. + 1"), 6);
  });

  it("rejects non-finite results and empty parentheses", () => {
    assert.throws(() => calculate("10 ^ 400"), /not a finite number/);
    assert.throws(() => calculate("()"), /Malformed/);
    assert.throws(() => calculate("2 + ()"), /Malformed/);
  });

  it("rejects malformed expressions", () => {
    assert.throws(() => calculate(""), /non-empty/);
    assert.throws(() => calculate("2 +"), /Malformed|operands/);
    assert.throws(() => calculate("(2 + 3"), /parentheses/i);
    assert.throws(() => calculate("2 + 3)"), /parentheses/i);
    assert.throws(() => calculate("2 & 3"), /Unexpected character/);
    assert.throws(() => calculate("1.2.3 + 4"), /Invalid number/);
  });
});
