const TRPC_BASE = "https://gateway.warerastats.io/trpc";
const EVENTS_METHOD = "event.getEventsPaginated";
const ARTICLES_METHOD = "article.getArticlesPaginated";

const EVENT_TYPES = [
  "warDeclared",
  "peace_agreement",
  "battleOpened",
  "battleEnded",
  "newPresident",
  "regionTransfer",
  "peaceMade",
  "countryMoneyTransfer",
  "depositDiscovered",
  // "depositDepleted",
  "systemRevolt",
  "bankruptcy",
  "allianceFormed",
  "allianceBroken",
  "regionLiberated",
  "strategicResourcesReshuffled",
  "resistanceIncreased",
  "resistanceDecreased",
  "revolutionStarted",
  "revolutionEnded",
  "financedRevolt",
];

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const state = {
  cursor: null,
  events: [],
  articleCursor: null,
  articles: [],
  isLoading: false,
  lastFilters: {},
  filterTimer: null,
  lookups: {
    countriesById: new Map(),
    countryIdsByName: new Map(),
    regionsById: new Map(),
    battlesById: new Map(),
	usersById: new Map(),
  },
  lookupsReadyForKey: "",
  autoRefreshTimer: null,
};

const STORAGE_KEYS = {
  apiKey: "war-era-news-desk-api-key",
  theme: "war-era-news-desk-theme",
};

const elements = {
  apiKeyInput: document.querySelector("#apiKeyInput"),
  applyFiltersButton: document.querySelector("#applyFiltersButton"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  countryInput: document.querySelector("#countryInput"),
  countryOptions: document.querySelector("#countryOptions"),
  endTimeInput: document.querySelector("#endTimeInput"),
  eventList: document.querySelector("#eventList"),
  eventTypeSelect: document.querySelector("#eventTypeSelect"),
  feedMeta: document.querySelector("#feedMeta"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  refreshButton: document.querySelector("#refreshButton"),
  startTimeInput: document.querySelector("#startTimeInput"),
  statusBox: document.querySelector("#statusBox"),
  template: document.querySelector("#eventCardTemplate"),
  themeButton: document.querySelector("#themeButton"),
  apiButton: document.getElementById("apiButton"),
  apiKeyModal: document.getElementById("apiKeyModal"),
  saveApiKeyButton: document.getElementById("saveApiKeyButton"),
  articleList: document.querySelector("#articleList"),
  articleFeedMeta: document.querySelector("#articleFeedMeta"),
  articleStatusBox: document.querySelector("#articleStatusBox"),
  loadMoreArticlesButton:document.querySelector("#loadMoreArticlesButton"),
  articleSearch: document.querySelector("#articleSearch"),
  articleTemplate: document.querySelector("#articleCardTemplate"),
  readerModal: document.querySelector("#articleReaderModal"),
  readerTitle: document.querySelector("#readerTitle"),
  readerAuthor: document.querySelector("#readerAuthor"),
  readerContent: document.querySelector("#readerContent"),
  closeReader: document.querySelector("#closeReader"),
};

function init() {
  elements.apiKeyInput.value = localStorage.getItem(STORAGE_KEYS.apiKey) || "";
  applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || "light");
  populateEventTypes();
  bindEvents();

  if (elements.apiKeyInput.value.trim()) {
	  
	document.getElementById("globalEventsTitle")
    ?.classList.add("live");

  loadEvents({
    reset: true,
  });

  loadArticles(true);
  startAutoRefresh();

} else {

  elements.apiButton.classList.add("needs-attention");

  setStatus("Enter your War Era API key to start the live timeline.");

}
}

function populateEventTypes() {
  const fragment = document.createDocumentFragment();

  for (const eventType of EVENT_TYPES) {
    const option = document.createElement("option");
    option.value = eventType;
    option.textContent = formatEventType(eventType);
    fragment.append(option);
  }

  elements.eventTypeSelect.append(fragment);
}

function bindEvents() {
  elements.applyFiltersButton.addEventListener("click", () => loadEvents({ reset: true }));
  elements.refreshButton.addEventListener("click", () => loadEvents({ reset: true }) && loadArticles(reset = true));
  elements.loadMoreButton.addEventListener("click", () => loadEvents({ reset: false }));
  elements.themeButton.addEventListener("click", toggleTheme);
  elements.eventList.addEventListener("click", handleTimelineAction);

  elements.countryInput.addEventListener("input", scheduleCountryRefresh);
  elements.countryInput.addEventListener("change", scheduleCountryRefresh);
  elements.eventTypeSelect.addEventListener("change", scheduleServerRefresh);
  elements.startTimeInput.addEventListener("change", renderTimeline);
  elements.endTimeInput.addEventListener("change", renderTimeline);

  elements.clearFiltersButton.addEventListener("click", () => {
    elements.countryInput.value = "";
    elements.eventTypeSelect.value = "";
    elements.startTimeInput.value = "";
    elements.endTimeInput.value = "";
    loadEvents({ reset: true });
  });
  
 elements.apiButton.addEventListener("click", () => {

  elements.apiKeyInput.value =
    localStorage.getItem(STORAGE_KEYS.apiKey) || "";

  elements.apiKeyModal.classList.remove("hidden");

  elements.apiKeyInput.focus();

});
  
  elements.saveApiKeyButton.addEventListener("click", () => {

  const apiKey = elements.apiKeyInput.value.trim();

  localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);

  elements.apiButton.classList.remove("needs-attention");
  
  document.getElementById("globalEventsTitle")
  ?.classList.add("live");
  
  elements.apiKeyModal.classList.add("hidden");

if (apiKey) {

    loadEvents({
        reset: true,
    });

    loadArticles(true);
	startAutoRefresh();

}

});
	
	elements.apiKeyModal.addEventListener("click", (event) => {

  if (event.target === elements.apiKeyModal) {

    elements.apiKeyModal.classList.add("hidden");

  }

});

document.addEventListener("keydown", (event) => {

  if (event.key === "Escape") {

    elements.apiKeyModal.classList.add("hidden");

  }

});

for (const [key, value] of Object.entries(elements)) {
    if (value === null) {
        console.log("NULL:", key);
    }
}

elements.closeReader.addEventListener("click", () => {
    elements.readerModal.classList.add("hidden");
});

elements.readerModal.addEventListener("click", (e) => {
    if (e.target === elements.readerModal) {
        elements.readerModal.classList.add("hidden");
    }
});

elements.loadMoreArticlesButton.addEventListener("click", () => {
    loadArticles(false);
});


elements.articleSearch.addEventListener("input", () => {
    renderArticles();
});

}

