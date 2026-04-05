// ═══ AST 反射生成器 ═══
// §3: 编译时脚本 — TypeScript Compiler API 解析核心 Service 类 → JSON Schema 生成
//
// 运行方式:
//   npx tsx src/mcp-adapter/tool-generator.ts            # 生成 + 校验
//   npx tsx src/mcp-adapter/tool-generator.ts --validate  # 仅校验（不写文件）
//
// 输出: generated/tool-definitions.json
//
// 工作原理:
//   1. 解析 6 个核心模块 index.ts 中导出的 Service 类
//   2. 提取公有实例方法 → camelCase→snake_case 映射
//   3. TypeScript 类型 → JSON Schema 转换（含品牌类型降级、Map/Buffer/TypedArray 处理）
//   4. 与 tool-definitions.ts 手工维护的定义做 diff 校验
//
// 注意: tool-definitions.ts 仍是运行时唯一真源。
// 本脚本用于检测接口漂移和辅助同步，不直接替代手工定义。
// 手工定义包含此脚本无法自动推断的运行时元数据:
//   - isWriteOperation: 需要语义判断
//   - injectedParams: 需要了解 ServiceContext 注入策略
//   - 参数面适配: 手工定义可能展平 options 对象为顶层字段
//   - description: 手工定义提供面向用户的描述而非 JSDoc

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

// ─── 已知品牌类型名 → JSON Schema 降级 ───

const BRANDED_TYPE_MAP: Record<string, Record<string, unknown>> = {
  PaperId: { type: 'string', description: 'Branded PaperId string' },
  ConceptId: { type: 'string', description: 'Branded ConceptId string' },
  ChunkId: { type: 'string', description: 'Branded ChunkId string' },
  ArticleId: { type: 'string', description: 'Branded ArticleId string' },
  OutlineEntryId: { type: 'string', description: 'Branded OutlineEntryId string' },
  DraftId: { type: 'string', description: 'Branded DraftId string' },
  MemoId: { type: 'string', description: 'Branded MemoId string' },
  NoteId: { type: 'string', description: 'Branded NoteId string' },
  AnnotationId: { type: 'string', description: 'Branded AnnotationId string' },
  SuggestionId: { type: 'string', description: 'Branded SuggestionId string' },
};

// ─── §3.4 TypeScript 类型 → JSON Schema ───

