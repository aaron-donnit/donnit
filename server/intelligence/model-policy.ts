export type DonnitModelProvider = "openai" | "hermes" | "anthropic";

export type DonnitModelPolicy = {
  provider: DonnitModelProvider;
  smallModel: string;
  reasoningProvider: DonnitModelProvider;
  reasoningModel: string;
  hermesBaseUrl: string | null;
  feature: string;
};

function providerFromEnv(value: string | undefined, fallback: DonnitModelProvider): DonnitModelProvider {
  if (value === "hermes" || value === "openai" || value === "anthropic") return value;
  return fallback;
}

function reasoningModelForProvider(provider: DonnitModelProvider): string {
  if (provider === "hermes") return process.env.HERMES_MODEL ?? "nous-hermes";
  if (provider === "anthropic") return process.env.DONNIT_ANTHROPIC_REASONING_MODEL ?? "claude-opus-4-7";
  return process.env.DONNIT_REASONING_MODEL ?? "gpt-5";
}

function smallModelForProvider(provider: DonnitModelProvider): string {
  if (provider === "anthropic") return process.env.DONNIT_ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  return process.env.DONNIT_AI_MODEL ?? "gpt-5-mini";
}

export function getDonnitModelPolicy(feature: string): DonnitModelPolicy {
  const provider = providerFromEnv(process.env.DONNIT_LLM_PROVIDER, "openai");
  const reasoningProvider = providerFromEnv(process.env.DONNIT_REASONING_PROVIDER, provider);
  return {
    provider,
    smallModel: smallModelForProvider(provider),
    reasoningProvider,
    reasoningModel: reasoningModelForProvider(reasoningProvider),
    hermesBaseUrl: process.env.HERMES_BASE_URL ?? null,
    feature,
  };
}

export function isHermesConfigured() {
  return Boolean(process.env.HERMES_API_KEY && process.env.HERMES_BASE_URL);
}

export function isAnthropicConfigured() {
  return Boolean(process.env.DONNIT_ANTHROPIC_API_KEY);
}