function scheduleServerRefresh() {
  window.clearTimeout(state.filterTimer);
  state.filterTimer = window.setTimeout(() => loadEvents({ reset: true }), 350);
}

function scheduleCountryRefresh() {
  const country = elements.countryInput.value.trim();
  if (country && !resolveCountryId(country)) return;
  scheduleServerRefresh();
}

let limitter = 0;

function startAutoRefresh() {
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
  }

  state.autoRefreshTimer = setInterval(() => {
  if (state.isLoading) return;

  const apiKey = elements.apiKeyInput.value.trim();
  if (!apiKey) return;
  
  refreshEvents();

  if (limitter < 10){
	  limitter++;
	  loadArticles(false);
  }else{
	  limitter = 100;
  }

}, 5000);
}

async function refreshEvents() {

    const apiKey =
        elements.apiKeyInput.value.trim();

    if (!apiKey) return;

    const result = await fetchTrpc(
        EVENTS_METHOD,
        {
            ...state.lastFilters,
            limit: 20
        },
        apiKey
    );

    const newestEvents =
        normalizeEvents(result);

    if (!newestEvents.length) return;

    const existingIds =
        new Set(
            state.events.map(
                e => e._id || e.id
            )
        );

    const fresh =
        newestEvents.filter(
            e =>
                !existingIds.has(
                    e._id || e.id
                )
        );

    if (!fresh.length) return;

    state.events = [
        ...fresh,
        ...state.events
    ];

    renderTimeline();
	loadArticles(true);
	limitter = 0
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalizedTheme;
  localStorage.setItem(STORAGE_KEYS.theme, normalizedTheme);
  elements.themeButton.textContent = normalizedTheme === "dark" ? "Light" : "Dark";
  elements.themeButton.setAttribute("aria-label", `Switch to ${normalizedTheme === "dark" ? "light" : "dark"} theme`);
}

function getFilters() {
    const countryId = resolveCountryId(
        elements.countryInput.value.trim()
    );

    return {
        limit: 50,
        countryId: countryId || undefined,
        eventTypes: elements.eventTypeSelect.value
            ? [elements.eventTypeSelect.value]
            : undefined
    };
}

function resolveCountryId(value) {
  if (!value) return "";
  if (OBJECT_ID_PATTERN.test(value)) return value;
  return state.lookups.countryIdsByName.get(normalizeNameKey(value)) || "";
}

async function loadEvents({ reset }) {
  if (state.isLoading) return;

  const apiKey = elements.apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus("Enter your War Era API key before loading events.", "error");
    return;
  }

  localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);

  state.isLoading = true;
  setStatus(reset ? "Loading timeline..." : "Loading more events...");
  setControlsDisabled(true);

  if (reset) {
    state.cursor = null;
    state.events = [];
    elements.eventList.textContent = "";
  }

  try {
    await ensureLookups(apiKey);

    if (reset) {
      state.lastFilters = getFilters();
    }

    const payload = {
      ...state.lastFilters,
      cursor: reset ? undefined : state.cursor,
    };

    const result = await fetchTrpc(EVENTS_METHOD, payload, apiKey);
    const events = normalizeEvents(result);
    state.cursor = normalizeCursor(result);
    state.events = reset ? events : [...state.events, ...events];

    await resolveBattlesForEvents(events, apiKey);
	await resolveUsersForEvents(events, apiKey);
    renderTimeline();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Could not load events.", "error");
  } finally {
    state.isLoading = false;
    setControlsDisabled(false);
  }
}

async function loadArticles(reset = true) {

    const apiKey = elements.apiKeyInput.value.trim();

    if (!apiKey) return;

    if (reset) {
        state.articleCursor = null;
        state.articles = [];
    }

    const payload = {
    limit: 100,
    cursor: reset ? undefined : state.articleCursor
};

    const result = await fetchTrpc(
        ARTICLES_METHOD,
        payload,
        apiKey
    );

    const data = unwrapTrpcResult(result);

    const items = data.items || [];
	await resolveUsersForArticles(items, apiKey);
    state.articleCursor = data.nextCursor || null;

    state.articles = reset
        ? items
        : [...state.articles, ...items];

    renderArticles();
}

async function resolveUsersForArticles(articles, apiKey) {
  const userIds = [
    ...new Set(
      articles
        .map(article => article.author)
        .filter(Boolean)
    )
  ].filter(id => !state.lookups.usersById.has(id));

  if (userIds.length === 0) return;

  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const result = await fetchTrpc(
          "user.getUserLite",
          { userId },
          apiKey
        );

        const user = unwrapTrpcResult(result);

        if (user) {
          state.lookups.usersById.set(userId, user);
        }
      } catch (e) {
        console.warn("Failed resolving article author", userId);
        state.lookups.usersById.set(userId, null);
      }
    })
  );
}

async function ensureLookups(apiKey) {
  if (state.lookupsReadyForKey === apiKey) return;

  setStatus("Loading names for countries and regions...");

  const [countriesResult, regionsResult] = await Promise.all([
    fetchTrpc("country.getAllCountries", {}, apiKey),
    fetchTrpc("region.getRegionsObject", {}, apiKey),
  ]);

  const countries = unwrapTrpcResult(countriesResult);
  const regions = unwrapTrpcResult(regionsResult);

  state.lookups.countriesById.clear();
  state.lookups.countryIdsByName.clear();
  state.lookups.regionsById.clear();
  state.lookups.battlesById.clear();

  if (Array.isArray(countries)) {
    for (const country of countries) {
      const id = country._id || country.id;
      if (!id) continue;
      state.lookups.countriesById.set(id, country);
      state.lookups.countryIdsByName.set(normalizeNameKey(country.name), id);
      if (country.code) {
        state.lookups.countryIdsByName.set(normalizeNameKey(country.code), id);
      }
    }
  }

  if (regions && typeof regions === "object") {
    for (const [id, region] of Object.entries(regions)) {
      state.lookups.regionsById.set(id, region);
    }
  }

  populateCountryOptions();
  state.lookupsReadyForKey = apiKey;
}

