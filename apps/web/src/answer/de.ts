import { answerDe } from "../messages/answer.de.ts";
import { answerMessages } from "./answer-messages.ts";
import { start } from "./main.ts";

// German answer page (`/de/a`): imports only the German answer table (ADR 0018).
start(answerMessages(answerDe));
