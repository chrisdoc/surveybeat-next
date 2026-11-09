import * as Schema from "effect/Schema";

export const SubmissionRoundContext = Schema.Struct({
  roundId: Schema.String,
  pulseName: Schema.String,
  minimumGroupSize: Schema.Int,
  questions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      position: Schema.Int,
      text: Schema.String,
      type: Schema.Unknown,
    }),
  ),
  actions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
    }),
  ),
  closeTime: Schema.Int,
  state: Schema.String,
  hasAnswered: Schema.Boolean,
});

const decode = Schema.decodeUnknownOption(SubmissionRoundContext);

export function validateRoundContext(raw: unknown): boolean {
  const result = decode(raw);
  return result._tag === "Some";
}
