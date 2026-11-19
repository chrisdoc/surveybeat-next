import path from "node:path";

import { definePlugin, defineRule } from "@oxlint/plugins";
import type { Context, Definition, ESTree, Scope, Variable } from "@oxlint/plugins";

type RuleContext = Context;

type NodeOfType<Type extends ESTree.Node["type"]> = Extract<ESTree.Node, { type: Type }>;

type AssignmentPatternNode = ESTree.AssignmentPattern;

type ReturnStatementNode = NodeOfType<"ReturnStatement">;

type FunctionThunk = ESTree.ArrowFunctionExpression | ESTree.Function;

const repoRoot = path.resolve(import.meta.dirname, "../..");

const workspacePath = (filename: string) => {
  const relative = path.relative(repoRoot, path.resolve(filename)).split(path.sep).join("/");

  const match = /(?:^|\/)(?<workspace>(?:apps|packages)\/.+)$/u.exec(relative);

  return match?.groups?.workspace ?? relative;
};

const isRuntimeSource = (filename: string) => /^(?:apps|packages)\/[^/]+\/src\/.+/u.test(filename);

const unwrapExpression = (node: ESTree.Expression): ESTree.Expression => {
  if (
    node.type === "ParenthesizedExpression" ||
    node.type === "ChainExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSInstantiationExpression" ||
    node.type === "TSTypeAssertion"
  ) {
    return unwrapExpression(node.expression);
  }

  return node;
};

const staticPropertyName = (node: ESTree.MemberExpression): string | null => {
  if (!node.computed) {
    return node.property.type === "Identifier" ? node.property.name : null;
  }

  if (node.property.type === "Literal") {
    return typeof node.property.value === "string" ? node.property.value : null;
  }

  if (node.property.type === "TemplateLiteral" && node.property.expressions.length === 0) {
    const [firstQuasi] = node.property.quasis;

    return firstQuasi?.value.cooked ?? firstQuasi?.value.raw ?? null;
  }

  return null;
};

const staticPropertyKeyName = (node: ESTree.ObjectProperty | ESTree.BindingProperty): string | null => {
  if (!node.computed && node.key.type === "Identifier") {
    return node.key.name;
  }

  if (node.key.type === "Literal") {
    return typeof node.key.value === "string" ? node.key.value : null;
  }

  if (node.key.type === "TemplateLiteral" && node.key.expressions.length === 0) {
    const [firstQuasi] = node.key.quasis;

    return firstQuasi?.value.cooked ?? firstQuasi?.value.raw ?? null;
  }

  return null;
};

const stringValue = (node: ESTree.Expression): string | null => {
  const expression = unwrapExpression(node);

  if (expression.type === "Literal" && typeof expression.value === "string") {
    return expression.value;
  }

  if (expression.type === "TemplateLiteral" && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? expression.quasis[0]?.value.raw ?? null;
  }

  return null;
};

const variableOf = (name: string, scope: Scope | null): Variable | undefined =>
  scope === null ? undefined : (scope.set.get(name) ?? variableOf(name, scope.upper));

const declarationOf = (name: string, scope: Scope | null): Definition | undefined =>
  variableOf(name, scope)?.defs[0];

const isStableVariable = (variable: Variable) =>
  variable.references.every((reference) => !reference.isWrite() || reference.init);

const importedName = (node: ESTree.ImportSpecifier) =>
  node.imported.type === "Identifier" ? node.imported.name : node.imported.value;

interface ImportIdentity {
  readonly module: string;
  readonly name: string | null;
}

const importBindingIdentity = (definition: Definition): ImportIdentity | null => {
  const { parent } = definition.node;

  if (definition.type !== "ImportBinding" || parent?.type !== "ImportDeclaration") {
    return null;
  }

  const module = stringValue(parent.source);

  if (module === null) {
    return null;
  }

  return {
    module,
    name: definition.node.type === "ImportSpecifier" ? importedName(definition.node) : null,
  };
};

