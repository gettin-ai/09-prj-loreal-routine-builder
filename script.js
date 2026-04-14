const WORKER_URL = "https://lorealproductselect.pixelatedmail.workers.dev/";

const LEGACY_OFF_TOPIC_RESPONSE =
  "I can only help with beauty topics like skincare, haircare, makeup, fragrance, and L'Oreal product routines. Please ask a beauty-related question.";

const FRIENDLY_OFF_TOPIC_RESPONSES = [
  "Happy to help, but I can only answer beauty questions right now, like skincare, haircare, makeup, fragrance, or L'Oreal product routines.",
  "I’m here for beauty support only. Ask me about skincare, haircare, makeup, fragrance, or building a L'Oreal routine and I’ll jump in.",
  "I can’t help with that topic, but I’d love to help with beauty. Try a question about products, routines, ingredients, or application order.",
  "That one is outside my scope, but I can definitely help with beauty questions and L'Oreal routines. What would you like to work on?",
];

const SEARCH_TERM_SYNONYMS = {
  fragrance: ["perfume", "parfum", "cologne", "scent", "eau", "mist"],
  perfume: ["fragrance", "parfum", "scent", "eau", "mist"],
  cologne: ["fragrance", "perfume", "scent", "eau"],
  scent: ["fragrance", "perfume", "cologne", "parfum"],
  makeup: ["cosmetic", "foundation", "mascara", "lipstick", "palette"],
  skincare: ["skin", "serum", "cleanser", "moisturizer", "spf", "treatment"],
  haircare: ["hair", "shampoo", "conditioner", "styling", "scalp"],
  cleanser: ["cleanse", "face wash", "wash"],
  moisturizer: ["moisturiser", "lotion", "cream", "hydrate", "hydrating"],
  moisturiser: ["moisturizer", "lotion", "cream", "hydrate", "hydrating"],
  sunscreen: ["spf", "sun", "uv", "anthelios"],
  spf: ["sunscreen", "sun", "uv"],
  acne: ["blemish", "breakout", "pimple", "salicylic", "benzoyl"],
  antiaging: ["anti aging", "wrinkle", "retinol", "firming", "fine lines"],
  "anti-aging": ["anti aging", "wrinkle", "retinol", "firming", "fine lines"],
  dry: ["hydrating", "moisturizing", "moisture", "rich", "nourishing"],
  oily: ["oil control", "matte", "shine", "non greasy"],
  sensitive: ["gentle", "soothing", "hypoallergenic", "fragrance free"],
};

const STORAGE_KEYS = {
  selectedProducts: "loreal-selected-products-v1",
};

const RTL_LANGUAGE_CODES = new Set([
  "ar",
  "arc",
  "ckb",
  "dv",
  "fa",
  "ha",
  "he",
  "khw",
  "ks",
  "ku",
  "ps",
  "sd",
  "ug",
  "ur",
  "yi",
]);

const state = {
  products: [],
  selectedIds: new Set(),
  expandedIds: new Set(),
  initialProductIds: new Set(),
  showInitialRandomSet: true,
  chatHistory: [],
  currentCategory: "all",
  searchTerm: "",
  isLoading: false,
};

const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const productsStatus = document.getElementById("productsStatus");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectionCount = document.getElementById("selectionCount");
const clearSelectionsBtn = document.getElementById("clearSelections");
const generateRoutineBtn = document.getElementById("generateRoutine");
const chatWindow = document.getElementById("chatWindow");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatStatus = document.getElementById("chatStatus");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  setupAutoDirectionSync();
  attachEventListeners();
  renderWelcomeMessage();

  try {
    const products = await loadProducts();
    state.products = products;
    state.initialProductIds = new Set(pickRandomProductIds(products, 4));
    hydrateSavedSelections();
    populateCategoryOptions(products);
    renderProducts();
    renderSelectedProducts();
  } catch (error) {
    console.error(error);
    productsStatus.textContent = "Unable to load products right now.";
    productsContainer.innerHTML = `
      <div class="placeholder-card">
        We couldn't load the product catalog. Please confirm that
        <strong>products.json</strong> is in the same project folder and try again.
      </div>
    `;
  }
}

