import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { message } from "../messages/index.ts";
import { App } from "./App.tsx";
import "./app.css";

document.title = message("app.title");

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
