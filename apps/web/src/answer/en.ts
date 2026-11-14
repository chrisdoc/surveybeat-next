import { answerCatalog } from "../messages/answer.ts";
import { answerMessages } from "./answer-messages.ts";
import { start } from "./main.ts";

start(answerMessages(answerCatalog));