function attachEventListeners() {
  productSearch.addEventListener("input", (event) => {
    state.showInitialRandomSet = false;
    state.searchTerm = event.target.value.trim().toLowerCase();
    renderProducts();
  });

  categoryFilter.addEventListener("change", (event) => {
    state.showInitialRandomSet = false;
    state.currentCategory = event.target.value;
    renderProducts();
  });

  productsContainer.addEventListener("click", (event) => {
    const detailsButton = event.target.closest("[data-action='details']");
    if (detailsButton) {
      event.stopPropagation();
      const productId = Number(detailsButton.dataset.productId);
      toggleDetails(productId);
      return;
    }

    const card = event.target.closest(".product-card");
    if (!card) return;

    const productId = Number(card.dataset.productId);
    toggleProductSelection(productId);
  });

  productsContainer.addEventListener("keydown", (event) => {
    const card = event.target.closest(".product-card");
    if (!card) return;

    if (event.key === "Enter" || event.key === " ") {
      if (event.target.closest("button")) return;
      event.preventDefault();
      toggleProductSelection(Number(card.dataset.productId));
    }
  });

  selectedProductsList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-id]");
    if (!removeButton) return;

    const productId = Number(removeButton.dataset.removeId);
    toggleProductSelection(productId);
  });

  clearSelectionsBtn.addEventListener("click", clearSelections);
  generateRoutineBtn.addEventListener("click", generateRoutine);

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendChatMessage();
  });
}

async function loadProducts() {
  const response = await fetch("products.json");
  if (!response.ok) {
    throw new Error("Failed to fetch products.json");
  }

  const data = await response.json();
  return Array.isArray(data.products) ? data.products : [];
}

function populateCategoryOptions(products) {
  const uniqueCategories = [
    ...new Set(products.map((product) => product.category)),
  ].sort((a, b) => a.localeCompare(b));

  categoryFilter.innerHTML = `
    <option value="all">All Categories</option>
    ${uniqueCategories
      .map(
        (category) =>
          `<option value="${escapeHtml(category)}">${escapeHtml(formatCategory(category))}</option>`,
      )
      .join("")}
  `;
}

function hydrateSavedSelections() {
  const saved = localStorage.getItem(STORAGE_KEYS.selectedProducts);
  if (!saved) return;

  try {
    const parsedIds = JSON.parse(saved);
    if (!Array.isArray(parsedIds)) return;

    const validIds = new Set(state.products.map((product) => product.id));
    parsedIds.forEach((id) => {
      if (validIds.has(id)) {
        state.selectedIds.add(id);
      }
    });
  } catch (error) {
    console.warn("Could not restore saved selections.", error);
  }
}

function saveSelections() {
  localStorage.setItem(
    STORAGE_KEYS.selectedProducts,
    JSON.stringify([...state.selectedIds]),
  );
}

function applyDirection(direction) {
  document.documentElement.dir = direction === "rtl" ? "rtl" : "ltr";
}

function setupAutoDirectionSync() {
  let previousLanguage = "";

  const syncDirection = () => {
    const detectedLanguage = detectActiveLanguage();
    if (!detectedLanguage || detectedLanguage === previousLanguage) {
      return;
    }

    previousLanguage = detectedLanguage;
    applyDirection(isRightToLeftLanguage(detectedLanguage) ? "rtl" : "ltr");
  };

  const observer = new MutationObserver(syncDirection);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang", "class", "dir"],
  });

  if (document.body) {
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["lang", "class", "dir"],
    });
  }

  const translateSelect = document.querySelector(".goog-te-combo");
  if (translateSelect) {
    translateSelect.addEventListener("change", syncDirection);
  }

  window.addEventListener("hashchange", syncDirection);

  // Google Translate can update language state without a direct DOM attribute change.
  setInterval(syncDirection, 1200);

  syncDirection();
}