function typeToJsonSchema(
  type: ts.Type,
  checker: ts.TypeChecker,
  depth: number = 0,
): Record<string, unknown> {
  if (depth > 6) return { type: 'object' };

  // 品牌类型降级: 检查类型别名名称
  const aliasSymbol = type.aliasSymbol;
  if (aliasSymbol && BRANDED_TYPE_MAP[aliasSymbol.name]) {
    return BRANDED_TYPE_MAP[aliasSymbol.name]!;
  }

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

  // Intersection type → 合并为单个 object schema
  if (type.isIntersection()) {
    const merged: Record<string, unknown> = {};
    const required: string[] = [];
    for (const member of type.types) {
      const sub = typeToJsonSchema(member, checker, depth + 1);
      if (sub.properties && typeof sub.properties === 'object') {
        Object.assign(merged, sub.properties);
      }
      if (Array.isArray(sub.required)) {
        required.push(...sub.required);
      }
    }
    if (Object.keys(merged).length > 0) {
      return { type: 'object', properties: merged, ...(required.length > 0 ? { required: [...new Set(required)] } : {}) };
    }
    return { type: 'object' };
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
    // Number literal union → enum
    if (members.every((t) => t.isNumberLiteral())) {
      return {
        type: 'number',
        enum: members.map((t) => (t as ts.NumberLiteralType).value),
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

  // 已知特殊类型降级
  const symbol = type.getSymbol();
  const typeName = symbol?.name;

  // Promise<T> → unwrap
  if (typeName === 'Promise') {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length > 0) {
      return typeToJsonSchema(typeArgs[0]!, checker, depth);
    }
  }

  // Map<K, V> → object
  if (typeName === 'Map') {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    if (typeArgs && typeArgs.length >= 2) {
      return {
        type: 'object',
        additionalProperties: typeToJsonSchema(typeArgs[1]!, checker, depth + 1),
        description: `Map<${checker.typeToString(typeArgs[0]!)}, ${checker.typeToString(typeArgs[1]!)}>`,
      };
    }
    return { type: 'object' };
  }

  // Buffer → binary placeholder
  if (typeName === 'Buffer') {
    return { type: 'string', format: 'binary', description: 'Binary buffer (base64 or file path)' };
  }

  // Float32Array / Float64Array → number[]
  if (typeName === 'Float32Array' || typeName === 'Float64Array') {
    return { type: 'array', items: { type: 'number' }, description: typeName };
  }

  // PaginatedResult<T> → unwrap
  if (typeName === 'PaginatedResult') {
    const typeArgs = (type as ts.TypeReference).typeArguments;
    return {
      type: 'object',
      properties: {
        items: typeArgs && typeArgs.length > 0
          ? { type: 'array', items: typeToJsonSchema(typeArgs[0]!, checker, depth + 1) }
          : { type: 'array' },
        total: { type: 'number' },
        hasMore: { type: 'boolean' },
      },
    };
  }

  // Object / Interface
  if (type.flags & ts.TypeFlags.Object) {
    const props = type.getProperties();
    if (props.length === 0) return { type: 'object' };

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const prop of props) {
      // 跳过私有成员和方法
      if (prop.flags & ts.SymbolFlags.Method) continue;
      if (prop.valueDeclaration) {
        const modifiers = ts.getCombinedModifierFlags(prop.valueDeclaration as ts.Declaration);
        if (modifiers & ts.ModifierFlags.Private || modifiers & ts.ModifierFlags.Protected) continue;
      }

      const propType = checker.getTypeOfSymbolAtLocation(
        prop,
        prop.valueDeclaration ?? prop.declarations?.[0]!,
      );
      properties[prop.name] = typeToJsonSchema(propType, checker, depth + 1);

      if (!(prop.flags & ts.SymbolFlags.Optional)) {
        required.push(prop.name);
      }
    }

    if (Object.keys(properties).length === 0) return { type: 'object' };

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  return { type: 'object' };
}

// ─── §3.2-3.3 扫描 Service 类实例方法 ───

interface ExtractedMethod {
  className: string;
  methodName: string;
  toolName: string;
  description: string;
  params: Array<{
    name: string;
    schema: Record<string, unknown>;
    required: boolean;
    description: string;
  }>;
  paramOrder: string[];
  returnSchema: Record<string, unknown>;
}

// 模块 → Service 类名映射
const MODULE_SERVICE_MAP: Record<string, string> = {
  'search': 'SearchService',
  'acquire': 'AcquireService',
  'process': 'ProcessService',
  'database': 'DatabaseService',
  'rag': 'RagService',
  'bibliography': 'BibliographyService',
};

// 需要排除的内部方法/属性（不暴露为 MCP tool）
const EXCLUDED_METHODS = new Set([
  // DatabaseService 内部方法
  'setPauseWorkerWrites', 'setWorkerRef', 'close', 'walCheckpoint',
  // 通用
  'constructor', 'raw', 'statements', 'dbWriteMutex',
]);

function extractServiceMethods(
  filePath: string,
  program: ts.Program,
  targetClassName: string,
): ExtractedMethod[] {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) return [];

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return [];

  const exports = checker.getExportsOfModule(moduleSymbol);
  const results: ExtractedMethod[] = [];

  for (const exp of exports) {
    if (exp.name !== targetClassName) continue;

    const declarations = exp.getDeclarations();
    if (!declarations || declarations.length === 0) continue;

    const classDecl = declarations[0]!;
    if (!ts.isClassDeclaration(classDecl)) continue;

    const classType = checker.getTypeAtLocation(classDecl);
    const members = classType.getProperties();

    for (const member of members) {
      // 跳过排除列表
      if (EXCLUDED_METHODS.has(member.name)) continue;

      // 只处理方法
      if (!(member.flags & ts.SymbolFlags.Method)) continue;

      const memberDecl = member.valueDeclaration ?? member.declarations?.[0];
      if (!memberDecl) continue;

      // 跳过 private / protected
      const modifiers = ts.getCombinedModifierFlags(memberDecl as ts.Declaration);
      if (modifiers & ts.ModifierFlags.Private || modifiers & ts.ModifierFlags.Protected) continue;

      const memberType = checker.getTypeOfSymbolAtLocation(member, memberDecl);
      const callSigs = memberType.getCallSignatures();
      if (callSigs.length === 0) continue;

      const sig = callSigs[0]!;

      // JSDoc description（方法级）
      const jsDocs = ts.getJSDocTags(memberDecl);
      const descTag = jsDocs.find((t) => t.tagName.text === 'description');
      let description = '';
      if (descTag) {
        description = ts.getTextOfJSDocComment(descTag.comment) ?? '';
      } else {
        // 尝试从 JSDoc 主注释取
        const jsDocNodes = ts.getJSDocCommentsAndTags(memberDecl).filter(ts.isJSDoc);
        if (jsDocNodes && jsDocNodes.length > 0) {
          const mainComment = jsDocNodes[0]!.comment;
          if (typeof mainComment === 'string') {
            description = mainComment;
          } else if (mainComment) {
            description = ts.getTextOfJSDocComment(mainComment) ?? '';
          }
        }
      }

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
        className: targetClassName,
        methodName: member.name,
        toolName: camelToSnake(member.name),
        description,
        params,
        paramOrder: params.map((p) => p.name),
        returnSchema,
      });
    }

    break; // 找到目标类后停止
  }

  return results;
}