function populateCountryOptions() {
  const fragment = document.createDocumentFragment();
  const countries = [...state.lookups.countriesById.values()]
    .filter((country) => country.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const country of countries) {
    const option = document.createElement("option");
    option.value = country.name;
    if (country.code) option.label = country.code.toUpperCase();
    fragment.append(option);
  }

  elements.countryOptions.textContent = "";
  elements.countryOptions.append(fragment);
}

async function resolveBattlesForEvents(events, apiKey) {
  const battleIds = [...new Set(events.map(getBattleId).filter(Boolean))]
    .filter((battleId) => !state.lookups.battlesById.has(battleId));

  if (battleIds.length === 0) return;

  await Promise.all(battleIds.map(async (battleId) => {
    try {
      const result = await fetchTrpc("battle.getById", { battleId }, apiKey);
      const battle = unwrapTrpcResult(result);
      if (battle && typeof battle === "object") {
        state.lookups.battlesById.set(battleId, battle);
      }
    } catch (error) {
      console.warn("Could not resolve battle", battleId, error);
      state.lookups.battlesById.set(battleId, null);
    }
  }));
}

async function resolveUsersForEvents(events, apiKey) {
  const userIds = [
    ...new Set(
      events
        .map((event) => {
          const data = getEventData(event);
          return data.user;
        })
        .filter(Boolean)
    ),
  ].filter((id) => !state.lookups.usersById.has(id));

  if (userIds.length === 0) return;

  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const result = await fetchTrpc(
          "user.getUserLite",
          { userId },
          apiKey
        );

        const user = unwrapTrpcResult(result);

        if (user && typeof user === "object") {
          state.lookups.usersById.set(userId, user);
        }
      } catch (err) {
        console.warn("Could not resolve user", userId, err);
        state.lookups.usersById.set(userId, null);
      }
    })
  );
}

async function fetchTrpc(method, input, apiKey) {
  const url = `${TRPC_BASE}/${method}?input=${encodeURIComponent(JSON.stringify(removeUndefined(input)))}`;
  return fetchJson(url, { headers: { "x-api-key": apiKey } });
}

async function fetchJson(url, options) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    if (location.protocol === "file:") {
      throw new Error("The gateway blocks file pages. Serve this folder over http://localhost, then open that local URL.");
    }

    throw error;
  }

  const text = await response.text();

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Gateway returned 401: check that your War Era API key is entered correctly.");
    }

    throw new Error(`Gateway returned ${response.status}: ${text.slice(0, 180)}`);
  }

  if (!text) return null;

  const json = JSON.parse(text);
  if (json?.error?.message) {
    throw new Error(json.error.message);
  }

  return json;
}

function normalizeEvents(result) {
  const data = unwrapTrpcResult(result);

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.data)) return data.data;

  return [];
}

function normalizeCursor(result) {
  const data = unwrapTrpcResult(result);
  return data?.nextCursor || data?.cursor || data?.next || null;
}

function unwrapTrpcResult(result) {
  if (Array.isArray(result)) {
    return result[0]?.result?.data?.json ?? result[0]?.result?.data ?? result[0]?.json ?? result[0];
  }

  return result?.result?.data?.json ?? result?.result?.data ?? result?.json ?? result;
}

function renderTimeline() {
  const visibleEvents = filterEventsByTime(state.events);
  elements.eventList.textContent = "";

  if (visibleEvents.length === 0) {
    elements.loadMoreButton.hidden = !state.cursor;
    elements.feedMeta.textContent = `${state.events.length} event${state.events.length === 1 ? "" : "s"} loaded.`;
    setStatus(state.events.length === 0 ? "No events found for the current filters." : "No loaded events match the selected time range.");
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const event of visibleEvents) {
    fragment.append(renderEventCard(event));
  }

  elements.eventList.append(fragment);
  elements.loadMoreButton.hidden = !state.cursor;
  elements.feedMeta.textContent = `${visibleEvents.length} shown from ${state.events.length} loaded event${state.events.length === 1 ? "" : "s"}.`;
  clearStatus();
}

function renderArticles() {

    const keyword =
        elements.articleSearch.value
            .trim()
            .toLowerCase();

    let articles = state.articles;

    if (keyword) {

        articles = articles.filter(article => {

            return (
                article.title?.toLowerCase().includes(keyword)
                ||
                article.content?.toLowerCase().includes(keyword)
            );

        });

    }

    elements.articleList.innerHTML = "";

    for (const article of articles) {

    const node =
        elements.articleTemplate.content
            .firstElementChild
            .cloneNode(true);

    node.querySelector(".article-category").textContent =
        article.category || "Unknown";

    node.querySelector(".article-title").textContent =
        article.title || "Untitled";
		
	const authorName =
    nameUser(article.author) || "Unknown Author";

    node.querySelector(".article-meta").textContent =
    `${authorName} • ${article.language || "?"} • ${formatDate(article.createdAt)}`;

    node.querySelector(".article-stats").textContent =
        `Score: ${article.score || 0}`;

    node.querySelector(".article-open")
        .addEventListener("click", () => {

            window.open(
                `https://app.warera.io/article/${article._id}`,
                "_blank"
            );

        });
	

    const readButton = node.querySelector(".article-read");

readButton.addEventListener("click", () => {
	
	const authorName =
    nameUser(article.author) || "Unknown Author";

    elements.readerTitle.textContent =
        article.title || "Untitled";
		
	elements.readerAuthor.textContent =
        `By ${authorName}`;
		
    elements.readerContent.innerHTML =
        article.content || "<p>No content.</p>";

    // Semua link dibuka di tab baru
    elements.readerContent.querySelectorAll("a").forEach(link => {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    });

    // Buat iframe (misalnya YouTube) responsif
    elements.readerContent.querySelectorAll("iframe").forEach(frame => {
        frame.style.width = "100%";
        frame.style.maxWidth = "100%";
        frame.style.aspectRatio = "16 / 9";
        frame.style.height = "auto";
    });

    elements.readerModal.classList.remove("hidden");

});

    elements.articleList.append(node);
}

	if (limitter < 10) {
		elements.articleFeedMeta.textContent =
        `indexing....`;
		elements.articleFeedMeta.classList.remove("loadedPulse");
		elements.articleFeedMeta.classList.add("indexing");
	}else{
		elements.articleFeedMeta.textContent =
        `${articles.length} articles loaded`;
		elements.articleFeedMeta.classList.remove("indexing");

		/* restart animation */
		elements.articleFeedMeta.classList.remove("loadedPulse");

		void elements.articleFeedMeta.offsetWidth;

		elements.articleFeedMeta.classList.add("loadedPulse");
		elements.articleFeedMeta.addEventListener(
			"animationend",
			() => {
			elements.articleFeedMeta.classList.remove("loadedPulse");
			},
			{ once: true }
		);
	}
    
    elements.loadMoreArticlesButton.hidden =
        !state.articleCursor;

}

