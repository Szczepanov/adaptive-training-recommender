// Behaviour-identical relocation exception for check-policy-drift.mjs (ADR-0052 Phase 1,
// ADR-0010 2026-10-25 amendment). Also home of the shared executable-syntax signature.
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import ts from 'typescript';

/**
 * Normalize TypeScript syntax while removing comments. The printer preserves identifiers,
 * literals, operators, types and statement structure, so a genuine source change cannot be
 * hidden as a comment-only edit; whitespace and comments are intentionally erased.
 */
export function executableSyntaxSignature(source, fileName, scriptKind = ts.ScriptKind.TS) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    throw new Error(`TypeScript parse diagnostics: ${diagnostics.map(d => d.code).join(', ')}`);
  }
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return printer.printFile(sourceFile);
}

const relocationAdrFile = 'docs/adr/0010-decision-provenance-and-audit-replay.md';
// Prefix for a resolved relative specifier, so it can never collide with a bare package name.
const repoPathMarker = '<repo>/';
// Spellings this check resolves a relative specifier through; anything else rejects.
const resolutionSuffixes = ['', '.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx'];
// Every spelling Vite's default resolver (or TypeScript) could pick for the same specifier.
// Used only to reject ambiguity around relocation endpoints, so a wider list only adds rejections.
const viteExtensions = ['.ts', '.tsx', '.d.ts', '.mts', '.mjs', '.js', '.jsx', '.json'];
const alternateSuffixes = ['', ...viteExtensions, ...viteExtensions.map((extension) => `/index${extension}`)];

function rejectRelocation(reason) {
  console.warn(`Behaviour-identical relocation exception rejected: ${reason}`);
  return false;
}

const isTestSource = (file) => /\.test\.(ts|tsx|mjs)$|\.spec\.(ts|tsx)$/.test(file);
const isTypeScriptSource = (file) => /\.tsx?$/.test(file);
const scriptKindFor = (file) => (file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const splitNul = (output) => output.split('\0').filter(Boolean);

/** Every file under app/ in the comparison-base tree, listed once. */
function baseAppTree(git, ref) {
  return new Set(splitNul(git(['ls-tree', '-r', '-z', '--name-only', ref, '--', 'app'])));
}

/** Every tracked or non-ignored untracked file under app/ present on disk (head is read from disk). */
function headAppTree(git, repoRoot) {
  const listed = splitNul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'app']));
  return new Set(listed.filter((file) => existsSync(join(repoRoot, file))));
}

function isRelativeSpecifier(specifier) {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * Resolve a relative specifier against the importer's directory in one tree, trying the
 * spellings the repo uses: exact, `.js` -> `.ts`/`.tsx`, extensionless, and directory index.
 * Returns null when nothing in that tree matches.
 */
function resolveRelativeSpecifier(importer, specifier, tree) {
  const target = posix.normalize(posix.join(posix.dirname(importer), specifier)).replace(/\/$/, '');
  const jsStem = /\.(m?js|jsx)$/.test(target) ? target.replace(/\.(m?js|jsx)$/, '') : null;
  const candidates = [
    target,
    ...(jsStem === null ? [] : [`${jsStem}.ts`, `${jsStem}.tsx`]),
    ...resolutionSuffixes.slice(1).map((suffix) => `${target}${suffix}`),
  ];
  const resolved = candidates.find((candidate) => tree.has(candidate));
  if (resolved === undefined) return null;
  return { path: resolved };
}

/**
 * Other paths an extensionless or directory specifier aimed at `path` could also resolve to.
 * If one exists next to a relocation endpoint, an unchanged importer could silently switch
 * between the two when the move happens.
 */
function alternateSpellings(path) {
  const stem = path.replace(/\.tsx?$/, '');
  const indexDir = /\/index\.tsx?$/.test(path) ? posix.dirname(path) : null;
  const spellings = (base) => alternateSuffixes.map((suffix) => `${base}${suffix}`);
  return [...spellings(stem), ...(indexDir === null ? [] : spellings(indexDir))]
    .filter((candidate) => candidate !== path);
}

/** The folder `<stem>/` when `tree` holds any file under it, or null. */
function folderAtStem(path, tree) {
  const folder = `${path.replace(/\.tsx?$/, '')}/`;
  return [...tree].some((candidate) => candidate.startsWith(folder)) ? folder : null;
}

function isModuleLoadCall(node) {
  return ts.isCallExpression(node)
    && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'));
}

/** The module-specifier string literal a node carries, or null. */
function moduleSpecifierLiteral(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier;
  if (ts.isExternalModuleReference(node) && ts.isStringLiteral(node.expression)) return node.expression;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteral(node.argument.literal)) return node.argument.literal;
  if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) return node.name;
  if (isModuleLoadCall(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
    return node.arguments[0];
  }
  return null;
}

