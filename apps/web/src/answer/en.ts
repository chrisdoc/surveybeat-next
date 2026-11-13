import { answerCatalog } from "../messages/answer.ts";
import { answerMessages } from "./answer-messages.ts";
import { start } from "./main.ts";

// English answer page: imports only the English answer table (ADR 0018).
start(answerMessages(answerCatalog));
