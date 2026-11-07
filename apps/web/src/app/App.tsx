import { Button } from "@base-ui/react/button";
import { message } from "../messages/index.ts";

/** The one placeholder route of the app entry. */
export function App() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">{message("app.title")}</h1>
      <p className="mt-2 text-gray-600">{message("app.placeholder")}</p>
      <Button className="mt-4 rounded bg-black px-4 py-2 text-white">{message("app.start")}</Button>
    </main>
  );
}