function filterEventsByTime(events) {
  const start = parseLocalDateTime(elements.startTimeInput.value);
  const end = parseLocalDateTime(elements.endTimeInput.value);

  return events.filter((event) => {
    const timestamp = getEventTimestamp(event);
    if (!timestamp) return !start && !end;

    const time = new Date(timestamp).getTime();
    if (Number.isNaN(time)) return !start && !end;
    if (start && time < start.getTime()) return false;
    if (end && time > end.getTime()) return false;
    return true;
  });
}

function renderEventCard(event) {
  const node = elements.template.content.firstElementChild.cloneNode(true);
  const eventData = getEventData(event);
  const eventType = event.type || event.eventType || eventData.type || event.name || "event";
  const timestamp = getEventTimestamp(event);
  const eventLink = getWarEraLink(event, eventData);

  node.querySelector(".event-type").textContent = formatEventType(eventType);
  node.querySelector(".event-title").textContent = buildEventTitle(event, eventType, eventData);
  node.querySelector(".event-summary").textContent = buildEventSummary(event, eventData);
  node.querySelector(".event-write-button").dataset.eventId = event._id || event.id || "";

  const linkElement = node.querySelector(".event-link");
  if (eventLink) {
    linkElement.href = eventLink;
  } else {
    linkElement.hidden = true;
  }

  const timeElement = node.querySelector(".event-time");
  timeElement.textContent = formatDate(timestamp);
  const parsedTime = timestamp ? new Date(timestamp) : null;
  if (parsedTime && !Number.isNaN(parsedTime.getTime())) {
    timeElement.dateTime = parsedTime.toISOString();
  }

  const details = node.querySelector(".event-details");
  const detailItems = buildDetails(event, eventData);

  for (const item of detailItems) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = item.label;
    value.textContent = item.value;
    row.append(term, value);
    details.append(row);
  }
  
  console.log(
  JSON.stringify(event, null, 2)
);

  return node;
}

async function handleTimelineAction(event) {
  const button = event.target.closest(".event-write-button");
  if (!button) return;

  const eventId = button.dataset.eventId;

  const timelineEvent = state.events.find(
    (item) => (item._id || item.id) === eventId
  );

  if (!timelineEvent) return;

  const news =
    buildArticleSeed(timelineEvent);

await navigator.clipboard.writeText(news);

setStatus("News brief copied.");

setTimeout(() => {
    clearStatus();
}, 3000);
}

function getEventData(event) {
  return event.data && typeof event.data === "object" ? event.data : {};
}

function getEventTimestamp(event) {
  return event.createdAt || event.date || event.time || event.timestamp;
}

function getBattleId(event) {
  const eventData = getEventData(event);
  return event.battleId || event.battle?.id || eventData.battle || "";
}

