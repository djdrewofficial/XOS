/** How an agent-composed text is classified. The agent does not get to choose.
    A freeform body is marketing. A template uses that template's own flag.
    STOP suppression is applied to every text, including transactional ones. */

export type AgentSmsClass = {
  isMarketing: boolean;
  policy: "freeform_is_marketing" | "template_flag";
};

export function classifyAgentSms(input: { templateId: string | null; templateIsMarketing: boolean }): AgentSmsClass {
  if (!input.templateId) return { isMarketing: true, policy: "freeform_is_marketing" };
  return { isMarketing: input.templateIsMarketing, policy: "template_flag" };
}

export const SMS_BODY_MAX = 1600;

export function assertSmsBody(body: string): string {
  const text = body.trim();
  if (!text) throw new Error("The text is empty.");
  if (text.length > SMS_BODY_MAX) {
    throw new Error(`This text is ${text.length} characters. The limit is ${SMS_BODY_MAX}. It was not shortened.`);
  }
  return text;
}
