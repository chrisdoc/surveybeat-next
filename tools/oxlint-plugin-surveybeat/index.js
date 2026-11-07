// SurveyBeat oxlint plugin (ADR 0008). Plain ESLint-style rules, loaded through `jsPlugins`.

const PLATFORM = [/^cloudflare:/, /^alchemy$/, /^alchemy\//, /^@alchemy\.run\//];
const REACT = [
  /^react$/,
  /^react\//,
  /^react-dom$/,
  /^react-dom\//,
  /^@base-ui\/react$/,
  /^@base-ui\/react\//,
];
const API_CLIENT = [
  /^@surveybeat\/api$/,
  /^@surveybeat\/api\//,
  /^effect\/http-api$/,
  /^effect\/unstable\/httpapi/,
];

/** Which files are guarded, and what they must not import. */
const ZONES = [
  { name: "packages/domain", path: "/packages/domain/", banned: PLATFORM },
  { name: "packages/api", path: "/packages/api/", banned: PLATFORM },
  { name: "the answer entry", path: "/apps/web/src/answer/", banned: [...REACT, ...API_CLIENT] },
];

const toPath = (filename) => filename.replaceAll("\\", "/");

const domainBoundary = {
  meta: {
    type: "problem",
    docs: {
      description:
        "domain and api must not import cloudflare:* or Alchemy; the answer entry must not import React, Base UI, or the HttpApi client",
    },
    messages: {
      banned: "{{zone}} must not import '{{source}}' (ADR 0008).",
    },
    schema: [],
  },
  create(context) {
    const filename = toPath(context.filename);
    const zone = ZONES.find((z) => filename.includes(z.path));
    if (zone === undefined) return {};
    const check = (node, source) => {
      if (typeof source === "string" && zone.banned.some((re) => re.test(source))) {
        context.report({ node, messageId: "banned", data: { zone: zone.name, source } });
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

const UI_ATTRIBUTES = new Set([
  "title",
  "alt",
  "placeholder",
  "label",
  "aria-label",
  "aria-description",
  "aria-placeholder",
]);
const UI_PROPERTIES = new Set(["textContent", "innerText", "title", "placeholder"]);
const hasLetters = (text) => /\p{L}/u.test(text);
const isTextLiteral = (node) =>
  (node.type === "Literal" && typeof node.value === "string" && hasLetters(node.value)) ||
  (node.type === "TemplateLiteral" && node.quasis.some((q) => hasLetters(q.value.cooked ?? "")));

const noLiteralUiText = {
  meta: {
    type: "problem",
    docs: { description: "user-facing text in the web entries must come from the message catalog" },
    messages: {
      literal: "User-facing text must come from the message catalog (apps/web/src/messages).",
    },
    schema: [],
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: "literal" });
    return {
      JSXText: (node) => hasLetters(node.value) && report(node),
      JSXExpressionContainer: (node) => {
        if (node.parent.type !== "JSXAttribute" && isTextLiteral(node.expression)) report(node);
      },
      JSXAttribute: (node) => {
        if (node.name.type !== "JSXIdentifier" || !UI_ATTRIBUTES.has(node.name.name)) return;
        const value = node.value;
        if (value === null) return;
        if (isTextLiteral(value)) report(value);
        if (value.type === "JSXExpressionContainer" && isTextLiteral(value.expression)) report(value);
      },
      AssignmentExpression: (node) => {
        const left = node.left;
        if (
          left.type === "MemberExpression" &&
          !left.computed &&
          left.property.type === "Identifier" &&
          UI_PROPERTIES.has(left.property.name) &&
          isTextLiteral(node.right)
        ) {
          report(node.right);
        }
      },
    };
  },
};

export default {
  meta: { name: "surveybeat" },
  rules: { "domain-boundary": domainBoundary, "no-literal-ui-text": noLiteralUiText },
};
