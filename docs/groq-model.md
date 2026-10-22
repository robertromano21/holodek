# Groq GPT-OSS 120B

Choose GPT-OSS 120B (Groq) in the startup picker or model menu. This is the hosted base model openai/gpt-oss-120b, not the local Holodek-1 adapter. New-game selection still defaults to Luna; Holodek-1 is hidden only from startup selection. Grok appears first, followed by OpenAI, Groq and local options.

Use a Groq API key, separate from OpenAI or xAI. Enter it through the existing masked model-picker prompt; the server saves it only in ignored keys/groq.key, or reads GROQ_API_KEY from its environment. Keys are not returned by the catalog. No key or account is included in this release. Groq-hosted models use the same Groq key, subject to account access and billing.

Groq strict JSON answers use non-streaming JSON Schema requests without tools, validate against the original requested schema, and reject invalid content. Null placeholders introduced solely for optional schema properties are decoded back to absent fields. Other calls retain the provider's normal transport path. Background helpers forward the credential ephemerally through the existing protected gateway and route only to the fixed Groq endpoint.

Three retries follow an initial transient provider attempt, with a shared four-attempt budget across nested generation/transport layers. Retries stop once stream content has been published. A valid schema or a test pass does not guarantee provider availability or game-world semantic correctness.

Groq's documented custom LoRA hosting is an enterprise feature with supported base-model restrictions; this release does not upload Holodek-1 or claim its adapter is compatible with GPT-OSS 120B.

Official references: https://console.groq.com/docs/model/openai/gpt-oss-120b , https://console.groq.com/docs/structured-outputs , https://console.groq.com/docs/lora .