function buildEventTitle(event, eventType, eventData) {
  if (event.title) return event.title;
  if (event.message) return event.message;
  if (event.description) return event.description;

  if (eventType === "countryMoneyTransfer") {
    const [from, to] = collectCountryIds(event, eventData).map(nameCountry);
    if (from && to) return `${from} transferred ${formatMoney(eventData.money)} to ${to}`;
  }

  if (eventType === "allianceFormed") {
    const [first, second] = collectCountryIds(event, eventData).map(nameCountry);
    if (first && second) return `${first} formed an alliance with ${second}`;
  }

  if (eventType === "allianceBroken") {
    const [first, second] = collectCountryIds(event, eventData).map(nameCountry);
    if (first && second) return `${first} broke its alliance with ${second}`;
  }

  if (eventType === "warDeclared") {
    const attacker = nameCountry(eventData.attackerCountry);
    const defender = nameCountry(eventData.defenderCountry);
    if (attacker && defender) return `${attacker} declared war on ${defender}`;
  }

  if (eventType === "battleOpened") {
    const attacker = nameCountry(eventData.attackerCountry);
    const defender = nameCountry(eventData.defenderCountry);
    const region = nameRegion(eventData.defenderRegion);
    if (attacker && defender && region) return `${attacker} opened a battle against ${defender} in ${region}`;
    if (attacker && defender) return `${attacker} opened a battle against ${defender}`;
  }

  if (eventType === "battleEnded") {
    const winner = eventData.wonBy === "attacker" ? nameCountry(eventData.attackerCountry) : nameCountry(eventData.defenderCountry);
    const loser = eventData.wonBy === "attacker" ? nameCountry(eventData.defenderCountry) : nameCountry(eventData.attackerCountry);
    const region = nameRegion(eventData.defenderRegion || eventData.attackerRegion);
    if (winner && loser && region) return `${winner} defeated ${loser} in ${region}`;
    if (winner && loser) return `${winner} defeated ${loser}`;
  }
  
  if (eventType === "newPresident") {
  const country = nameCountry(eventData.country);
  const president = nameUser(eventData.user);

  if (president && country) {
    return `${president} elected president of ${country}`;
  }

  if (country) {
    return `New president elected in ${country}`;
  }
}

if (eventType === "regionTransfer") {
  const [from, to] = collectCountryIds(event, eventData).map(nameCountry);

  const region =
    nameRegion(eventData.region) ||
    nameRegion(eventData.regionId);

  if (from && to && region) {
    return `${from} transferred ${region} to ${to}`;
  }

  if (from && to) {
    return `${from} transferred a region to ${to}`;
  }
}

if (eventType === "allianceMemberJoined") {
    const country = nameCountry(eventData.country);
    const alliance = eventData.allianceName;

    if (country && alliance) {
        return `${country} joined ${alliance}`;
    }

    if (country) {
        return `${country} joined an alliance`;
    }

    return `${country} has joined ${alliance}`;
}

if (eventType === "defensivePactFormed") {
  const countries = collectCountryIds(event, eventData).map(nameCountry);
  const [countryA, countryB] = countries;

  if (countryA && countryB) {
    return `${countryA} signed defensive pact with ${countryB}`;
  }

  return "Defensive pact signed";
}

if (eventType === "depositDiscovered") {
  const resource = eventData.itemCode || "resource";
  const region =
    nameRegion(eventData.region) ||
    nameRegion(eventData.regionId);

  if (region) {
    return `${resource} deposit discovered in ${region}`;
  }

  return `${resource} deposit discovered`;
}

if (eventType === "depositDepleted") {
  const resource = eventData.itemCode || "resource";
  const region =
    nameRegion(eventData.region) ||
    nameRegion(eventData.regionId);

  if (region) {
    return `${resource} deposit depleted in ${region}`;
  }

  return `${resource} deposit depleted`;
}

if (eventType === "systemRevolt") {
  const region =
    nameRegion(eventData.region) ||
    nameRegion(eventData.regionId);

  if (region) {
    return `Revolt erupted in ${region}`;
  }

  return "Automatic revolt started";
}

if (eventType === "regionLiberated") {
  const countries = collectCountryIds(event, eventData).map(nameCountry);

  const liberator = countries[0];
  const recipient = countries[1];

  const region =
    nameRegion(eventData.regionId) ||
    nameRegion(eventData.region);

  if (liberator && recipient && region) {
    return `${liberator} liberated ${region} for ${recipient}`;
  }

  return "Region liberated";
}

if (eventType === "revolutionStarted") {

  const country =
    nameCountry(eventData.countryId) ||
    nameCountry(eventData.country);

  if (country) {
    return `Revolution started in ${country}`;
  }

  return "Revolution started";
}

if (eventType === "revolutionEnded") {

  const country =
    nameCountry(eventData.countryId) ||
    nameCountry(eventData.country);

  if (country) {
    return `The revolution in ${country} has ended`;
  }

  return "Revolution ended";
}

if (eventType === "financedRevolt") {

  const region =
    nameRegion(eventData.regionId);

  const occupier =
    nameCountry(eventData.occupyingCountryId);

  const revolting =
    nameCountry(eventData.revoltingCountryId);

  if (region && occupier && revolting) {
    return `Revolt financed in ${region}`;
  }

  return "Financed revolt";
}

  if (eventType === "peaceMade") {
    const countryNames = collectCountryIds(event, eventData).map(nameCountry).filter(Boolean);
    if (countryNames.length > 0) return `${uniqueValues(countryNames).join(" and ")} made peace`;
  }

  const battleId = getBattleId(event);
  if (battleId) {
    const battleName = formatBattleName(battleId);
    if (battleName) return `${formatEventType(eventType)}: ${battleName}`;
  }

  const regionName = nameRegion(eventData.region || eventData.defenderRegion);
  if (regionName) return `${formatEventType(eventType)}: ${regionName}`;

  return formatEventType(eventType);
}

const __pickMemory = new Map();

function pick(...choices) {

  if (choices.length <= 1) {
    return choices[0] ?? "";
  }

  const key = choices.join("||");

  const last = __pickMemory.get(key);

  const available =
    choices.filter(item => item !== last);

  const chosen =
    available[
      Math.floor(Math.random() * available.length)
    ];

  __pickMemory.set(key, chosen);

  return chosen;

}