function detectActiveLanguage() {
  const classDirection = detectDirectionFromTranslateClasses();
  if (classDirection === "rtl") return "ar";

  const languageCandidates = [
    getGoogleTranslateWidgetLanguage(),
    getGoogTransCookieLanguage(),
    document.documentElement.getAttribute("lang"),
    document.body?.getAttribute("lang"),
    extractLanguageFromHash(),
  ];

  for (const candidate of languageCandidates) {
    const normalizedLanguage = normalizeLanguageCode(candidate);
    if (normalizedLanguage) {
      return normalizedLanguage;
    }
  }

  return "en";
}

function detectDirectionFromTranslateClasses() {
  const classNames = [
    document.documentElement.className,
    document.body?.className || "",
  ]
    .join(" ")
    .toLowerCase();

  if (classNames.includes("translated-rtl")) {
    return "rtl";
  }

  if (classNames.includes("translated-ltr")) {
    return "ltr";
  }

  return "";
}

function getGoogleTranslateWidgetLanguage() {
  const translateSelect = document.querySelector(".goog-te-combo");
  if (!translateSelect || typeof translateSelect.value !== "string") {
    return "";
  }

  return translateSelect.value;
}

function getGoogTransCookieLanguage() {
  const rawCookies = document.cookie ? document.cookie.split(";") : [];
  const googTransCookie = rawCookies
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("googtrans="));

  if (!googTransCookie) return "";

  const value = decodeURIComponent(googTransCookie.split("=")[1] || "");
  const segments = value.split("/").filter(Boolean);

  return segments[segments.length - 1] || "";
}

function extractLanguageFromHash() {
  const match = window.location.hash.match(/googtrans\([^|]+\|([^\)]+)\)/i);
  return match ? match[1] : "";
}

function normalizeLanguageCode(languageCode) {
  if (typeof languageCode !== "string") return "";

  return languageCode.trim().toLowerCase().replace("_", "-").split("-")[0];
}

function isRightToLeftLanguage(languageCode) {
  return RTL_LANGUAGE_CODES.has(normalizeLanguageCode(languageCode));
}

function getFilteredProducts() {
  if (state.showInitialRandomSet) {
    return state.products.filter((product) =>
      state.initialProductIds.has(product.id),
    );
  }

  const termGroups = buildSearchTermGroups(state.searchTerm);

  return state.products.filter((product) => {
    const matchesCategory =
      state.currentCategory === "all" ||
      product.category === state.currentCategory;

    if (!matchesCategory) return false;

    if (!termGroups.length) return true;

    const haystack = normalizeSearchText(
      [product.name, product.brand, product.category, product.description]
        .join(" ")
        .replace(/fragrance\s*[-]?\s*free/gi, "unscented"),
    );

    // Every typed token must match the product, but each token can match via synonyms.
    return termGroups.every((group) =>
      group.some((term) => haystack.includes(term)),
    );
  });
}

function buildSearchTermGroups(rawSearchTerm) {
  const normalized = normalizeSearchText(rawSearchTerm);
  if (!normalized) return [];

  const tokens = normalized.split(" ").filter(Boolean);

  return tokens.map((token) => {
    const synonyms = SEARCH_TERM_SYNONYMS[token] || [];
    return [
      ...new Set([token, ...synonyms.map((item) => normalizeSearchText(item))]),
    ].filter(Boolean);
  });
}

function normalizeSearchText(value) {
  if (typeof value !== "string") return "";

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickRandomProductIds(products, count) {
  const ids = products.map((product) => product.id);

  for (let i = ids.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[swapIndex]] = [ids[swapIndex], ids[i]];
  }

  return ids.slice(0, count);
}

