// ═══ AST 反射生成器 ═══
// §3: 编译时脚本 — TypeScript Compiler API 解析核心模块 → JSON Schema 生成
//
// 运行方式: npx tsx src/mcp-adapter/tool-generator.ts
// 输出: generated/tool-definitions.json
//
// TODO: 当前为骨架实现。完整的 AST 反射需要处理复杂泛型、品牌类型退化等。
// 初期通过 tool-definitions.ts 手工维护，此脚本作为验证和辅助同步工具。

import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── §3.5 函数名 → Tool Name 转换 ───

export function camelToSnake(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

// ─── §3.4 TypeScript 类型 → JSON Schema ───

function typeToJsonSchema(
  type: ts.Type,
  checker: ts.TypeChecker,
  depth: number = 0,
): Record<string, unknown> {
  if (depth > 5) return { type: 'object' };

  // string
  if (type.flags & ts.TypeFlags.String) return { type: 'string' };
  if (type.flags & ts.TypeFlags.StringLiteral) return { type: 'string' };

  // number
  if (type.flags & ts.TypeFlags.Number) return { type: 'number' };
  if (type.flags & ts.TypeFlags.NumberLiteral) return { type: 'number' };

  // boolean
  if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) {
    return { type: 'boolean' };
  }

  // null
  if (type.flags & ts.TypeFlags.Null) return { type: 'null' };

  // void / undefined
  if (type.flags & ts.TypeFlags.Void || type.flags & ts.TypeFlags.Undefined) {
    return {};
  }

  // Union type
  if (type.isUnion()) {
    const members = type.types.filter(
      (t) => !(t.flags & ts.TypeFlags.Undefined),
    );
    // String literal union → enum
    if (members.every((t) => t.isStringLiteral())) {
      return {
        type: 'string',
        enum: members.map((t) => (t as ts.StringLiteralType).value),
      };
    }
    // Nullable
    const nonNull = members.filter((t) => !(t.flags & ts.TypeFlags.Null));
    if (nonNull.length === 1) {
      const inner = typeToJsonSchema(nonNull[0]!, checker, depth);
      return { ...inner, nullable: true };
    }
    return { oneOf: members.map((t) => typeToJsonSchema(t, checker, depth + 1)) };
  }

  // Array
  if (checker.isArrayType(type)) {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length > 0) {
      return { type: 'array', items: typeToJsonSchema(typeArgs[0]!, checker, depth + 1) };
    }
    return { type: 'array' };
  }

  // Promise<T> → unwrap
  const symbol = type.getSymbol();
  if (symbol?.name === 'Promise') {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length > 0) {
      return typeToJsonSchema(typeArgs[0]!, checker, depth);
    }
  }

  // Object / Interface
  if (type.flags & ts.TypeFlags.Object) {
    const props = type.getProperties();
    if (props.length === 0) return { type: 'object' };

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const prop of props) {
      const propType = checker.getTypeOfSymbolAtLocation(
        prop,
        prop.valueDeclaration ?? prop.declarations?.[0]!,
      );
      properties[prop.name] = typeToJsonSchema(propType, checker, depth + 1);

      if (!(prop.flags & ts.SymbolFlags.Optional)) {
        required.push(prop.name);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  return { type: 'object' };
}

// ─── §3.2-3.3 扫描模块导出函数 ───

interface ExtractedFunction {
  name: string;
  toolName: string;
  description: string;
  params: Array<{
    name: string;
    schema: Record<string, unknown>;
    required: boolean;
    description: string;
  }>;
  returnSchema: Record<string, unknown>;
}

function extractFunctions(
  filePath: string,
  program: ts.Program,
): ExtractedFunction[] {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) return [];

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return [];

  const exports = checker.getExportsOfModule(moduleSymbol);
  const results: ExtractedFunction[] = [];

  for (const exp of exports) {
    const declarations = exp.getDeclarations();
    if (!declarations || declarations.length === 0) continue;

    const decl = declarations[0]!;
    if (!ts.isFunctionDeclaration(decl) && !ts.isMethodDeclaration(decl)) continue;

    const type = checker.getTypeOfSymbolAtLocation(exp, decl);
    const callSigs = type.getCallSignatures();
    if (callSigs.length === 0) continue;

    const sig = callSigs[0]!;

    // JSDoc description
    const jsDocs = ts.getJSDocTags(decl);
    const descTag = jsDocs.find((t) => t.tagName.text === 'description');
    const description = descTag
      ? ts.getTextOfJSDocComment(descTag.comment) ?? ''
      : '';

    // Parameters
    const params = sig.parameters.map((param) => {
      const paramType = checker.getTypeOfSymbolAtLocation(
        param,
        param.valueDeclaration ?? param.declarations?.[0]!,
      );
      const paramDecl = param.valueDeclaration as ts.ParameterDeclaration | undefined;
      const isOptional = paramDecl ? !!paramDecl.questionToken || !!paramDecl.initializer : false;

      // JSDoc @param
      const paramTag = jsDocs.find(
        (t) => t.tagName.text === 'param' && ts.getTextOfJSDocComment(t.comment)?.startsWith(param.name),
      );
      const paramDesc = paramTag
        ? (ts.getTextOfJSDocComment(paramTag.comment) ?? '').replace(/^\S+\s*-?\s*/, '')
        : '';

      return {
        name: param.name,
        schema: typeToJsonSchema(paramType, checker),
        required: !isOptional,
        description: paramDesc,
      };
    });

    // Return type
    const returnType = sig.getReturnType();
    const returnSchema = typeToJsonSchema(returnType, checker);

    results.push({
      name: exp.name,
      toolName: camelToSnake(exp.name),
      description,
      params,
      returnSchema,
    });
  }

  return results;
}

// ─── 主函数 ───

function main(): void {
  const projectRoot = path.resolve(__dirname, '../..');
  const tsconfigPath = path.resolve(projectRoot, 'tsconfig.json');

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    projectRoot,
  );

  const entryFiles = [
    'src/core/search/index.ts',
    'src/core/acquire/index.ts',
    'src/core/process/index.ts',
    'src/core/database/index.ts',
    'src/core/rag/index.ts',
    'src/core/bibliography/index.ts',
  ].map((f) => path.resolve(projectRoot, f));

  const program = ts.createProgram(entryFiles, parsedConfig.options);

  const allFunctions: ExtractedFunction[] = [];
  for (const file of entryFiles) {
    allFunctions.push(...extractFunctions(file, program));
  }

  // 输出
  const outputDir = path.resolve(projectRoot, 'generated');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const toolDefs = allFunctions.map((fn) => ({
    name: fn.toolName,
    description: fn.description || `Auto-generated tool for ${fn.name}`,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        fn.params.map((p) => [p.name, { ...p.schema, ...(p.description ? { description: p.description } : {}) }]),
      ),
      required: fn.params.filter((p) => p.required).map((p) => p.name),
    },
  }));

  fs.writeFileSync(
    path.resolve(outputDir, 'tool-definitions.json'),
    JSON.stringify(toolDefs, null, 2),
  );

  console.log(`Generated ${toolDefs.length} tool definitions → generated/tool-definitions.json`);
}

// 直接执行时运行
main();