const importIdentity = (
  expression: ESTree.Expression,
  scope: Scope | null,
  context: RuleContext,
  seen = new Set<Definition["node"]>(),
): ImportIdentity | null => {
  const requireFunction = (
    candidate: ESTree.Expression,
    candidateScope: Scope | null,
    visited = new Set<Definition["node"]>(),
  ): boolean => {
    const requireBinding = (name: string, bindingScope: Scope | null) => {
      const variable = variableOf(name, bindingScope);

      if (variable === undefined) {
        return name === "require";
      }

      const [definition] = variable.defs;

      if (
        definition?.type !== "Variable" ||
        definition.node.type !== "VariableDeclarator" ||
        definition.node.init === null ||
        !isStableVariable(variable) ||
        visited.has(definition.node)
      ) {
        return false;
      }

      visited.add(definition.node);

      const declarationScope = context.sourceCode.getScope(definition.node);

      if (definition.node.id.type === "ObjectPattern") {
        const initializer = unwrapExpression(definition.node.init);

        return (
          initializer.type === "Identifier" &&
          initializer.name === "module" &&
          variableOf("module", declarationScope) === undefined &&
          definition.node.id.properties.some(
            (property) =>
              property.type === "Property" &&
              property.value.type === "Identifier" &&
              property.value.name === name &&
              staticPropertyKeyName(property) === "require",
          )
        );
      }

      if (definition.node.id.type !== "Identifier") {
        return false;
      }

      return requireFunction(definition.node.init, declarationScope, visited);
    };

    const target = unwrapExpression(candidate);

    if (target.type === "Identifier") {
      return requireBinding(target.name, candidateScope);
    }

    if (target.type === "MemberExpression") {
      return (
        staticPropertyName(target) === "require" &&
        target.object.type === "Identifier" &&
        target.object.name === "module" &&
        variableOf("module", candidateScope) === undefined
      );
    }

    if (target.type === "CallExpression") {
      const identity = importIdentity(target.callee, candidateScope, context, visited);

      return (
        identity?.name === "createRequire" &&
        (identity.module === "module" || identity.module === "node:module")
      );
    }

    return false;
  };

  const loadedModuleIdentity = (
    candidate: ESTree.Expression,
    candidateScope: Scope | null,
  ): ImportIdentity | null => {
    const target = unwrapExpression(candidate);

    if (target.type === "AwaitExpression") {
      return loadedModuleIdentity(target.argument, candidateScope);
    }

    if (target.type === "ImportExpression") {
      const module = stringValue(target.source);

      return module === null ? null : { module, name: null };
    }

    if (target.type !== "CallExpression") {
      return null;
    }

    const [argument] = target.arguments;

    if (
      argument === undefined ||
      argument.type === "SpreadElement" ||
      !requireFunction(target.callee, candidateScope)
    ) {
      return null;
    }

    const module = stringValue(argument);

    return module === null ? null : { module, name: null };
  };

  const importIdentityForPattern = (
    name: string,
    pattern: ESTree.ObjectPattern,
    initializer: ESTree.Expression,
    patternScope: Scope | null,
  ): ImportIdentity | null => {
    const property = pattern.properties.find(
      (item) => item.type === "Property" && item.value.type === "Identifier" && item.value.name === name,
    );

    if (property?.type !== "Property") {
      return null;
    }

    const imported = staticPropertyKeyName(property);
    const namespace = importIdentity(initializer, patternScope, context, seen);

    if (namespace === null || (namespace.name !== null && namespace.name !== "Effect") || imported === null) {
      return null;
    }

    return {
      module: namespace.name === null ? namespace.module : `${namespace.module}/${namespace.name}`,
      name: imported,
    };
  };

  const importIdentityForVariable = (name: string, variable: Variable): ImportIdentity | null => {
    const [definition] = variable.defs;

    if (definition === undefined || seen.has(definition.node)) {
      return null;
    }

    seen.add(definition.node);

    const imported = importBindingIdentity(definition);

    if (imported !== null) {
      return imported;
    }

    if (
      definition.type !== "Variable" ||
      definition.node.type !== "VariableDeclarator" ||
      !isStableVariable(variable) ||
      definition.node.init === null
    ) {
      return null;
    }

    const initializer = definition.node.init;
    const declarationScope = context.sourceCode.getScope(definition.node);

    if (definition.node.id.type === "ObjectPattern") {
      return importIdentityForPattern(name, definition.node.id, initializer, declarationScope);
    }

    return importIdentity(initializer, declarationScope, context, seen);
  };

  const loadedModule = loadedModuleIdentity(expression, scope);

  if (loadedModule !== null) {
    return loadedModule;
  }

  const value = unwrapExpression(expression);

  if (value.type === "Identifier") {
    const variable = variableOf(value.name, scope);

    return variable === undefined ? null : importIdentityForVariable(value.name, variable);
  }

  if (value.type === "MemberExpression") {
    const object = importIdentity(value.object, scope, context, seen);
    const name = staticPropertyName(value);

    if (object === null || (object.name !== null && object.name !== "Effect") || name === null) {
      return null;
    }

    return { module: object.module, name };
  }

  return null;
};

