// Canonical lexical tokens and helper names; string literals retain their exact spelling.
export function minifyRules(source) {
  if (typeof source !== 'string') throw new TypeError('Rules source must be a string.');
  const tokens = [];
  const word = /[A-Za-z_][A-Za-z_0-9]*/y;
  const number = /[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const pair = source.slice(index, index + 2);
    if (pair === '//') {
      while (index < source.length && !/[\r\n]/.test(source[index])) index += 1;
      continue;
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) throw new SyntaxError(`Unterminated block comment at ${index}.`);
      index = end + 2;
      continue;
    }
    if (pair === '*/') throw new SyntaxError(`Unexpected block comment terminator at ${index}.`);
    if (char === "'" || char === '"') {
      const start = index++;
      let closed = false;
      while (index < source.length) {
        const current = source[index++];
        if (/[\r\n\u0000-\u001f]/.test(current)) throw new SyntaxError(`Invalid string character at ${index - 1}.`);
        if (current === '\\') {
          if (index === source.length || /[\r\n\u0000-\u001f]/.test(source[index])) {
            throw new SyntaxError(`Invalid string escape at ${index - 1}.`);
          }
          index += 1;
        } else if (current === char) {
          closed = true;
          break;
        }
      }
      if (!closed) throw new SyntaxError(`Unterminated string at ${start}.`);
      tokens.push(source.slice(start, index));
      continue;
    }
    const pattern = /[A-Za-z_]/.test(char) ? word : /[0-9]/.test(char) ? number : undefined;
    if (pattern) {
      pattern.lastIndex = index;
      const [token] = pattern.exec(source);
      tokens.push(token);
      index += token.length;
    } else if (['&&', '||', '==', '!=', '<=', '>=', '**', '$('].includes(pair)) {
      tokens.push(pair);
      index += 2;
    } else if (/[{}()[\];:,.\/+*%\-=!<>&|?$]/.test(char)) {
      tokens.push(char);
      index += 1;
    } else {
      throw new SyntaxError(`Unexpected rules character at ${index}.`);
    }
  }
  const renamed = compactBindings(tokens);
  let previous = '';
  const compact = renamed.map((token) => {
    const boundary = previous.slice(-1) + token[0];
    const separate = (/^[A-Za-z_0-9'"]/.test(previous) && /^[A-Za-z_0-9'"]/.test(token))
      || (/^[0-9]/.test(previous) && token === '.')
      || (previous === '.' && /^[0-9]/.test(token))
      || ['&&', '||', '==', '!=', '<=', '>=', '**', '$(', '//', '/*', '*/'].includes(boundary);
    previous = token;
    return separate ? ` ${token}` : token;
  });
  // Rules paths and service names require compact punctuation; separate only merging tokens.
  return compact.join('');
}

// Only declared bindings change: fields, static paths, builtins and free variables stay intact.
function compactBindings(tokens) {
  const identifier = /^[A-Za-z_][A-Za-z_0-9]*$/;
  const keywords = new Set(['allow', 'false', 'function', 'if', 'in', 'is', 'let', 'match', 'null', 'return', 'rules_version', 'service', 'true']);
  const scope = (parent) => ({ parent, helpers: new Map(), variables: new Map() });
  const scopes = [];
  let current = scope();
  for (const token of tokens) {
    scopes.push(current);
    if (token === '{') current = scope(current);
    else if (token === '}') current = current.parent ?? current;
  }
  const closing = (start, open, close) => {
    let depth = 1;
    for (let i = start + 1; i < tokens.length; i += 1) {
      if (tokens[i] === open || (open === '(' && tokens[i] === '$(')) depth += 1;
      if (tokens[i] === close && --depth === 0) return i;
    }
    throw new SyntaxError(`Unclosed ${tokens[start]}.`);
  };
  const declarations = new Map();
  const helpers = [];
  const variableGroups = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== 'function' || !identifier.test(tokens[i + 1]) || tokens[i + 2] !== '(') continue;
    const parametersEnd = closing(i + 2, '(', ')');
    const bodyStart = parametersEnd + 1;
    if (tokens[bodyStart] !== '{') throw new SyntaxError('Expected function body.');
    const bodyEnd = closing(bodyStart, '{', '}');
    const helper = {};
    if (keywords.has(tokens[i + 1])) throw new SyntaxError(`Reserved function name: ${tokens[i + 1]}.`);
    if (scopes[i].helpers.has(tokens[i + 1])) throw new SyntaxError(`Duplicate function: ${tokens[i + 1]}.`);
    scopes[i].helpers.set(tokens[i + 1], helper);
    declarations.set(i + 1, helper);
    helpers.push(helper);
    const variables = [];
    const declare = (position) => {
      const binding = {};
      if (keywords.has(tokens[position])) throw new SyntaxError(`Reserved variable name: ${tokens[position]}.`);
      if (scopes[bodyStart + 1].variables.has(tokens[position])) throw new SyntaxError(`Duplicate variable: ${tokens[position]}.`);
      scopes[bodyStart + 1].variables.set(tokens[position], binding);
      declarations.set(position, binding);
      variables.push(binding);
    };
    for (let p = i + 3; p < parametersEnd; p += 1) {
      if (identifier.test(tokens[p])) declare(p);
    }
    for (let p = bodyStart + 1; p < bodyEnd; p += 1) {
      if (tokens[p] === 'let' && identifier.test(tokens[p + 1]) && tokens[p + 2] === '=') declare(p + 1);
    }
    variableGroups.push(variables);
  }
  const staticPath = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== '/' || !['match', '(', '=', ',', ':', '[', 'return', '?'].includes(tokens[i - 1])) continue;
    let p = i;
    while (tokens[p] === '/') {
      p += 1;
      if (identifier.test(tokens[p])) { staticPath.add(p); p += 1; }
      else if (tokens[p] === '$(') p = closing(p, '(', ')') + 1;
      else if (tokens[p] === '{') {
        const end = closing(p, '{', '}');
        for (; p <= end; p += 1) staticPath.add(p);
      } else break;
    }
    i = p - 1;
  }
  const bindings = tokens.map((token, position) => {
    if (declarations.has(position)) return declarations.get(position);
    if (!identifier.test(token) || ['.', 'is'].includes(tokens[position - 1]) || staticPath.has(position)) return undefined;
    const kind = tokens[position + 1] === '(' ? 'helpers' : 'variables';
    for (let owner = scopes[position]; owner; owner = owner.parent) {
      if (owner[kind].has(token)) return owner[kind].get(token);
    }
    return undefined;
  });
  const reserved = new Set(tokens.filter((token, position) => identifier.test(token) && !bindings[position]));
  const assign = (group, prefix) => {
    let index = 0;
    for (const binding of group) {
      do { binding.alias = `${prefix}${index++}`; } while (reserved.has(binding.alias));
    }
  };
  assign(helpers, '_f');
  for (const variables of variableGroups) assign(variables, '_v');
  return tokens.map((token, position) => bindings[position]?.alias ?? token);
}