/**
 * Constructs whose meaning depends on the file's own location but that are not import
 * specifiers: any `import.meta` use (`url`, `glob`, `resolve`, indirect access...),
 * `new URL(...)` and `require.resolve`. Only the direct, location-independent
 * `import.meta.env` access stays allowed.
 */
function fileRelativeConstruct(node) {
  if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
    const parent = node.parent;
    const isEnvAccess = parent && ts.isPropertyAccessExpression(parent)
      && parent.expression === node && parent.name.text === 'env';
    return isEnvAccess ? null : `import.meta${parent && ts.isPropertyAccessExpression(parent) ? `.${parent.name.text}` : ''}`;
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') return 'new URL(...)';
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'require' && node.name.text === 'resolve') return 'require.resolve';
  return null;
}

/** Collect specifier literals, non-literal import()/require() calls and file-relative constructs. */
function moduleSpecifierNodes(sourceFile) {
  const literals = [];
  const opaque = [];
  const fileRelative = [];
  const visit = (node) => {
    const literal = moduleSpecifierLiteral(node);
    const construct = fileRelativeConstruct(node);
    if (literal) literals.push(literal);
    else if (isModuleLoadCall(node)) opaque.push(node);
    if (construct) fileRelative.push(construct);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { literals, opaque, fileRelative };
}

/** Bare specifiers stay verbatim; relative ones become the (relocation-mapped) repo path. */
function canonicalSpecifier(file, specifier, tree, relocationMap) {
  if (!isRelativeSpecifier(specifier)) return specifier;
  // Asset queries expose raw content or URLs, which syntax equivalence cannot prove unchanged.
  if (specifier.includes('?')) throw new Error(`query-bearing relative specifier '${specifier}' in ${file}`);
  const resolved = resolveRelativeSpecifier(file, specifier, tree);
  if (resolved === null) throw new Error(`unresolvable relative specifier '${specifier}' in ${file}`);
  return `${repoPathMarker}${relocationMap.get(resolved.path) ?? resolved.path}`;
}

/**
 * executableSyntaxSignature after rewriting every module specifier to a canonical repo path,
 * resolved in the file's own tree. Two sources share a signature only when they are
 * comment/whitespace-identical and import exactly the same modules. Throws (fail closed) on
 * parse diagnostics, triple-slash directives, non-literal import()/require(), file-relative
 * URL constructs, or an unresolvable relative specifier.
 */
function relocationSignature(file, source, tree, relocationMap) {
  const scriptKind = scriptKindFor(file);
  // Git stores LF while Windows checkouts may use CRLF, which the printer retains in JSX text.
  source = source.replace(/\r\n/g, '\n');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const diagnostics = sourceFile.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    throw new Error(`TypeScript parse diagnostics in ${file}: ${diagnostics.map(d => d.code).join(', ')}`);
  }
  const directives = sourceFile.referencedFiles.length + sourceFile.typeReferenceDirectives.length
    + sourceFile.libReferenceDirectives.length;
  if (directives > 0) throw new Error(`triple-slash directives in ${file} are not normalised`);
  const { literals, opaque, fileRelative } = moduleSpecifierNodes(sourceFile);
  if (opaque.length > 0) throw new Error(`non-literal import()/require() in ${file}`);
  if (fileRelative.length > 0) throw new Error(`file-relative ${fileRelative[0]} in ${file} is not normalised`);
  // Replace from the end so earlier literal positions stay valid.
  const rewritten = [...literals]
    .sort((a, b) => b.getStart(sourceFile) - a.getStart(sourceFile))
    .reduce((text, literal) => {
      const canonical = JSON.stringify(canonicalSpecifier(file, literal.text, tree, relocationMap));
      return `${text.slice(0, literal.getStart(sourceFile))}${canonical}${text.slice(literal.end)}`;
    }, sourceFile.text);
  return executableSyntaxSignature(rewritten, file, scriptKind);
}