function buildEventSummary(event, eventData) {
  const eventType =
    event.type ||
    event.eventType ||
    eventData.type ||
    event.name ||
    "event";

  const countryNames =
    collectCountryIds(event, eventData)
      .map(nameCountry)
      .filter(Boolean);

  const regionName =
    nameRegion(
      eventData.region ||
      eventData.defenderRegion
    );

  if (eventType === "countryMoneyTransfer") {

    const [from, to] =
      collectCountryIds(event, eventData)
        .map(nameCountry);

    if (from && to) {

      return pick(

        `${from} has transferred ${formatMoney(eventData.money)} in funds to ${to}.`,

        `Financial records indicate a transfer of ${formatMoney(eventData.money)} from ${from} to ${to}.`,

        `${formatMoney(eventData.money)} has reportedly been transferred from ${from} to ${to}.`,

        `Authorities have confirmed a financial transfer worth ${formatMoney(eventData.money)} from ${from} to ${to}.`

      );

    }

  }

  if (
    eventType === "allianceFormed" ||
    eventType === "allianceBroken"
  ) {

    const [first, second] =
      collectCountryIds(event, eventData)
        .map(nameCountry);

    const allianceName =
      eventData.allianceName ||
      eventData.alliance?.name ||
      eventData.alliance;

    if (
      first &&
      second &&
      allianceName
    ) {

      if (eventType === "allianceFormed") {

        return pick(

          `${first} and ${second} have formally joined the ${allianceName} alliance.`,

          `A new diplomatic chapter has begun as ${first} and ${second} officially enter the ${allianceName} alliance.`,

          `${first} and ${second} have announced their participation in the ${allianceName} alliance.`,

          `Officials confirmed that ${first} and ${second} are now members of the ${allianceName} alliance.`

        );

      }

      return pick(

        `${first} and ${second} have withdrawn from the ${allianceName} alliance.`,

        `${first} and ${second} have officially left the ${allianceName} alliance.`,

        `The partnership between ${first} and ${second} inside the ${allianceName} alliance has come to an end.`,

        `Officials confirmed the departure of ${first} and ${second} from the ${allianceName} alliance.`

      );

    }

    if (first && second) {

      if (eventType === "allianceFormed") {

        return pick(

          `${first} and ${second} have entered into a formal alliance.`,

          `Diplomatic negotiations have resulted in an alliance between ${first} and ${second}.`,

          `${first} and ${second} have announced a new strategic partnership.`

        );

      }

      return pick(

        `The alliance between ${first} and ${second} has officially come to an end.`,

        `${first} and ${second} are no longer formally allied.`,

        `Diplomatic ties between ${first} and ${second} have been dissolved.`

      );

    }

  }

  if (eventType === "battleOpened") {

  const attacker =
    nameCountry(eventData.attackerCountry);

  const defender =
    nameCountry(eventData.defenderCountry);

  const attackerRegion =
    nameRegion(eventData.attackerRegion);

  const defenderRegion =
    nameRegion(eventData.defenderRegion);

  if (
    attacker &&
    defender &&
    attackerRegion &&
    defenderRegion
  ) {

    return pick(

      `${attacker} has launched a military offensive from ${attackerRegion} against ${defender}'s position in ${defenderRegion}.`,

      `Armed conflict has broken out as forces from ${attacker} begin operations against ${defender} near ${defenderRegion}.`,

      `Military operations are now underway after ${attacker} opened a new offensive targeting ${defender} in ${defenderRegion}.`,

      `Fresh fighting has erupted between ${attacker} and ${defender}, with clashes reported around ${defenderRegion}.`,

      `Battlefield reports indicate that ${attacker} has initiated an assault toward ${defenderRegion}, bringing a new front into active conflict.`

    );

  }

  if (
    attacker &&
    defender
  ) {

    return pick(

      `Hostilities have broken out between ${attacker} and ${defender}.`,

      `Military operations have commenced as ${attacker} launches an offensive against ${defender}.`,

      `Fresh fighting has erupted between ${attacker} and ${defender}.`,

      `Reports confirm that armed conflict has begun between ${attacker} and ${defender}.`,

      `${attacker} has opened a new military offensive against ${defender}.`

    );

  }

}
  
  if (eventType === "battleEnded") {

    const winnerSide =
      eventData.wonBy === "attacker"
        ? "attacker"
        : "defender";

    const winner =
      winnerSide === "attacker"
        ? nameCountry(eventData.attackerCountry)
        : nameCountry(eventData.defenderCountry);

    const loser =
      winnerSide === "attacker"
        ? nameCountry(eventData.defenderCountry)
        : nameCountry(eventData.attackerCountry);

    if (
      winner &&
      loser
    ) {

      return pick(

        `Military operations have concluded with ${winner} emerging victorious over ${loser}.`,

        `${winner} has secured victory following the conclusion of fighting against ${loser}.`,

        `Latest battlefield reports confirm a victory for ${winner} over ${loser}.`,

        `The battle has come to an end with ${winner} prevailing over ${loser}.`

      );

    }

  }

  if (eventType === "newPresident") {

    const country =
      nameCountry(eventData.country);

    const president =
      nameUser(eventData.user);

    if (
      president &&
      country
    ) {

      return pick(

        `${president} has officially been elected president of ${country}.`,

        `${country} has elected ${president} as its new president.`,

        `Election officials confirmed ${president} as the newly elected president of ${country}.`,

        `${president} will assume the presidency of ${country} following the latest vote.`

      );

    }

    if (country) {

      return pick(

        `${country} has officially elected a new president.`,

        `Election results indicate that ${country} has chosen a new president.`,

        `A new president has been elected in ${country}.`

      );

    }

  }
if (eventType === "regionTransfer") {

    const [from, to] =
      collectCountryIds(event, eventData)
        .map(nameCountry);

    const region =
      nameRegion(eventData.region) ||
      nameRegion(eventData.regionId);

    if (from && to && region) {

      return pick(

        `Control of ${region} has officially been transferred from ${from} to ${to}.`,

        `${region} has formally changed hands following its transfer from ${from} to ${to}.`,

        `Officials have confirmed the transfer of ${region} from ${from} to ${to}.`,

        `The territorial transfer of ${region} from ${from} to ${to} has now been finalized.`

      );

    }

    if (from && to) {

      return pick(

        `A territorial transfer has officially taken place between ${from} and ${to}.`,

        `${from} has transferred territory to ${to}, according to the latest reports.`,

        `Officials confirmed a territorial transfer involving ${from} and ${to}.`

      );

    }

  }

  if (eventType === "allianceMemberJoined") {

    const country =
      nameCountry(eventData.country);

    const alliance =
      eventData.allianceName;

    if (country && alliance) {

      return pick(

        `${country} has officially joined the ${alliance} alliance.`,

        `${country} has entered the ranks of the ${alliance} alliance.`,

        `Alliance officials confirmed the admission of ${country} into ${alliance}.`,

        `${country} has become the newest member of the ${alliance} alliance.`

      );

    }

    if (country) {

      return pick(

        `${country} has officially joined a new alliance.`,

        `${country} has announced its entry into a formal alliance.`,

        `Diplomatic developments indicate that ${country} has joined an alliance.`

      );

    }

  }

  if (eventType === "defensivePactFormed") {

    const countries =
      collectCountryIds(event, eventData)
        .map(nameCountry);

    const [countryA, countryB] =
      countries;

    if (countryA && countryB) {

      return pick(

        `${countryA} and ${countryB} have signed a new defensive pact.`,

        `A mutual defense agreement has been concluded between ${countryA} and ${countryB}.`,

        `${countryA} and ${countryB} have formalized a new defensive partnership.`,

        `Officials confirmed the signing of a defensive pact between ${countryA} and ${countryB}.`

      );

    }

    return pick(

      `A new defensive pact has been signed.`,

      `Officials have confirmed the conclusion of a new defensive agreement.`,

      `A fresh mutual defense agreement has entered into effect.`

    );

  }

  if (eventType === "depositDiscovered") {

    const resource =
      eventData.itemCode || "resource";

    const region =
      nameRegion(eventData.region) ||
      nameRegion(eventData.regionId);

    if (region) {

      return pick(

        `Authorities have confirmed the discovery of a new ${resource} deposit in ${region}.`,

        `Survey teams have identified a ${resource} deposit in ${region}.`,

        `Geological reports indicate the discovery of ${resource} reserves in ${region}.`,

        `A newly discovered ${resource} deposit has been reported in ${region}.`

      );

    }

    return pick(

      `Authorities have confirmed the discovery of a new ${resource} deposit.`,

      `Survey teams have reported a newly discovered ${resource} reserve.`,

      `Fresh geological findings indicate the presence of a new ${resource} deposit.`

    );

  }

  if (eventType === "depositDepleted") {

    const resource =
      eventData.itemCode || "resource";

    const region =
      nameRegion(eventData.region) ||
      nameRegion(eventData.regionId);

    if (region) {

      return pick(

        `The ${resource} deposit in ${region} has reportedly been exhausted.`,

        `Extraction efforts have depleted the ${resource} deposit in ${region}.`,

        `Officials confirmed that the ${resource} deposit in ${region} has run dry.`,

        `The known ${resource} reserves in ${region} have now been depleted.`

      );

    }

    return pick(

      `A ${resource} deposit has reportedly been exhausted.`,

      `Officials have confirmed the depletion of a ${resource} deposit.`,

      `Known reserves of ${resource} have reportedly been depleted.`

    );

  }

  if (eventType === "systemRevolt") {

    const region =
      nameRegion(eventData.region) ||
      nameRegion(eventData.regionId);

    if (region) {

      return pick(

        `Civil unrest has erupted in ${region}, escalating into open revolt.`,

        `Reports from ${region} indicate that widespread unrest has turned into open rebellion.`,

        `${region} has become the center of a growing uprising amid mounting unrest.`,

        `Fresh reports suggest that open revolt has broken out across ${region}.`

      );

    }

    return pick(

      `Civil unrest has escalated into open revolt.`,

      `Reports indicate that an uprising has broken out.`,

      `Authorities are reporting widespread unrest and open rebellion.`

    );

  }

  if (eventType === "regionLiberated") {

    const countries =
      collectCountryIds(event, eventData)
        .map(nameCountry);

    const liberator =
      countries[0];

    const recipient =
      countries[1];

    const region =
      nameRegion(eventData.regionId) ||
      nameRegion(eventData.region);

    if (
      liberator &&
      recipient &&
      region
    ) {

      return pick(

        `${liberator} has liberated ${region} before formally returning it to ${recipient}.`,

        `${region} has been liberated by ${liberator} and restored to ${recipient}.`,

        `Officials confirmed that ${region} has been returned to ${recipient} following its liberation by ${liberator}.`,

        `${liberator} has successfully liberated ${region} and transferred control back to ${recipient}.`

      );

    }

    return pick(

      `A region has reportedly been liberated.`,

      `Officials have confirmed the liberation of a contested region.`,

      `Latest reports indicate that a region has been successfully liberated.`

    );

  }
 if (eventType === "revolutionStarted") {

    const country =
      nameCountry(eventData.countryId) ||
      nameCountry(eventData.country);

    if (country) {

      return pick(

        `A revolution has erupted in ${country} following mounting internal tensions.`,

        `Reports indicate that revolutionary activity has broken out across ${country}.`,

        `${country} has entered a period of open revolutionary unrest.`,

        `Growing instability has escalated into a revolution in ${country}.`,

        `Authorities are reporting the outbreak of a revolution in ${country}.`

      );

    }

    return pick(

      `A revolution has erupted.`,

      `Reports indicate that revolutionary forces have mobilized.`,

      `Authorities have confirmed the outbreak of a revolution.`,

      `An internal uprising has escalated into open revolution.`

    );

  }

  if (eventType === "revolutionEnded") {

    const country =
      nameCountry(eventData.countryId) ||
      nameCountry(eventData.country);

    if (eventData.wonBy === "attacker") {

      return pick(

        `Revolutionary forces have emerged victorious in ${country}, bringing the conflict to a close.`,

        `Latest reports confirm a revolutionary victory in ${country}.`,

        `The revolution in ${country} has concluded with the insurgent forces prevailing.`,

        `Revolutionary forces have secured victory after the end of fighting in ${country}.`,

        `Officials now acknowledge the success of the revolutionary movement in ${country}.`

      );

    }

    if (eventData.wonBy === "defender") {

      return pick(

        `Government forces have successfully suppressed the uprising in ${country}.`,

        `Authorities report that the revolution in ${country} has been brought under control.`,

        `Government troops have restored control after defeating revolutionary forces in ${country}.`,

        `The attempted revolution in ${country} has been successfully contained.`,

        `Official sources confirm that government forces have prevailed in ${country}.`

      );

    }

    if (country) {

      return pick(

        `The revolutionary conflict in ${country} has officially come to an end.`,

        `Fighting linked to the revolution in ${country} has now concluded.`,

        `Authorities have confirmed the end of the revolutionary conflict in ${country}.`,

        `The internal conflict in ${country} has formally ended.`

      );

    }

    return pick(

      `The revolution has officially come to an end.`,

      `Authorities have confirmed the conclusion of the revolutionary conflict.`,

      `The internal uprising has now concluded.`

    );

  }

  if (eventType === "financedRevolt") {

    const region =
      nameRegion(eventData.regionId);

    const occupier =
      nameCountry(eventData.occupyingCountryId);

    const revolting =
      nameCountry(eventData.revoltingCountryId);

    if (
      region &&
      occupier &&
      revolting
    ) {

      return pick(

        `Reports indicate that an externally backed revolt has been launched in ${region} against the occupation by ${occupier} in support of ${revolting}.`,

        `Foreign-backed insurgent activity has reportedly emerged in ${region}, targeting the occupation by ${occupier}.`,

        `Authorities report outside support for an armed uprising in ${region} aligned with ${revolting}.`,

        `An externally financed rebellion has reportedly begun in ${region} against occupying forces from ${occupier}.`,

        `Fresh intelligence suggests that outside funding has fueled armed resistance in ${region}.`

      );

    }

    return pick(

      `Reports indicate that outside support has financed an armed uprising.`,

      `Authorities are investigating reports of foreign-backed insurgent activity.`,

      `An externally supported revolt has reportedly been organized.`

    );

  }

  if (
    eventType === "peaceMade" &&
    countryNames.length > 0
  ) {

    const countries =
      uniqueValues(countryNames).join(" and ");

    return pick(

      `${countries} have formally signed a peace agreement, bringing hostilities to an end.`,

      `A formal peace agreement has been concluded between ${countries}.`,

      `Hostilities between ${countries} have officially ended following the signing of a peace agreement.`,

      `Diplomatic negotiations have resulted in a peace agreement between ${countries}.`,

      `${countries} have reached a peace settlement after successful negotiations.`,

      `Officials have confirmed the signing of a peace agreement between ${countries}.`

    );

  }

  if (
    countryNames.length > 0 &&
    regionName
  ) {

    const countries =
      uniqueValues(countryNames).join(", ");

    return pick(

      `The latest developments involve ${countries} in and around ${regionName}.`,

      `Fresh reports from ${regionName} concern activities involving ${countries}.`,

      `Attention remains focused on ${regionName}, where developments involving ${countries} continue to unfold.`,

      `Officials are monitoring ongoing developments involving ${countries} around ${regionName}.`

    );

  }

  if (
    countryNames.length > 0
  ) {

    const countries =
      uniqueValues(countryNames).join(", ");

    return pick(

      `Recent developments involve ${countries}.`,

      `Officials continue to monitor events involving ${countries}.`,

      `Fresh reports concern ongoing developments related to ${countries}.`,

      `Attention remains focused on the latest activities involving ${countries}.`

    );

  }

  if (regionName) {

    return pick(

      `The latest reports concern developments in ${regionName}.`,

      `Attention remains focused on events unfolding in ${regionName}.`,

      `Fresh information continues to emerge from ${regionName}.`,

      `Officials are monitoring the latest developments in ${regionName}.`

    );

  }

  return pick(

    `Further details are emerging from the latest reports across the War Era world.`,

    `Additional developments continue to arrive from the global War Era news feed.`,

    `Authorities and observers continue to monitor events unfolding across the War Era world.`,

    `More information is expected as reports continue to arrive from around the world.`,

    `This remains one of the latest reported developments from across the War Era world.`

  );

}