const isEffectCall = (node: ESTree.Node, member: string, context: RuleContext) => {
  const expression = node.type === "CallExpression" ? node : null;

  if (expression === null) {
    return false;
  }

  const callee = unwrapExpression(expression.callee);
  const scope = context.sourceCode.getScope(expression);

  if (callee.type === "Identifier") {
    const identity = importIdentity(callee, scope, context);

    return (
      identity !== null &&
      (identity.module === "effect" || identity.module.startsWith("effect/")) &&
      identity.name === member
    );
  }

  if (callee.type !== "MemberExpression" || staticPropertyName(callee) !== member) {
    return false;
  }

  const identity = importIdentity(callee.object, scope, context);

  return (
    identity !== null &&
    (identity.module === "effect" || identity.module.startsWith("effect/")) &&
    (identity.name === "Effect" || identity.name === null)
  );
};

const cacheConstructors = ["cached", "cachedWithTTL", "cachedInvalidateWithTTL"];

const isAlchemyModule = (module: string) =>
  module.startsWith("alchemy") || module.startsWith("@alchemy.run/");

const isInitializationCall = (node: ESTree.CallExpression, context: RuleContext) => {
  const scope = context.sourceCode.getScope(node);
  const identity = importIdentity(node.callee, scope, context);

  if (identity !== null && isAlchemyModule(identity.module)) {
    return true;
  }

  if (node.callee.type !== "MemberExpression") {
    return false;
  }

  const object = importIdentity(node.callee.object, scope, context);

  return (
    object !== null &&
    ((object.module === "effect" && object.name === "Layer") ||
      object.module === "effect/Layer" ||
      isAlchemyModule(object.module))
  );
};

const isFetchFunction = (node: FunctionThunk) => {
  const { parent } = node;

  return (
    (node.type === "FunctionDeclaration" && node.id?.name === "fetch") ||
    (parent?.type === "VariableDeclarator" &&
      parent.id.type === "Identifier" &&
      parent.id.name === "fetch") ||
    (parent?.type === "Property" && parent.key.type === "Identifier" && parent.key.name === "fetch")
  );
};

const isEffectThunk = (node: FunctionThunk, context: RuleContext) => {
  const { parent } = node;

  return (
    parent?.type === "CallExpression" &&
    (isEffectCall(parent, "gen", context) ||
      (parent.callee.type === "CallExpression" && isEffectCall(parent.callee, "fn", context)) ||
      isEffectCall(parent, "fnUntraced", context))
  );
};

const isEffectFnMethod = (node: FunctionThunk, context: RuleContext) => {
  const call = node.parent;

  return (
    call?.type === "CallExpression" &&
    call.parent?.type === "Property" &&
    call.parent.value === call &&
    (isEffectCall(call, "fn", context) ||
      isEffectCall(call, "fnUntraced", context) ||
      (call.callee.type === "CallExpression" && isEffectCall(call.callee, "fn", context)))
  );
};

