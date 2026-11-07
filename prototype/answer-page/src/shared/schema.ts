import * as Schema from "effect/Schema"

export const Exchange = Schema.Struct({
  pulseName: Schema.String,
  anonymity: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  questions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      allowComment: Schema.Boolean,
    }),
  ),
  actions: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
})
export type Exchange = typeof Exchange.Type