function renderProducts() {
  const filteredProducts = getFilteredProducts();
  const totalProducts = state.products.length;
  const matchCount = filteredProducts.length;

  productsStatus.textContent = `Showing ${matchCount} of ${totalProducts} products`;

  if (!filteredProducts.length) {
    productsContainer.innerHTML = `
      <div class="placeholder-card">
        No products matched that search and category combination.
        Try a different keyword or switch back to <strong>All Categories</strong>.
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = filteredProducts
    .map((product) => {
      const isSelected = state.selectedIds.has(product.id);
      const isExpanded = state.expandedIds.has(product.id);

      return `
        <article
          class="product-card ${isSelected ? "is-selected" : ""}"
          data-product-id="${product.id}"
          tabindex="0"
          aria-label="${escapeHtml(product.name)}"
        >
          <div class="product-card-top">
            <div class="product-media">
              <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" />
            </div>

            <button
              type="button"
              class="details-btn"
              data-action="details"
              data-product-id="${product.id}"
              aria-expanded="${String(isExpanded)}"
              aria-controls="product-description-${product.id}"
            >
              ${isExpanded ? "Hide details" : "Details"}
            </button>
          </div>

          <div class="product-copy">
            <p class="product-brand">${escapeHtml(product.brand)}</p>
            <h3>${escapeHtml(product.name)}</h3>
            <p class="product-meta">${escapeHtml(formatCategory(product.category))}</p>
          </div>

          <button
            type="button"
            class="select-btn ${isSelected ? "is-selected" : ""}"
            aria-label="${isSelected ? `Selected ${escapeHtml(product.name)}` : `Select ${escapeHtml(product.name)}`}"
          >
            ${
              isSelected
                ? `<i class="fa-solid fa-check"></i> Selected`
                : `Click to select`
            }
          </button>

          <div
            id="product-description-${product.id}"
            class="product-description"
            ${isExpanded ? "" : "hidden"}
          >
            ${escapeHtml(product.description)}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSelectedProducts() {
  const selectedProducts = getSelectedProducts();

  selectionCount.textContent = selectedProducts.length;
  generateRoutineBtn.disabled =
    selectedProducts.length === 0 || state.isLoading;
  clearSelectionsBtn.hidden = selectedProducts.length === 0;

  if (!selectedProducts.length) {
    selectedProductsList.innerHTML = `
      <div class="empty-state">
        Select products from the grid above. Your choices will stay saved after refresh.
      </div>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
        <div class="selection-pill">
          <div>
            <strong>${escapeHtml(product.name)}</strong><br />
            <span>${escapeHtml(product.brand)} · ${escapeHtml(
              formatCategory(product.category),
            )}</span>
          </div>

          <button
            type="button"
            data-remove-id="${product.id}"
            aria-label="Remove ${escapeHtml(product.name)}"
            title="Remove ${escapeHtml(product.name)}"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      `,
    )
    .join("");
}

function getSelectedProducts() {
  return state.products.filter((product) => state.selectedIds.has(product.id));
}

function toggleProductSelection(productId) {
  if (state.selectedIds.has(productId)) {
    state.selectedIds.delete(productId);
  } else {
    state.selectedIds.add(productId);
  }

  saveSelections();
  renderProducts();
  renderSelectedProducts();
}

function clearSelections() {
  state.selectedIds.clear();
  saveSelections();
  renderProducts();
  renderSelectedProducts();
}

function toggleDetails(productId) {
  if (state.expandedIds.has(productId)) {
    state.expandedIds.delete(productId);
  } else {
    state.expandedIds.add(productId);
  }

  renderProducts();
}

function renderWelcomeMessage() {
  appendMessage(
    "assistant",
    "Hello. I’m your L'Oréal routine advisor. Select products to build a personalized routine, then ask follow-up questions about skincare, haircare, makeup, fragrance, or how your selected products fit together.",
    { persist: false },
  );
}

async function generateRoutine() {
  const selectedProducts = getSelectedProducts();
  if (!selectedProducts.length) return;

  const prompt =
    "Create a personalized beauty routine using only the selected products. Organize the answer in a practical order, such as morning, evening, or use-as-needed when relevant. Explain where each selected product fits, how often to use it, and why it belongs there. If the selection does not make a complete routine, clearly say what is missing instead of inventing products.";

  appendMessage(
    "user",
    "Create a personalized routine from my selected products.",
  );

  const loadingMessage = appendLoadingMessage("Building your routine...");
  setBusyState(true, "Generating routine");

  try {
    const result = await callWorker({
      mode: "routine",
      message: prompt,
      selectedProducts,
      chatHistory: state.chatHistory,
    });

    loadingMessage.remove();
    appendMessage("assistant", result.text, {
      citations: result.citations,
      persist: true,
    });
  } catch (error) {
    console.error(error);
    loadingMessage.remove();
    appendMessage(
      "assistant",
      "I couldn’t generate the routine right now. Confirm your Cloudflare Worker is deployed and that OPENAI_API_KEY is set in the Worker environment.",
      { persist: false },
    );
  } finally {
    setBusyState(false, "Ready");
  }
}

async function sendChatMessage() {
  const message = userInput.value.trim();
  if (!message || state.isLoading) return;

  userInput.value = "";
  appendMessage("user", message);

  const loadingMessage = appendLoadingMessage("Thinking...");
  setBusyState(true, "Searching and replying");

  try {
    const result = await callWorker({
      mode: "chat",
      message,
      selectedProducts: getSelectedProducts(),
      chatHistory: state.chatHistory,
    });

    loadingMessage.remove();
    appendMessage("assistant", result.text, {
      citations: result.citations,
      persist: true,
    });
  } catch (error) {
    console.error(error);
    loadingMessage.remove();
    appendMessage(
      "assistant",
      "I couldn’t get a response right now. Verify the Worker endpoint is live and OPENAI_API_KEY is configured in the Worker environment.",
      { persist: false },
    );
  } finally {
    setBusyState(false, "Ready");
  }
}

async function callWorker(payload) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error || "Worker request failed.";
    throw new Error(message);
  }

  const rawText =
    typeof data.text === "string" && data.text.trim()
      ? data.text.trim()
      : "I didn’t receive a response.";

  const normalizedText = normalizeOffTopicText(rawText, payload.chatHistory);

  return {
    text: normalizedText,
    citations: Array.isArray(data.citations) ? data.citations : [],
  };
}

