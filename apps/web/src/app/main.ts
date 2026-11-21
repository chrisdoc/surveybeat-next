import { Runtime } from "foldkit";
import type { Navigation } from "foldkit";
import type { Url } from "foldkit/url";
import { init, Message, Model, subscriptions, update, view } from "./App.ts";
import "./app.css";

const container = typeof document !== "undefined" ? document.getElementById("root") : null;

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  container,
  routing: {
    onUrlRequest: (request: Navigation.UrlRequest) => Message.UrlRequested({ request }),
    onUrlChange: (url: Url) => Message.UrlChanged({ url }),
  },
});

if (container !== null) {
  Runtime.run(application);
}