function isWellFormedRelocation(entry) {
  return entry !== null && typeof entry === 'object'
    && [entry.from, entry.to].every((path) =>
      typeof path === 'string' && path.startsWith('app/src/') && isTypeScriptSource(path));
}

/** First reason the active relocation set is not a clean set of moves, or null. */
function relocationShapeProblem(relocations, trees, lists) {
  const { baseTree, headTree } = trees;
  const froms = relocations.map(({ from }) => from);
  const tos = relocations.map(({ to }) => to);
  if (new Set(froms).size !== froms.length || new Set(tos).size !== tos.length) {
    return 'two relocation entries share a `from` or a `to`';
  }
  const problemFor = ({ from, to }) => {
    if (from === to) return `${from} is relocated onto itself`;
    if (headTree.has(from)) return `${from} still exists at head`;
    if (!headTree.has(to)) return `${to} does not exist at head`;
    if (baseTree.has(to)) return `${to} already exists at the comparison base`;
    const fromShadow = alternateSpellings(from).find((path) => headTree.has(path));
    if (fromShadow) return `an unchanged importer of ${from} could resolve to ${fromShadow} at head`;
    const toCapture = alternateSpellings(to).find((path) => baseTree.has(path));
    if (toCapture) return `${to} could capture an unchanged importer of ${toCapture} from the comparison base`;
    // A folder at either stem (for example one resolved through a package.json `main`) is
    // another target an extensionless specifier could reach.
    const fromFolder = folderAtStem(from, headTree);
    if (fromFolder) return `an unchanged importer of ${from} could resolve into ${fromFolder} at head`;
    const toFolder = folderAtStem(to, baseTree);
    if (toFolder) return `${to} could capture an unchanged importer of ${toFolder} from the comparison base`;
    if (lists.isListed(from, lists.base) && !lists.isListed(to, lists.head)) {
      return `${from} is decision-affecting but ${to} is not on the head decision list`;
    }
    return null;
  };
  return relocations.map(problemFor).find(Boolean) ?? null;
}

/**
 * First reason a changed file other than a relocation endpoint is not proved unchanged, or
 * null. Covers changed decision/production files and unchanged TypeScript consumers: each
 * must exist on both sides and keep its normalised signature. An unchanged importer can
 * observe a move through resolution or globs. /simulation/ is deliberately not excluded.
 */
function otherChangedSourceProblem(context, endpoints, trees, signatures) {
  const candidates = [...new Set([
    ...context.changedDecisionFiles,
    ...context.changedFiles.filter((file) => file.startsWith('app/src/') && !isTestSource(file)),
    ...[...trees.baseTree].filter((file) => file.startsWith('app/src/')
      && isTypeScriptSource(file) && !isTestSource(file) && trees.headTree.has(file)),
  ])].filter((file) => !endpoints.has(file));
  const problemFor = (file) => {
    if (!trees.baseTree.has(file) || !trees.headTree.has(file)) {
      return `${file} was added or deleted outside a relocation entry`;
    }
    if (!isTypeScriptSource(file)) return `${file} is not TypeScript, so it cannot be proved unchanged`;
    return signatures.base(file) === signatures.head(file)
      ? null
      : `${file} changed beyond import-specifier normalisation`;
  };
  return candidates.map(problemFor).find(Boolean) ?? null;
}

