import type { GrantProps } from "../auth/props";

/**
 * Who agrees to spend: a person in the conversation (their yes), a budget on
 * the key, or nobody because nothing is spent (a plain sandbox key).
 */
export type SpendingRule = "person" | "budget" | "sandbox";

export function spendingRule(props: GrantProps): SpendingRule {
  if (props.kind === "oauth" || props.actsAs === "person") return "person";
  if (props.kind === "live" || props.actsAs === "bot") return "budget";
  return "sandbox";
}
