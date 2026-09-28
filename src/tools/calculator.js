/**
 * Safe arithmetic expression evaluator.
 *
 * Implements tokenisation + the shunting-yard algorithm + RPN evaluation, so
 * arbitrary user input can be evaluated WITHOUT eval()/Function(). Supports
 * + - * / % ^, parentheses, unary minus and decimal numbers.
 *
 * @param {string} expression - e.g. "(2 + 3) * 4 ^ 2"
 * @returns {number} the evaluated result
 * @throws {Error} on any malformed expression or illegal operation
 */

const OPERATORS = {
  "+": { precedence: 1, assoc: "left", arity: 2 },
  "-": { precedence: 1, assoc: "left", arity: 2 },
  "*": { precedence: 2, assoc: "left", arity: 2 },
  "/": { precedence: 2, assoc: "left", arity: 2 },
  "%": { precedence: 2, assoc: "left", arity: 2 },
  "^": { precedence: 4, assoc: "right", arity: 2 },
  "u-": { precedence: 3, assoc: "right", arity: 1 }, // unary minus
};

function tokenize(expression) {
  const tokens = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      let dots = 0;
      while (i < expression.length && /[0-9.]/.test(expression[i])) {
        if (expression[i] === ".") dots += 1;
        num += expression[i];
        i += 1;
      }
      if (dots > 1 || num === ".") {
        throw new Error(`Invalid number "${num}"`);
      }
      tokens.push({ type: "number", value: Number.parseFloat(num) });
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: ch });
      i += 1;
      continue;
    }
    if ("+-*/%^".includes(ch)) {
      // A "-" is unary when it starts the expression or follows an operator
      // or an opening parenthesis.
      const prev = tokens[tokens.length - 1];
      const isUnary =
        ch === "-" &&
        (!prev || prev.type === "op" || prev.type === "(");
      tokens.push({ type: "op", value: isUnary ? "u-" : ch });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character "${ch}"`);
  }
  return tokens;
}

function toRPN(tokens) {
  const output = [];
  const stack = [];
  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token);
    } else if (token.type === "op") {
      const o1 = OPERATORS[token.value];
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.type !== "op") break;
        // Python-style rule: a unary minus is absorbed into the right operand
        // of `^`, so `2 ^ -2` means 2^(-2), while `-2 ^ 2` means -(2^2).
        if (token.value === "u-" && top.value === "^") break;
        const o2 = OPERATORS[top.value];
        const shouldPop =
          (o1.assoc === "left" && o1.precedence <= o2.precedence) ||
          (o1.assoc === "right" && o1.precedence < o2.precedence);
        if (!shouldPop) break;
        output.push(stack.pop());
      }
      stack.push(token);
    } else if (token.type === "(") {
      stack.push(token);
    } else if (token.type === ")") {
      let found = false;
      while (stack.length > 0) {
        const top = stack.pop();
        if (top.type === "(") {
          found = true;
          break;
        }
        output.push(top);
      }
      if (!found) throw new Error("Mismatched parentheses");
    }
  }
  while (stack.length > 0) {
    const top = stack.pop();
    if (top.type === "(") throw new Error("Mismatched parentheses");
    output.push(top);
  }
  return output;
}

function applyOperator(op, a, b) {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      if (b === 0) throw new Error("Division by zero");
      return a / b;
    case "%":
      if (b === 0) throw new Error("Modulo by zero");
      return a % b;
    case "^":
      return Math.pow(a, b);
    case "u-":
      return -a;
    default:
      throw new Error(`Unknown operator "${op}"`);
  }
}

function evaluateRPN(rpn) {
  const stack = [];
  for (const token of rpn) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }
    const { arity } = OPERATORS[token.value];
    if (stack.length < arity) {
      throw new Error("Malformed expression: not enough operands");
    }
    if (arity === 1) {
      stack.push(applyOperator(token.value, stack.pop()));
    } else {
      const b = stack.pop();
      const a = stack.pop();
      stack.push(applyOperator(token.value, a, b));
    }
  }
  if (stack.length !== 1) {
    throw new Error("Malformed expression");
  }
  const result = stack[0];
  if (!Number.isFinite(result)) {
    throw new Error("Result is not a finite number");
  }
  return result;
}

/**
 * Evaluate an arithmetic expression safely.
 * @param {string} expression
 * @returns {number}
 */
export function calculate(expression) {
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new Error("Expression must be a non-empty string");
  }
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error("Empty expression");
  return evaluateRPN(toRPN(tokens));
}

/** Tool wrapper returning a human-readable string for the agent loop. */
export async function calculatorTool({ expression }) {
  const result = calculate(expression);
  return `${expression} = ${result}`;
}