const isSharedConstruction = (node: ESTree.Node, context: RuleContext) => {
  let current: ESTree.Node | null = node.parent;

  while (current !== null) {
    if (current.type === "CallExpression" && isInitializationCall(current, context)) {
      return true;
    }

    if (
      (current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression") &&
      isEffectFnMethod(current, context)
    ) {
      return false;
    }

    if (
      (current.type === "FunctionDeclaration" ||
        current.type === "FunctionExpression" ||
        current.type === "ArrowFunctionExpression") &&
      !isEffectThunk(current, context)
    ) {
      if (isFetchFunction(current)) {
        return false;
      }

      const scope = context.sourceCode.getScope(current);

      if (scope.upper?.type !== "module" && scope.upper?.type !== "global") {
        return false;
      }
    }

    current = current.parent;
  }

  return true;
};

const noSharedPendingCache = defineRule({
  create(context) {
    if (!isRuntimeSource(workspacePath(context.filename))) {
      return {};
    }

    return {
      CallExpression(node) {
        if (
          cacheConstructors.some((name) => isEffectCall(node, name, context)) &&
          isSharedConstruction(node, context)
        ) {
          context.report({ messageId: "pendingCache", node });
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Keep pending request work out of shared initialization caches.",
    },
    messages: {
      pendingCache:
        "Effect.cached* at this scope shares pending work across requests. One request's interruption or failure then reaches every caller waiting on it. Fix: cache completed values only at module, service, or Worker initialization scope, or move the cache into the request; a scoped exception names its lifetime with `-- <reason>`.",
    },
    type: "problem",
  },
});

const isNodeWithin = (node: ESTree.Node, ancestor: ESTree.Node) => {
  let current: ESTree.Node | null = node;

  while (current !== null) {
    if (current === ancestor) {
      return true;
    }

    current = current.parent;
  }

  return false;
};

const isCapturedValue = (
  expression: ESTree.Expression,
  thunk: FunctionThunk,
  context: RuleContext,
  seen = new Set<Definition["node"]>(),
): boolean => {
  const value = unwrapExpression(expression);

  if (value.type === "Identifier") {
    const definition = declarationOf(value.name, context.sourceCode.getScope(value));

    if (definition === undefined) {
      return true;
    }

    if (seen.has(definition.node)) {
      return false;
    }

    seen.add(definition.node);

    if (!isNodeWithin(definition.node, thunk)) {
      return true;
    }

    if (definition.node.type === "VariableDeclarator") {
      return definition.node.init === null
        ? false
        : isCapturedValue(definition.node.init, thunk, context, seen);
    }

    const defaultedParameter = thunk.params.find(
      (parameter): parameter is AssignmentPatternNode =>
        parameter.type === "AssignmentPattern" &&
        parameter.left.type === "Identifier" &&
        parameter.left.name === value.name,
    );

    return defaultedParameter === undefined
      ? false
      : isCapturedValue(defaultedParameter.right, thunk, context, seen);
  }

  if (value.type === "ThisExpression") {
    return true;
  }

  if (value.type === "MemberExpression") {
    if (value.object.type === "ThisExpression") {
      return true;
    }

    return isCapturedValue(value.object, thunk, context, seen);
  }

  return false;
};

const returnsCapturedHandle = (node: ESTree.Node, context: RuleContext) => {
  if (node.type !== "CallExpression") {
    return false;
  }

  const expression = unwrapExpression(node);

  if (expression.type !== "CallExpression" || !isEffectCall(expression, "sync", context)) {
    return false;
  }

  const [argument] = expression.arguments;

  const thunk =
    argument === undefined || argument.type === "SpreadElement" ? null : unwrapExpression(argument);

  if (
    thunk === null ||
    (thunk.type !== "ArrowFunctionExpression" && thunk.type !== "FunctionExpression") ||
    thunk.body === null
  ) {
    return false;
  }

  if (thunk.body.type !== "BlockStatement") {
    return isCapturedValue(thunk.body, thunk, context);
  }

  const returns = thunk.body.body.filter(
    (statement): statement is ReturnStatementNode => statement.type === "ReturnStatement",
  );

  const [returned] = returns;

  return (
    returns.length === 1 &&
    returned !== undefined &&
    returned.argument !== null &&
    isCapturedValue(returned.argument, thunk, context)
  );
};

const acquireReleaseConstructsInAcquireBody = defineRule({
  create(context) {
    return {
      CallExpression(node) {
        if (!isEffectCall(node, "acquireRelease", context)) {
          return;
        }

        const [acquire] = node.arguments;

        if (acquire === undefined || acquire.type === "SpreadElement") {
          return;
        }

        const expression = unwrapExpression(acquire);

        if (isEffectCall(expression, "succeed", context) || returnsCapturedHandle(expression, context)) {
          context.report({ messageId: "eagerAcquire", node: acquire });
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Construct a resource inside the Effect.acquireRelease acquire Effect, not before it.",
    },
    messages: {
      eagerAcquire:
        "This acquire returns a resource built before acquire runs. An interruption in between leaks it, because release never sees it. Fix: build the resource inside acquire, for example `Effect.sync(() => new Pool(options))` or `Effect.tryPromise(...)`, not `Effect.succeed(handle)` or `Effect.sync(() => handle)`.",
    },
    type: "problem",
  },
});

const isModuleScopedVar = (node: ESTree.Node) => {
  let current = node.parent;

  while (current !== null && current.type !== "Program") {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression" ||
      current.type === "StaticBlock" ||
      current.type === "TSDeclareFunction" ||
      current.type === "TSModuleBlock"
    ) {
      return false;
    }

    current = current.parent;
  }

  return current?.type === "Program";
};

const noModuleLevelMutableState = defineRule({
  create(context) {
    if (!isRuntimeSource(workspacePath(context.filename))) {
      return {};
    }

    return {
      VariableDeclaration(node) {
        if (node.kind !== "let" && node.kind !== "var") {
          return;
        }

        const scope = context.sourceCode.getScope(node);

        const moduleScoped =
          node.kind === "let" ? scope.type === "module" || scope.type === "global" : isModuleScopedVar(node);

        if (moduleScoped) {
          context.report({ messageId: "moduleState", node });
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Keep state out of module-level let and var bindings.",
    },
    messages: {
      moduleState:
        "Module-level let and var hold state that outlives one request. Every request a Worker isolate or server process handles shares it, so one request's state leaks into the next. Fix: keep the state in a `Ref` inside a Layer, a Durable Object, or the database.",
    },
    type: "problem",
  },
});

const waitingConstructors = new Map([
  ["Deferred", new Set(["make", "makeUnsafe"])],
  ["Cache", new Set(["make", "makeWith"])],
  ["Ref", new Set(["make", "makeUnsafe"])],
  ["Semaphore", new Set(["make", "makeUnsafe"])],
  ["Queue", new Set(["make", "bounded", "unbounded", "dropping", "sliding"])],
  ["Latch", new Set(["make", "makeUnsafe"])],
  ["PubSub", new Set(["make", "bounded", "unbounded", "dropping", "sliding"])],
  ["PartitionedSemaphore", new Set(["make", "makeUnsafe"])],
  ["TxSemaphore", new Set(["make"])],
]);

const isWaitingConstructor = (node: ESTree.CallExpression, context: RuleContext) => {
  const scope = context.sourceCode.getScope(node);
  const callee = unwrapExpression(node.callee);
  const identity = importIdentity(callee, scope, context);

  if (identity?.module.startsWith("effect/") === true) {
    const primitive = identity.module.slice("effect/".length);

    return waitingConstructors.get(primitive)?.has(identity.name ?? "") === true;
  }

  if (callee.type !== "MemberExpression") {
    return false;
  }

  const object = importIdentity(callee.object, scope, context);

  return (
    object?.module === "effect" &&
    waitingConstructors.get(object.name ?? "")?.has(staticPropertyName(callee) ?? "") === true
  );
};

const isLayerOwnedConstruction = (node: ESTree.CallExpression, context: RuleContext) => {
  const callee = unwrapExpression(node.callee);

  const constructorName =
    callee.type === "MemberExpression"
      ? staticPropertyName(callee)
      : importIdentity(callee, context.sourceCode.getScope(node), context)?.name;

  if (constructorName === "makeUnsafe") {
    return false;
  }

  if (node.parent?.type !== "CallExpression") {
    return false;
  }

  const target = unwrapExpression(node.parent.callee);
  const scope = context.sourceCode.getScope(node.parent);
  const identity = importIdentity(target, scope, context);

  if (identity?.module === "effect/Layer") {
    return identity.name === "effect" || identity.name === "effectDiscard";
  }

  if (target.type !== "MemberExpression") {
    return false;
  }

  const owner = importIdentity(target.object, scope, context);

  return (
    (staticPropertyName(target) === "effect" || staticPropertyName(target) === "effectDiscard") &&
    owner?.module === "effect" &&
    owner.name === "Layer"
  );
};

const isDurableObjectInstanceField = (field: ESTree.PropertyDefinition, context: RuleContext) => {
  const owner = field.parent?.parent;

  const superclass =
    owner?.type === "ClassDeclaration" || owner?.type === "ClassExpression" ? owner.superClass : null;

  const identity =
    superclass === null ? null : importIdentity(superclass, context.sourceCode.getScope(field), context);

  return !field.static && identity?.module === "cloudflare:workers" && identity.name === "DurableObject";
};

const sharedWaiterOwner = (node: ESTree.Node, context: RuleContext): ESTree.Node | null => {
  let current = node.parent;

  while (current !== null) {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression" ||
      current.type === "FunctionDeclaration"
    ) {
      return null;
    }

    if (current.type === "PropertyDefinition") {
      return isDurableObjectInstanceField(current, context) ? null : current;
    }

    if (
      current.type === "VariableDeclarator" &&
      current.parent?.type === "VariableDeclaration" &&
      current.parent.kind === "const" &&
      isModuleScopedVar(current)
    ) {
      return current;
    }

    current = current.parent;
  }

  return null;
};

const sharedWaiters = defineRule({
  create(context) {
    if (!isRuntimeSource(workspacePath(context.filename))) {
      return {};
    }

    return {
      CallExpression(node) {
        if (
          sharedWaiterOwner(node, context) !== null &&
          isWaitingConstructor(node, context) &&
          !isLayerOwnedConstruction(node, context)
        ) {
          context.report({ messageId: "sharedWaiter", node });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Keep Deferred, Cache, Ref, Semaphore, Queue, Latch, PubSub, PartitionedSemaphore, and TxSemaphore construction out of module const bindings and class fields outside Durable Object instances. In drovr #2344 and #2348, cross-request waiters in a Worker isolate made another caller hang or receive a 503.",
    },
    messages: {
      sharedWaiter:
        "This waiting primitive lives at module level or outside a Durable Object instance. Worker request contexts then share its pending work, so another caller hangs or gets a 503. Fix: construct it inside a request-owned Effect or a Durable Object instance; for Layers use `Layer.effect(Tag, Ref.make(...))`, not `Layer.succeed(Tag, Ref.makeUnsafe(...))`, and never store it or its run result in a module const.",
    },
    type: "problem",
  },
});

const noSleepInLoop = defineRule({
  create(context) {
    if (!isRuntimeSource(workspacePath(context.filename))) {
      return {};
    }

    return {
      CallExpression(node) {
        if (!isEffectCall(node, "sleep", context)) {
          return;
        }

        let yielded = false;
        let parent: ESTree.Node | null = node;

        while (parent !== null) {
          if (
            parent.type === "FunctionExpression" ||
            parent.type === "FunctionDeclaration" ||
            parent.type === "ArrowFunctionExpression"
          ) {
            return;
          }

          if (parent.type === "YieldExpression") {
            yielded = true;
          }

          if (
            yielded &&
            (parent.type === "WhileStatement" ||
              parent.type === "DoWhileStatement" ||
              parent.type === "ForStatement" ||
              parent.type === "ForOfStatement" ||
              parent.type === "ForInStatement")
          ) {
            context.report({ messageId: "machine", node: parent });

            return;
          }

          ({ parent } = parent);
        }
      },
    };
  },
  meta: {
    docs: { description: "Sleeping retry loops belong in lifecycle machines." },
    messages: {
      machine:
        "This loop yields Effect.sleep. A hand-rolled retry or polling loop hides its states, cancellation, and resumption. Fix: move the loop into an XState lifecycle machine with declared `createEffectLogic` actors.",
    },
    type: "problem",
  },
});

export default definePlugin({
  meta: { name: "patterns" },
  rules: {
    "acquire-release-constructs-in-acquire-body": acquireReleaseConstructsInAcquireBody,
    "no-module-level-mutable-state": noModuleLevelMutableState,
    "no-shared-pending-cache": noSharedPendingCache,
    "no-sleep-in-loop": noSleepInLoop,
    "shared-waiters": sharedWaiters,
  },
});
