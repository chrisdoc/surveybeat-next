// Spike oxlint JS plugin: one rule, banning platform imports from packages/domain.
const BANNED = [/^cloudflare:/, /^alchemy$/, /^alchemy\//, /^@alchemy\.run\//];

const rule = {
  meta: {
    type: "problem",
    docs: { description: "domain must not import cloudflare:* or alchemy packages" },
    messages: {
      banned: "packages/domain must not import '{{source}}' (platform-neutral boundary, ADR 0008).",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    if (!filename.includes("/packages/domain/")) return {};
    const check = (node, source) => {
      if (typeof source === "string" && BANNED.some((re) => re.test(source))) {
        context.report({ node, messageId: "banned", data: { source } });
      }
    };
    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => node.source.type === "Literal" && check(node, node.source.value),
    };
  },
};

export default {
  meta: { name: "spike" },
  rules: { "no-platform-imports-in-domain": rule },
};