// ─── §3.6 校验: 与 tool-definitions.ts 手工定义做 diff ───

interface DiffResult {
  missingInHandwritten: string[];  // AST 发现但手工定义缺失
  missingInGenerated: string[];    // 手工定义有但 AST 未发现
  signatureMismatches: Array<{
    toolName: string;
    field: string;
    generated: string;
    handwritten: string;
  }>;
}

function diffWithHandwritten(
  generatedByModule: Map<string, ExtractedMethod[]>,
  handwrittenPath: string,
): DiffResult | null {
  // 动态 import tool-definitions.ts 的 getToolDefinitions
  let handwrittenDefs: Array<{
    name: string;
    module: string;
    functionName: string;
    inputSchema: { properties: Record<string, unknown>; required?: string[] };
    paramOrder: string[];
  }>;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(handwrittenPath);
    handwrittenDefs = mod.getToolDefinitions();
  } catch {
    return null;
  }

  const handwrittenMap = new Map(handwrittenDefs.map((d) => [d.name, d]));
  const generatedMap = new Map<string, ExtractedMethod>();
  for (const methods of generatedByModule.values()) {
    for (const m of methods) {
      generatedMap.set(m.toolName, m);
    }
  }

  const result: DiffResult = {
    missingInHandwritten: [],
    missingInGenerated: [],
    signatureMismatches: [],
  };

  // 手工定义中存在但 AST 没扫到的（排除 system 模块）
  for (const [name, def] of handwrittenMap) {
    if (def.module === 'system') continue;
    if (!generatedMap.has(name)) {
      result.missingInGenerated.push(name);
    }
  }

  // AST 扫到但手工定义缺失的
  for (const [name] of generatedMap) {
    if (!handwrittenMap.has(name)) {
      result.missingInHandwritten.push(name);
    }
  }

  // 参数签名比对
  for (const [name, genMethod] of generatedMap) {
    const handDef = handwrittenMap.get(name);
    if (!handDef) continue;

    // 比对参数名集合
    const genParamNames = genMethod.params.map((p) => p.name).sort().join(',');
    const handParamNames = handDef.paramOrder.sort().join(',');
    if (genParamNames !== handParamNames) {
      result.signatureMismatches.push({
        toolName: name,
        field: 'paramNames',
        generated: genParamNames,
        handwritten: handParamNames,
      });
    }

    // 比对 required 字段
    const genRequired = genMethod.params.filter((p) => p.required).map((p) => p.name).sort().join(',');
    const handRequired = (handDef.inputSchema.required ?? []).slice().sort().join(',');
    if (genRequired !== handRequired) {
      result.signatureMismatches.push({
        toolName: name,
        field: 'required',
        generated: genRequired,
        handwritten: handRequired,
      });
    }
  }

  return result;
}

// ─── 主函数 ───