function normalizeOffTopicText(text, chatHistory = []) {
  if (
    normalizeForCompare(text) !== normalizeForCompare(LEGACY_OFF_TOPIC_RESPONSE)
  ) {
    return text;
  }

  const previousAssistantText = getLastAssistantMessage(chatHistory);

  const previousIndex = FRIENDLY_OFF_TOPIC_RESPONSES.findIndex(
    (responseText) =>
      normalizeForCompare(responseText) ===
      normalizeForCompare(previousAssistantText),
  );

  const nextIndex =
    previousIndex >= 0
      ? (previousIndex + 1) % FRIENDLY_OFF_TOPIC_RESPONSES.length
      : 0;

  return FRIENDLY_OFF_TOPIC_RESPONSES[nextIndex];
}

function getLastAssistantMessage(chatHistory = []) {
  if (!Array.isArray(chatHistory)) return "";

  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const entry = chatHistory[index];
    if (entry?.role === "assistant" && typeof entry.content === "string") {
      return entry.content.trim();
    }
  }

  return "";
}

function normalizeForCompare(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function setBusyState(isBusy, label) {
  state.isLoading = isBusy;
  chatStatus.textContent = label;
  chatStatus.classList.toggle("is-busy", isBusy);

  generateRoutineBtn.disabled = getSelectedProducts().length === 0 || isBusy;
  sendBtn.disabled = isBusy;
  userInput.disabled = isBusy;
}

function appendLoadingMessage(text) {
  const row = document.createElement("div");
  row.className = "message-row assistant";

  row.innerHTML = `
    <div class="message-label">Advisor</div>
    <div class="message-bubble is-loading">${escapeHtml(text)}</div>
  `;

  chatWindow.appendChild(row);
  scrollChatToBottom();
  return row;
}

function appendMessage(role, text, options = {}) {
  const { persist = true } = options;

  if (persist) {
    state.chatHistory.push({
      role,
      content: text,
    });
  }

  const row = document.createElement("div");
  row.className = `message-row ${role === "user" ? "user" : "assistant"}`;

  const label = role === "user" ? "You" : "Advisor";

  row.innerHTML = `
    <div class="message-label">${label}</div>
    <div class="message-bubble">${formatMessageText(text)}</div>
  `;

  chatWindow.appendChild(row);
  scrollChatToBottom();
}

function scrollChatToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function formatCategory(category) {
  const specialLabels = {
    skincare: "Skincare & Treatments",
    haircare: "Haircare",
    cleanser: "Cleansers",
    moisturizer: "Moisturizers",
    makeup: "Makeup",
    fragrance: "Fragrance",
    suncare: "Suncare",
    "hair color": "Hair Color",
    "hair styling": "Hair Styling",
    "men's grooming": "Men's Grooming",
  };

  return specialLabels[category] || toTitleCase(category);
}

function toTitleCase(text) {
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMessageText(text) {
  return normalizeCitationPunctuation(linkifyText(escapeHtml(text)))
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function linkifyText(escapedText) {
  const seenLinks = new Set();

  const withMarkdownLinks = escapedText.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s<]+)\)/gi,
    (fullMatch, label, rawUrl) => {
      const { cleanUrl } = splitTrailingUrlText(rawUrl, "");
      const safeUrl = sanitizeHttpUrl(cleanUrl);
      if (!safeUrl) return label;

      const normalizedUrl = normalizeInlineUrl(safeUrl);
      if (!normalizedUrl || seenLinks.has(normalizedUrl)) {
        return "";
      }

      seenLinks.add(normalizedUrl);
      const displayLabel = formatCompactLinkLabel(safeUrl, label);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayLabel)}</a>`;
    },
  );

  const urlPattern = /(https?:\/\/[^\s<]+)/gi;

  const withRawLinks = withMarkdownLinks.replace(
    urlPattern,
    (rawUrl, offset, sourceText) => {
      const previousChar =
        typeof offset === "number" && offset > 0 ? sourceText[offset - 1] : "";

      const { cleanUrl, trailingText } = splitTrailingUrlText(
        rawUrl,
        previousChar,
      );

      const safeUrl = sanitizeHttpUrl(cleanUrl);
      if (!safeUrl) return rawUrl;

      const normalizedUrl = normalizeInlineUrl(safeUrl);
      if (!normalizedUrl || seenLinks.has(normalizedUrl)) {
        return trailingText;
      }

      seenLinks.add(normalizedUrl);

      const linkLabel = formatCompactLinkLabel(safeUrl);

      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>${trailingText}`;
    },
  );

  return withRawLinks;
}

