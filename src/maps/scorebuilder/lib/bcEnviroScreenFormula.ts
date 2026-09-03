export const BC_ENVIRO_SCREEN_DEFAULT_FORMULA = 'landscape_burden * population_characteristics'

export const BC_ENVIRO_SCREEN_FORMULA_VARIABLES = [
  'exposures',
  'environmental_effects',
  'sensitive_populations',
  'socioeconomic_factors',
  'landscape_burden',
  'population_characteristics',
] as const

export type BcEnviroScreenFormulaMode = 'reconstruction' | 'custom'

export interface BcEnviroScreenFormulaSettings {
  mode: BcEnviroScreenFormulaMode
  expression: string
}

export type BcEnviroScreenFormulaContext = Record<string, number | null | undefined>

type Token =
  | { type: 'number'; value: number; offset: number }
  | { type: 'identifier'; value: string; offset: number }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' | '^'; offset: number }
  | { type: 'leftParen' | 'rightParen' | 'comma' | 'eof'; offset: number }

type ExpressionNode =
  | { type: 'number'; value: number }
  | { type: 'variable'; name: string }
  | { type: 'unary'; operator: '+' | '-'; operand: ExpressionNode }
  | { type: 'binary'; operator: '+' | '-' | '*' | '/' | '^'; left: ExpressionNode; right: ExpressionNode }
  | { type: 'call'; name: string; args: ExpressionNode[] }

export interface CompiledBcEnviroScreenFormula {
  expression: string
  variables: string[]
  evaluate: (context: BcEnviroScreenFormulaContext) => number | null
}

const FUNCTIONS = new Set(['abs', 'clamp', 'max', 'mean', 'min'])
const MAX_EXPRESSION_LENGTH = 1000
const MAX_AST_DEPTH = 40

