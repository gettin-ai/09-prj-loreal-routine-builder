export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === "GET") {
      return jsonResponse(
        {
          ok: true,
          message: "L'Oréal routine builder worker is running.",
        },
        200,
        corsHeaders,
      );
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
    }

    try {
      const body = await request.json();
      const openAIKey = env.OPENAI_API_KEY;

      if (!openAIKey) {
        console.error(
          "Missing OPENAI_API_KEY in Worker environment. Set it under Workers > Settings > Variables and Secrets for the active deployment environment, then redeploy.",
        );
        return jsonResponse(
          {
            error:
              "Missing OPENAI_API_KEY in Worker environment (active deployment). Add the secret and redeploy.",
          },
          500,
          corsHeaders,
        );
      }

      const mode = body.mode === "routine" ? "routine" : "chat";
      const message =
        typeof body.message === "string" ? body.message.trim() : "";
      const selectedProducts = sanitizeProducts(body.selectedProducts);
      const chatHistory = sanitizeHistory(body.chatHistory);

      if (!message) {
        return jsonResponse(
          { error: "A message is required." },
          400,
          corsHeaders,
        );
      }

      if (!isBeautyRelatedMessage(message, selectedProducts, chatHistory)) {
        const offTopicReply = pickOffTopicReply(message, chatHistory);
        return jsonResponse(
          {
            text: offTopicReply,
            citations: [],
          },
          200,
          corsHeaders,
        );
      }

      const developerMessage = buildDeveloperMessage({
        mode,
        selectedProducts,
      });

      const input = [
        {
          role: "developer",
          content: developerMessage,
        },
        ...chatHistory.map((entry) => ({
          role: entry.role,
          content: entry.content,
        })),
        {
          role: "user",
          content: message,
        },
      ];

      const openAIResponse = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openAIKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: env.OPENAI_MODEL || "gpt-5.4-mini",
            input,
            tools: [{ type: "web_search_preview" }],
            tool_choice: {
              type: "allowed_tools",
              mode: "required",
              tools: [{ type: "web_search_preview" }],
            },
            include: ["web_search_call.action.sources"],
            truncation: "auto",
            text: {
              verbosity: "medium",
            },
            max_output_tokens: 1100,
          }),
        },
      );

      const data = await openAIResponse.json();

      if (!openAIResponse.ok) {
        const errorMessage =
          data?.error?.message || "OpenAI request failed inside the Worker.";
        return jsonResponse(
          { error: errorMessage },
          openAIResponse.status,
          corsHeaders,
        );
      }

      const normalized = normalizeResponse(data, {
        message,
        selectedProducts,
      });

      return jsonResponse(
        {
          text: normalized.text,
          citations: normalized.citations,
        },
        200,
        corsHeaders,
      );
    } catch (error) {
      return jsonResponse(
        {
          error:
            error instanceof Error ? error.message : "Unexpected Worker error.",
        },
        500,
        corsHeaders,
      );
    }
  },
};

function buildDeveloperMessage({ mode, selectedProducts }) {
  const productContext = selectedProducts.length
    ? JSON.stringify(selectedProducts, null, 2)
    : "[]";

  return `
You are the L'Oréal Product-Aware Routine Builder Advisor.

Your role:
- Help the user build and understand beauty routines using the selected products.
- Answer follow-up questions about skincare, haircare, makeup, fragrance, suncare, and grooming.
- Stay focused on beauty, routines, ingredients, usage order, and compatibility.
- If the user asks something unrelated to L'Oréal products, routines, recommendations, or beauty topics, politely refuse and redirect them to a relevant beauty question.

Critical product rules:
- Treat the selected products JSON below as the user's current product selection.
- When discussing selected products, only reference products that appear in that JSON.
- Do not invent products that were not selected.
- If the selection is incomplete for a full routine, explain what is missing instead of making products up.
- You may still answer general beauty questions, but make it clear when you are speaking generally versus referring to the selected products.

Live information rules:
- Use web search to provide current, real-world information in every on-topic response.
- Keep the answer tied to L'Oreal products, brands, routines, ingredients, usage guidance, or recent product context when possible.
- Include source-backed claims naturally in the answer.
- Cite at least one current source-backed detail whenever relevant information is available.
- Keep answers practical, polished, and easy to follow.

Routine behavior:
- If asked to build a routine, organize it clearly in the most sensible order.
- Separate morning, evening, or use-as-needed steps when relevant.
- Explain why each selected product belongs where it does.
- Mention reasonable cautions when relevant, especially for SPF, retinol, exfoliants, acne treatments, or styling products.

Current request mode: ${mode}

Selected products JSON:
${productContext}
`.trim();
}