function normalizeCitationPunctuation(text) {
  return text
    .replace(/\[\s*(<a\b[^>]*>[^<]*<\/a>)\s*\]/gi, "$1")
    .replace(/\(\s*(<a\b[^>]*>[^<]*<\/a>)\s*\)\)+/gi, "($1)")
    .replace(/\(\s*(<a\b[^>]*>[^<]*<\/a>)(?!\s*\))/gi, "($1)")
    .replace(/\(\s*(?=\n|$)/g, "")
    .replace(/\(\s*(?=<br>|$)/g, "");
}

function formatCompactLinkLabel(url, fallbackLabel = "") {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return hostname || fallbackLabel || url;
  } catch {
    return fallbackLabel || url;
  }
}

function normalizeInlineUrl(url) {
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
    return "";
  }
}

function splitTrailingUrlText(url, previousChar = "") {
  const punctuation = new Set([")", "]", "}", ".", ",", ";", ":", "!", "?"]);
  let cleanUrl = url;
  let trailingText = "";

  while (cleanUrl.length) {
    const lastChar = cleanUrl[cleanUrl.length - 1];
    if (!punctuation.has(lastChar)) break;

    if (lastChar === ")") {
      const openCount = (cleanUrl.match(/\(/g) || []).length;
      const closeCount = (cleanUrl.match(/\)/g) || []).length;
      if (closeCount <= openCount) break;
    }

    trailingText = `${lastChar}${trailingText}`;
    cleanUrl = cleanUrl.slice(0, -1);
  }

  return { cleanUrl, trailingText };
}

function sanitizeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