function buildDetails(event, eventData) {
  const details = [];
  const countryNames = collectCountryIds(event, eventData).map(nameCountry).filter(Boolean);
  const regionName = nameRegion(event.regionId || event.region?.id || eventData.region || eventData.defenderRegion || eventData.attackerRegion);
  const battleName = formatBattleName(getBattleId(event));

  addDetail(details, "Priority", event.priority);
  addDetail(details, "Money", eventData.money !== undefined ? formatMoney(eventData.money) : "");
  addDetail(details, "Winner", eventData.wonBy ? formatEventType(eventData.wonBy) : "");
  addDetail(details, "Countries", uniqueValues(countryNames).join(", "));
  addDetail(details, "Region", regionName);
  addDetail(details, "Battle", battleName);

  return details.slice(0, 5);
}

function collectCountryIds(event, eventData) {
  return [
    event.countryId,
    event.country?.id,
    event.sourceCountry?.id,
    event.targetCountry?.id,
    event.attackerCountry?.id,
    event.defenderCountry?.id,
    eventData.country,
    eventData.sourceCountry,
    eventData.targetCountry,
    eventData.attackerCountry,
    eventData.defenderCountry,
    ...(Array.isArray(eventData.countries) ? eventData.countries : []),
    ...(Array.isArray(event.countries) ? event.countries : []),
  ].filter(Boolean);
}