/** Prove the active relocations behaviour-identical; returns a rejection reason or null. */
function relocationProofProblem(context, relocations, trees) {
  const { git, repoRoot, comparisonBase } = context;
  const relocationMap = new Map(relocations.map(({ from, to }) => [from, to]));
  const signatures = {
    base: (file) => relocationSignature(file, git(['show', `${comparisonBase}:${file}`]), trees.baseTree, relocationMap),
    head: (file) => relocationSignature(file, readFileSync(join(repoRoot, file), 'utf8'), trees.headTree, new Map()),
  };
  const edited = relocations.find(({ from, to }) => signatures.base(from) !== signatures.head(to));
  if (edited) return `${edited.to} differs from ${edited.from} beyond import-specifier normalisation`;

  const endpoints = new Set(relocations.flatMap(({ from, to }) => [from, to]));
  const otherProblem = otherChangedSourceProblem(context, endpoints, trees, signatures);
  if (otherProblem) return otherProblem;

  const adr10 = readFileSync(join(repoRoot, relocationAdrFile), 'utf8');
  if (!/A behaviour-identical relocation does \*\*not\*\* bump `POLICY_VERSION`/.test(adr10)) {
    return `${relocationAdrFile} no longer states the no-bump rule`;
  }
  return null;
}

/**
 * ADR-0052 Phase 1 moves modules out of engine/ with `git mv`, changing nothing but where
 * they live and the specifiers that import them. ADR-0010's 2026-10-25 amendment keeps the
 * policy identity for such a move. This exception is mechanical and fail-closed: the moves
 * must be declared in the head list's `relocations` (entries whose `from` is absent at the
 * comparison base are stale, ignored, and may be pruned later); each moved file must keep its
 * executable syntax once every relative specifier is resolved in its own tree and mapped
 * through the relocations; neither endpoint may sit next to another spelling an unchanged
 * importer could resolve to; a listed file must stay listed at its new path; and every other
 * production TypeScript consumer must keep an unchanged normalised signature, including
 * unchanged files whose module resolution could observe the move. Changed production sources
 * must exist on both sides.
 * Any literal or logic edit, a repointed import, or an added/deleted production file rejects.
 *
 * `context`: { git, repoRoot, comparisonBase, changedFiles, changedDecisionFiles,
 * headDecisionConfig, headDecisionList, baseDecisionList (null when unreadable), isOnDecisionList }.
 * With no active relocation entry it returns false silently, so dormant-exception runs stay quiet.
 */
export function isBehaviorIdenticalRelocation(context) {
  if (context.changedDecisionFiles.length === 0) return false;
  const entries = context.headDecisionConfig.relocations ?? [];
  if (!Array.isArray(entries) || !entries.every(isWellFormedRelocation)) {
    return rejectRelocation('`relocations` must be an array of { from, to } app/src TypeScript paths');
  }
  if (entries.length === 0) return false;
  try {
    const trees = {
      baseTree: baseAppTree(context.git, context.comparisonBase),
      headTree: headAppTree(context.git, context.repoRoot),
    };
    const relocations = entries.filter(({ from }) => trees.baseTree.has(from));
    if (relocations.length === 0) return false;
    if (context.baseDecisionList === null) {
      return rejectRelocation('the comparison base has no readable decision list, so delisting cannot be ruled out');
    }
    const lists = {
      base: context.baseDecisionList,
      head: context.headDecisionList,
      isListed: context.isOnDecisionList,
    };
    const problem = relocationShapeProblem(relocations, trees, lists)
      ?? relocationProofProblem(context, relocations, trees);
    return problem === null ? true : rejectRelocation(problem);
  } catch (err) {
    return rejectRelocation(err.message);
  }
}
