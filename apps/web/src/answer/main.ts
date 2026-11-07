// The answer entry: plain TypeScript, no React, no Base UI, no HttpApi client.
import { formatDate, message, pluralMessage } from "../messages/index.ts";

document.title = message("answer.title");

const container = document.getElementById("answer");
if (container !== null) {
  const lines = [
    message("answer.placeholder"),
    pluralMessage("answer.remaining", 1),
    message("answer.closes", { date: formatDate(new Date()) }),
  ];
  container.replaceChildren(
    ...lines.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }),
  );
}
