import * as Schema from "effect/Schema"
import { Exchange } from "./schema"
export const decodeExchange = Schema.decodeUnknownSync(Exchange)
