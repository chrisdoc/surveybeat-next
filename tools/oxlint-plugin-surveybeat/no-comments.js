/**
 * rat-stack's no-comments policy (docs/agents/comment-debt-plan.md): prose in code is copied,
 * so a reason lives in a name, a test, a commit subject, or an ADR instead. Two rules:
 * `no-comments/no-comments` reports prose, `no-comments/directive-reason` reports a directive
 * without the reason after `--`. Both run in report-only mode until the ledger reaches zero.
 */

const DIRECTIVE =
  /^(?:\s*)(?:@ts-[\w-]+|@effect-diagnostics(?:-next-line)?|(?:oxlint|eslint)-(?:disable|disable-next-line|disable-line)|@vite-ignore|prettier-ignore|c8 ignore|istanbul ignore)/;
const REASON = /--\s*\S/;
const SAFETY = /^\s*SAFETY:\s*\S/;
const TYPE_TAGS = new Set([
  "@type",
  "@typedef",
  "@param",
  "@returns",
  "@return",
  "@property",
  "@prop",
  "@template",
  "@this",
  "@extends",
  "@implements",
  "@satisfies",
  "@typeParam",
]);

const textOf = (comment) => comment.value.replaceAll("\r", "");

const isDirective = (comment) => DIRECTIVE.test(textOf(comment));

const isTypesOnlyJsdoc = (comment) => {
  if (comment.type !== "Block") return false;
  return textOf(comment)
    .split("\n")
    .map((line) => line.replace(/^\s*\*?/, "").trim())
    .filter((line) => line !== "")
    .every((line) => TYPE_TAGS.has(line.split(/\s/)[0] ?? ""));
};

const isAllowed = (comment) => {
  const text = textOf(comment);
  if (isDirective(comment)) return true;
  if (SAFETY.test(text)) return true;
  return isTypesOnlyJsdoc(comment);
};

const commentsOf = (context, node) => {
  const source = context.sourceCode ?? context.getSourceCode?.();
  const fromSource = source?.getAllComments?.();
  if (Array.isArray(fromSource)) return fromSource;
  return node.comments ?? [];
};

const noComments = {
  meta: {
    type: "problem",
    docs: {
      description: "prose comments are banned; a reason belongs in a name, a test, a commit, or an ADR",
    },
    messages: {
      prose:
        "Prose comment. Move the reason into a name, a test, a type, a commit subject, or an ADR (docs/agents/comment-debt-plan.md).",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        for (const comment of commentsOf(context, node)) {
          if (isAllowed(comment)) continue;
          context.report({ loc: comment.loc, messageId: "prose" });
        }
      },
    };
  },
};

const directiveReason = {
  meta: {
    type: "problem",
    docs: {
      description: "a directive comment must say why after `--`",
    },
    messages: {
      reason:
        "Directive without a reason. Add `-- <why>` after the directive (docs/agents/comment-debt-plan.md).",
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        for (const comment of commentsOf(context, node)) {
          if (!isDirective(comment)) continue;
          if (REASON.test(textOf(comment))) continue;
          context.report({ loc: comment.loc, messageId: "reason" });
        }
      },
    };
  },
};

export default {
  meta: { name: "no-comments" },
  rules: {
    "no-comments": noComments,
    "directive-reason": directiveReason,
  },
};
