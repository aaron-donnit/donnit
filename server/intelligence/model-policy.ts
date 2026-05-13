export type DonnitModelProvider = "openai" | "hermes";

export type DonnitModelPolicy = {
  provider: DonnitModelProvider;
  smallModel: string;
  reasoningProvider: DonnitModelProvider;
  reasoningModel: string;
  hermesBaseUrl: string | null;
  feature: string;
};

function providerFromEnv(value: string | undefined, fallback: DonnitModelProvider): DonnitModelProvider {
  if (value === "hermes" || value === "openai") return value;
  return fallback;
}

export function getDonnitModelPolicy(feature: string): DonnitModelPolicy {
  const provider = providerFromEnv(process.env.DONNIT_LLM_PROVIDER, "openai");
  const reasoningProvider = providerFromEnv(process.env.DONNIT_REASONING_PROVIDER, provider);
  return {
    provider,
    smallModel: process.env.DONNIT_AI_MODEL ?? "gpt-5-mini",
    reasoningProvider,
    reasoningModel:
      reasoningProvider === "hermes"
        ? process.env.HERMES_MODEL ?? "nous-hermes"
        : process.env.DONNIT_REASONING_MODEL ?? "gpt-5",
    hermesBaseUrl: process.env.HERMES_BASE_URL ?? null,
    feature,
  };
}

export function isHermesConfigured() {
  return Boolean(process.env.HERMES_API_KEY && process.env.HERMES_BASE_URL);
}