export class BcEnviroScreenFormulaError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} at character ${offset + 1}`)
    this.name = 'BcEnviroScreenFormulaError'
  }
}

function tokenize(expression: string): Token[] {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new BcEnviroScreenFormulaError(`Formula exceeds ${MAX_EXPRESSION_LENGTH} characters`, MAX_EXPRESSION_LENGTH)
  }
  const tokens: Token[] = []
  let offset = 0
  while (offset < expression.length) {
    const character = expression[offset]
    if (/\s/.test(character)) {
      offset += 1
      continue
    }
    if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(expression[offset + 1] ?? ''))) {
      const match = expression.slice(offset).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
      if (!match) throw new BcEnviroScreenFormulaError('Invalid number', offset)
      const value = Number(match[0])
      if (!Number.isFinite(value)) throw new BcEnviroScreenFormulaError('Number must be finite', offset)
      tokens.push({ type: 'number', value, offset })
      offset += match[0].length
      continue
    }
    if (/[A-Za-z_]/.test(character)) {
      const value = expression.slice(offset).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0]
      if (!value) throw new BcEnviroScreenFormulaError('Invalid identifier', offset)
      tokens.push({ type: 'identifier', value, offset })
      offset += value.length
      continue
    }
    if (character === '(') tokens.push({ type: 'leftParen', offset })
    else if (character === ')') tokens.push({ type: 'rightParen', offset })
    else if (character === ',') tokens.push({ type: 'comma', offset })
    else if ('+-*/^'.includes(character)) {
      tokens.push({ type: 'operator', value: character as '+' | '-' | '*' | '/' | '^', offset })
    } else throw new BcEnviroScreenFormulaError(`Unexpected character “${character}”`, offset)
    offset += 1
  }
  tokens.push({ type: 'eof', offset })
  return tokens
}

class Parser {
  private index = 0

  constructor(
    private readonly tokens: Token[],
    private readonly allowedVariables: Set<string>,
  ) {}

  parse(): ExpressionNode {
    const expression = this.parseAddition(0)
    const token = this.peek()
    if (token.type !== 'eof') throw new BcEnviroScreenFormulaError('Unexpected token', token.offset)
    return expression
  }

  private parseAddition(depth: number): ExpressionNode {
    let left = this.parseMultiplication(depth + 1)
    while (this.isOperator('+') || this.isOperator('-')) {
      const operator = (this.take() as Extract<Token, { type: 'operator' }>).value as '+' | '-'
      left = { type: 'binary', operator, left, right: this.parseMultiplication(depth + 1) }
    }
    return left
  }

  private parseMultiplication(depth: number): ExpressionNode {
    let left = this.parsePower(depth + 1)
    while (this.isOperator('*') || this.isOperator('/')) {
      const operator = (this.take() as Extract<Token, { type: 'operator' }>).value as '*' | '/'
      left = { type: 'binary', operator, left, right: this.parsePower(depth + 1) }
    }
    return left
  }

  private parsePower(depth: number): ExpressionNode {
    const left = this.parseUnary(depth + 1)
    if (!this.isOperator('^')) return left
    this.take()
    return { type: 'binary', operator: '^', left, right: this.parsePower(depth + 1) }
  }

  private parseUnary(depth: number): ExpressionNode {
    this.assertDepth(depth)
    if (this.isOperator('+') || this.isOperator('-')) {
      const operator = (this.take() as Extract<Token, { type: 'operator' }>).value as '+' | '-'
      return { type: 'unary', operator, operand: this.parseUnary(depth + 1) }
    }
    return this.parsePrimary(depth + 1)
  }

  private parsePrimary(depth: number): ExpressionNode {
    this.assertDepth(depth)
    const token = this.take()
    if (token.type === 'number') return { type: 'number', value: token.value }
    if (token.type === 'leftParen') {
      const expression = this.parseAddition(depth + 1)
      const closing = this.take()
      if (closing.type !== 'rightParen') throw new BcEnviroScreenFormulaError('Expected “)”', closing.offset)
      return expression
    }
    if (token.type === 'identifier') {
      if (this.peek().type !== 'leftParen') {
        if (!this.allowedVariables.has(token.value)) {
          throw new BcEnviroScreenFormulaError(`Unknown variable “${token.value}”`, token.offset)
        }
        return { type: 'variable', name: token.value }
      }
      if (!FUNCTIONS.has(token.value)) {
        throw new BcEnviroScreenFormulaError(`Unknown function “${token.value}”`, token.offset)
      }
      this.take()
      const args: ExpressionNode[] = []
      if (this.peek().type !== 'rightParen') {
        args.push(this.parseAddition(depth + 1))
        while (this.peek().type === 'comma') {
          this.take()
          args.push(this.parseAddition(depth + 1))
        }
      }
      const closing = this.take()
      if (closing.type !== 'rightParen') throw new BcEnviroScreenFormulaError('Expected “)”', closing.offset)
      validateFunctionArity(token.value, args.length, token.offset)
      return { type: 'call', name: token.value, args }
    }
    throw new BcEnviroScreenFormulaError('Expected a number, variable, or “(”', token.offset)
  }

  private peek(): Token {
    return this.tokens[this.index]
  }

  private take(): Token {
    const token = this.tokens[this.index]
    this.index += 1
    return token
  }

  private isOperator(value: string): boolean {
    const token = this.peek()
    return token.type === 'operator' && token.value === value
  }

  private assertDepth(depth: number) {
    if (depth > MAX_AST_DEPTH) throw new BcEnviroScreenFormulaError('Formula nesting is too deep', this.peek().offset)
  }
}

function validateFunctionArity(name: string, count: number, offset: number) {
  if (name === 'abs' && count !== 1) throw new BcEnviroScreenFormulaError('abs() expects one value', offset)
  if (name === 'clamp' && count !== 3) throw new BcEnviroScreenFormulaError('clamp() expects value, min, max', offset)
  if ((name === 'mean' || name === 'min' || name === 'max') && count < 1) {
    throw new BcEnviroScreenFormulaError(`${name}() expects at least one value`, offset)
  }
}

function evaluateNode(node: ExpressionNode, context: BcEnviroScreenFormulaContext): number | null {
  if (node.type === 'number') return node.value
  if (node.type === 'variable') {
    const value = context[node.name]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  if (node.type === 'unary') {
    const value = evaluateNode(node.operand, context)
    return value == null ? null : node.operator === '-' ? -value : value
  }
  if (node.type === 'binary') {
    const left = evaluateNode(node.left, context)
    const right = evaluateNode(node.right, context)
    if (left == null || right == null) return null
    let result: number
    if (node.operator === '+') result = left + right
    else if (node.operator === '-') result = left - right
    else if (node.operator === '*') result = left * right
    else if (node.operator === '/') result = right === 0 ? Number.NaN : left / right
    else result = left ** right
    return Number.isFinite(result) ? result : null
  }
  const values = node.args.map((arg) => evaluateNode(arg, context))
  if (node.name === 'abs') return values[0] == null ? null : Math.abs(values[0])
  if (node.name === 'clamp') {
    if (values.some((value) => value == null)) return null
    const [value, minimum, maximum] = values as number[]
    return Math.max(Math.min(minimum, maximum), Math.min(Math.max(minimum, maximum), value))
  }
  const present = values.filter((value): value is number => value != null)
  if (!present.length) return null
  if (node.name === 'mean') return present.reduce((sum, value) => sum + value, 0) / present.length
  if (node.name === 'min') return Math.min(...present)
  return Math.max(...present)
}

function collectVariables(node: ExpressionNode, variables = new Set<string>()): Set<string> {
  if (node.type === 'variable') variables.add(node.name)
  else if (node.type === 'unary') collectVariables(node.operand, variables)
  else if (node.type === 'binary') {
    collectVariables(node.left, variables)
    collectVariables(node.right, variables)
  } else if (node.type === 'call') node.args.forEach((arg) => collectVariables(arg, variables))
  return variables
}

export function compileBcEnviroScreenFormula(
  expression: string,
  indicatorKeys: readonly string[],
): CompiledBcEnviroScreenFormula {
  const trimmed = expression.trim()
  if (!trimmed) throw new BcEnviroScreenFormulaError('Formula cannot be empty', 0)
  const allowedVariables = new Set([...BC_ENVIRO_SCREEN_FORMULA_VARIABLES, ...indicatorKeys])
  const ast = new Parser(tokenize(trimmed), allowedVariables).parse()
  return {
    expression: trimmed,
    variables: [...collectVariables(ast)].sort(),
    evaluate: (context) => evaluateNode(ast, context),
  }
}

export function validateBcEnviroScreenFormula(expression: string, indicatorKeys: readonly string[]): string | null {
  try {
    compileBcEnviroScreenFormula(expression, indicatorKeys)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid BC EnviroScreen formula.'
  }
}