function sanitizeProducts(products) {
  if (!Array.isArray(products)) return [];

  return products
    .map((product) => {
      if (!product || typeof product !== "object") return null;

      return {
        id: safeValue(product.id),
        brand: safeValue(product.brand),
        name: safeValue(product.name),
        category: safeValue(product.category),
        description: safeValue(product.description),
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry.role === "user" || entry.role === "assistant") &&
        typeof entry.content === "string" &&
        entry.content.trim(),
    )
    .map((entry) => ({
      role: entry.role,
      content: entry.content.trim(),
    }))
    .slice(-24);
}

function normalizeResponse(data, context = {}) {
  const text = extractText(data);
  const rawCitations = dedupeCitations([
    ...extractAnnotationCitations(data),
    ...extractWebSearchSources(data),
  ]);

  return {
    text: text || "I couldn't generate a response.",
    citations: rawCitations,
  };
}

function isBeautyRelatedMessage(message, selectedProducts, chatHistory) {
  const normalizedMessage = normalizeForMatch(message);
  if (!normalizedMessage) return false;

  if (containsSelectedProductTerm(normalizedMessage, selectedProducts)) {
    return true;
  }

  const beautyKeywords = [
    "beauty",
    "skincare",
    "skin care",
    "haircare",
    "hair care",
    "makeup",
    "fragrance",
    "perfume",
    "cologne",
    "routine",
    "cleanser",
    "serum",
    "moisturizer",
    "moisturiser",
    "sunscreen",
    "spf",
    "retinol",
    "vitamin c",
    "niacinamide",
    "hyaluronic",
    "acne",
    "pimple",
    "wrinkle",
    "anti aging",
    "anti-aging",
    "sensitive skin",
    "oily skin",
    "dry skin",
    "combination skin",
    "conditioner",
    "shampoo",
    "scalp",
    "foundation",
    "concealer",
    "mascara",
    "lipstick",
    "blush",
    "bronzer",
    "loreal",
    "l oreal",
    "l'oreal",
  ];

  if (beautyKeywords.some((keyword) => normalizedMessage.includes(keyword))) {
    return true;
  }

  return isLikelyBeautyFollowUp(
    normalizedMessage,
    selectedProducts,
    chatHistory,
  );
}

function containsSelectedProductTerm(normalizedText, selectedProducts) {
  if (!normalizedText) return false;
  if (!Array.isArray(selectedProducts) || !selectedProducts.length)
    return false;

  const productTerms = selectedProducts
    .flatMap((product) => [product?.brand, product?.name, product?.category])
    .map((value) => normalizeForMatch(value))
    .filter((value) => value && value.length >= 3);

  return productTerms.some((term) => normalizedText.includes(term));
}

function isLikelyBeautyFollowUp(
  normalizedMessage,
  selectedProducts,
  chatHistory,
) {
  if (!Array.isArray(chatHistory) || !chatHistory.length) return false;

  const wordCount = normalizedMessage.split(" ").filter(Boolean).length;
  if (wordCount > 8) return false;

  const historyText = normalizeForMatch(
    chatHistory
      .slice(-6)
      .map((entry) => entry.content)
      .join(" "),
  );

  if (!historyText) return false;

  const historyBeautySignals = [
    "skincare",
    "skin care",
    "haircare",
    "hair care",
    "makeup",
    "fragrance",
    "routine",
    "cleanser",
    "serum",
    "moisturizer",
    "sunscreen",
    "spf",
    "loreal",
    "l oreal",
    "l'oreal",
  ];

  const historyLooksBeauty =
    historyBeautySignals.some((signal) => historyText.includes(signal)) ||
    containsSelectedProductTerm(historyText, selectedProducts);

  if (!historyLooksBeauty) return false;

  const followUpSignals = [
    "what about",
    "and for",
    "can i",
    "should i",
    "how often",
    "when should",
    "is it ok",
    "same",
  ];

  const oneWordFollowUps = ["yes", "no", "ok", "thanks", "why", "how", "when"];

  return (
    followUpSignals.some((signal) => normalizedMessage.includes(signal)) ||
    oneWordFollowUps.includes(normalizedMessage)
  );
}

function pickOffTopicReply(message, chatHistory) {
  const responses = [
    "Happy to help, but I can only answer beauty questions right now, like skincare, haircare, makeup, fragrance, or L'Oreal product routines.",
    "I’m here for beauty support only. Ask me about skincare, haircare, makeup, fragrance, or building a L'Oreal routine and I’ll jump in.",
    "I can’t help with that topic, but I’d love to help with beauty. Try a question about products, routines, ingredients, or application order.",
    "That one is outside my scope, but I can definitely help with beauty questions and L'Oreal routines. What would you like to work on?",
  ];

  const normalizedMessage = normalizeForMatch(message);
  let index = 0;

  if (normalizedMessage) {
    const codeSum = normalizedMessage
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0);
    index = codeSum % responses.length;
  }

  const previousAssistantMessage = getLastAssistantMessage(chatHistory);
  if (
    previousAssistantMessage &&
    normalizeForMatch(previousAssistantMessage) ===
      normalizeForMatch(responses[index])
  ) {
    index = (index + 1) % responses.length;
  }

  return responses[index];
}