function main(): void {
  const validateOnly = process.argv.includes('--validate');
  const projectRoot = path.resolve(__dirname, '../..');
  const tsconfigPath = path.resolve(projectRoot, 'tsconfig.json');

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    projectRoot,
  );

  // 模块名 → 入口文件路径
  const moduleEntries: Array<{ module: string; file: string; className: string }> = [
    { module: 'search', file: 'src/core/search/index.ts', className: 'SearchService' },
    { module: 'acquire', file: 'src/core/acquire/index.ts', className: 'AcquireService' },
    { module: 'process', file: 'src/core/process/index.ts', className: 'ProcessService' },
    { module: 'database', file: 'src/core/database/index.ts', className: 'DatabaseService' },
    { module: 'rag', file: 'src/core/rag/index.ts', className: 'RagService' },
    { module: 'bibliography', file: 'src/core/bibliography/index.ts', className: 'BibliographyService' },
  ];

  const entryFiles = moduleEntries.map((e) => path.resolve(projectRoot, e.file));
  const program = ts.createProgram(entryFiles, parsedConfig.options);

  const allMethods: ExtractedMethod[] = [];
  const methodsByModule = new Map<string, ExtractedMethod[]>();

  for (const entry of moduleEntries) {
    const absPath = path.resolve(projectRoot, entry.file);
    const methods = extractServiceMethods(absPath, program, entry.className);
    allMethods.push(...methods);
    methodsByModule.set(entry.module, methods);
  }

  // ─── 生成完整 tool 定义（含可推断的元数据） ───

  const toolDefs = allMethods.map((m) => {
    const moduleName = Object.entries(MODULE_SERVICE_MAP)
      .find(([, cls]) => cls === m.className)?.[0] ?? 'unknown';

    return {
      name: m.toolName,
      description: m.description || `Auto-generated tool for ${m.className}.${m.methodName}`,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          m.params.map((p) => [p.name, { ...p.schema, ...(p.description ? { description: p.description } : {}) }]),
        ),
        required: m.params.filter((p) => p.required).map((p) => p.name),
      },
      // 运行时元数据（best-effort 推断，人工审核后合并到 tool-definitions.ts）
      module: moduleName,
      functionName: m.methodName,
      paramOrder: m.paramOrder,
      returnSchema: m.returnSchema,
    };
  });

  // ─── 输出生成结果 ───

  if (!validateOnly) {
    const outputDir = path.resolve(projectRoot, 'generated');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(
      path.resolve(outputDir, 'tool-definitions.json'),
      JSON.stringify(toolDefs, null, 2),
    );

    console.log(`Generated ${toolDefs.length} tool definitions → generated/tool-definitions.json`);

    // 按模块统计
    for (const [mod, methods] of methodsByModule) {
      console.log(`  ${mod}: ${methods.length} methods (${MODULE_SERVICE_MAP[mod]})`);
    }
  }

  // ─── §3.6 校验 diff ───

  const handwrittenPath = path.resolve(__dirname, 'tool-definitions');
  const diff = diffWithHandwritten(methodsByModule, handwrittenPath);

  if (diff) {
    let hasIssues = false;

    if (diff.missingInHandwritten.length > 0) {
      hasIssues = true;
      console.log(`\n⚠ Service 方法未在 tool-definitions.ts 中注册 (${diff.missingInHandwritten.length}):`);
      for (const name of diff.missingInHandwritten) {
        console.log(`  + ${name}`);
      }
    }

    if (diff.missingInGenerated.length > 0) {
      hasIssues = true;
      console.log(`\n⚠ tool-definitions.ts 中的工具未在 Service 类中找到 (${diff.missingInGenerated.length}):`);
      for (const name of diff.missingInGenerated) {
        console.log(`  - ${name}`);
      }
    }

    if (diff.signatureMismatches.length > 0) {
      hasIssues = true;
      console.log(`\n⚠ 签名不一致 (${diff.signatureMismatches.length}):`);
      for (const m of diff.signatureMismatches) {
        console.log(`  ≠ ${m.toolName}.${m.field}: AST=[${m.generated}] vs hand=[${m.handwritten}]`);
      }
    }

    if (!hasIssues) {
      console.log('\n✓ AST 反射结果与 tool-definitions.ts 完全一致');
    }
  } else {
    console.log('\n⚠ 无法加载 tool-definitions.ts 进行校验（跳过 diff）');
  }
}

// 直接执行时运行
main();