function isWarEndedEvent(eventType) {
  return ["battleEnded", "warEnded", "war_end", "warEndedByBattle"].includes(eventType);
}

function formatBattleName(battleId) {
  if (!battleId) return "";

  const battle = state.lookups.battlesById.get(battleId);
  if (!battle) return "";

  const attacker = nameCountry(battle.attacker?.country);
  const defender = nameCountry(battle.defender?.country);
  const region = nameRegion(battle.defender?.region);
  const sides = [attacker, defender].filter(Boolean).join(" vs ");

  if (sides && region) return `${sides} in ${region}`;
  if (sides) return sides;
  if (region) return region;
  return "";
}

function nameCountry(id) {
  if (!id) return "";
  return state.lookups.countriesById.get(id)?.name || "";
}

function nameRegion(id) {
  if (!id) return "";
  return state.lookups.regionsById.get(id)?.name || "";
}

function nameUser(id) {
  if (!id) return "";
  return (
    state.lookups.usersById.get(id)?.username ||
    state.lookups.usersById.get(id)?.name ||
    ""
  );
}

function addDetail(details, label, value) {
  if (value === undefined || value === null || value === "") return;
  details.push({ label, value: String(value) });
}

function formatEventType(value) {
  if (value === "peaceMade") return "Peace Made";
  if (value === "battleEnded" || value === "warEnded" || value === "warEndedByBattle" || value === "war_end") return "Battle Ended";

  return String(value)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getWarEraLink(event, eventData) {
  const BASE_URL = "https://app.warera.io";

  const battleId = getBattleId(event);
  if (battleId) {
    return `${BASE_URL}/battle/${battleId}`;
  }

  if (eventData.war) {
    return `${BASE_URL}/war/${eventData.war}`;
  }

  if (Array.isArray(eventData.wars) && eventData.wars[0]) {
    return `${BASE_URL}/war/${eventData.wars[0]}`;
  }

  const regionId =
    eventData.region ||
    eventData.defenderRegion ||
    eventData.attackerRegion;

  if (regionId) {
    return `${BASE_URL}/region/${regionId}`;
  }

  const countryId = collectCountryIds(event, eventData)[0];

  if (countryId) {
    return `${BASE_URL}/country/${countryId}`;
  }

  return "";
}

function buildArticleSeed(event) {

    const eventData = getEventData(event);

    const eventType =
        event.type ||
        event.eventType ||
        eventData.type ||
        event.name ||
        "event";

    const headline =
        buildEventTitle(
            event,
            eventType,
            eventData
        );

    const summary =
        buildEventSummary(
            event,
            eventData
        );

    const details =
        buildDetails(event, eventData)
            .map(item =>
                `• ${item.label}: ${item.value}`
            )
            .join("\n");

    const link =
        getWarEraLink(event, eventData);

    return `# ${headline}

${summary}

${details}

${link ? `Source: ${link}` : ""}`;
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value === undefined || value === null ? "money" : String(value);

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value) {
  if (!value) return "Time unknown";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // paksa format 00–23
  }).format(date);
}

function parseLocalDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizeNameKey(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function setStatus(message, type = "info") {
  elements.statusBox.hidden = false;
  elements.statusBox.textContent = message;
  elements.statusBox.classList.toggle("error", type === "error");
}

function clearStatus() {
  elements.statusBox.hidden = true;
  elements.statusBox.textContent = "";
  elements.statusBox.classList.remove("error");
}

function setControlsDisabled(disabled) {
  elements.applyFiltersButton.disabled = disabled;
  elements.clearFiltersButton.disabled = disabled;
  elements.refreshButton.disabled = disabled;
  elements.loadMoreButton.disabled = disabled;
}

init();