function getLastAssistantMessage(chatHistory) {
  if (!Array.isArray(chatHistory) || !chatHistory.length) return "";

  for (let i = chatHistory.length - 1; i >= 0; i -= 1) {
    const entry = chatHistory[i];
    if (entry?.role === "assistant" && typeof entry.content === "string") {
      return entry.content.trim();
    }
  }

  return "";
}

function shouldIncludeCitations(context = {}) {
  const { message = "", selectedProducts = [] } = context;
  const normalizedMessage = normalizeForMatch(message);
  if (!normalizedMessage) return false;

  const lorealTerms = ["loreal", "l'oreal", "l oreal"];
  if (lorealTerms.some((term) => normalizedMessage.includes(term))) {
    return true;
  }

  if (!Array.isArray(selectedProducts) || !selectedProducts.length) {
    return false;
  }

  const productPhrases = selectedProducts
    .flatMap((product) => [product?.brand, product?.name])
    .map((value) => normalizeForMatch(value))
    .filter((value) => value && value.length >= 3);

  return productPhrases.some((phrase) => normalizedMessage.includes(phrase));
}

function normalizeForMatch(value) {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (!Array.isArray(data.output)) return "";

  const textParts = [];

  data.output.forEach((item) => {
    if (item.type !== "message" || !Array.isArray(item.content)) return;

    item.content.forEach((part) => {
      if (part.type === "output_text" && typeof part.text === "string") {
        textParts.push(part.text);
      }
    });
  });

  return textParts.join("\n").trim();
}

function extractAnnotationCitations(data) {
  if (!Array.isArray(data.output)) return [];

  const citations = [];

  data.output.forEach((item) => {
    if (item.type !== "message" || !Array.isArray(item.content)) return;

    item.content.forEach((part) => {
      if (part.type !== "output_text" || !Array.isArray(part.annotations))
        return;

      part.annotations.forEach((annotation) => {
        if (annotation.type === "url_citation" && annotation.url) {
          citations.push({
            title: annotation.title || "",
            url: annotation.url,
          });
        }
      });
    });
  });

  return citations;
}

function extractWebSearchSources(data) {
  if (!Array.isArray(data.output)) return [];

  const sources = [];

  data.output.forEach((item) => {
    if (item.type !== "web_search_call") return;

    const actionSources = item?.action?.sources;
    if (!Array.isArray(actionSources)) return;

    actionSources.forEach((source) => {
      if (source?.url) {
        sources.push({
          title: "",
          url: source.url,
        });
      }
    });
  });

  return sources;
}

function dedupeCitations(citations) {
  const seen = new Set();
  const deduped = [];

  citations.forEach((citation) => {
    if (!citation?.url) return;

    const cleanedUrl = cleanCitationUrl(citation.url);
    if (!cleanedUrl) return;

    const normalizedUrl = normalizeCitationUrl(cleanedUrl);
    if (!normalizedUrl || seen.has(normalizedUrl)) return;

    seen.add(normalizedUrl);
    deduped.push({
      title: citation.title || "",
      url: cleanedUrl,
    });
  });

  return deduped;
}

function cleanCitationUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";

    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
    ].forEach((param) => parsed.searchParams.delete(param));

    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeCitationUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";

    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
    ].forEach((param) => parsed.searchParams.delete(param));

    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const pathname =
      parsed.pathname === "/"
        ? "/"
        : parsed.pathname.replace(/\/+$/, "").toLowerCase();
    const search = parsed.searchParams.toString();

    return `${hostname}${pathname}${search ? `?${search}` : ""}`;
  } catch {
    return String(url).trim().toLowerCase();
  }
}

function safeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}
