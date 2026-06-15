# war-era-news-desk
A real-time newsroom dashboard for War Era journalists. Monitor global events, wars, diplomacy, battles, and articles through an intelligent timeline interface powered by the War Era API.

# 📰 War Era News Desk

War Era News Desk is a web-based journalist dashboard tool used to display a global event timeline and War Era articles in real-time via the War Era API.

This project is built with vanilla HTML, CSS, and JavaScript without a framework, with a focus on performance, data structure, and a dynamic war news reading experience.

---

## 🚀 Live Features

### 📡 Global Events Timeline
- Displays War Era world events in real-time
- Supports multiple event types:
- War declared / ended
- Battle opened / ended
- Alliance formed / broken
- Region transfer / liberation
- Revolution events
- Economic events (transfer, deposit, bankruptcy, etc.)

### 📰 Article Feed
- Displays articles from the War Era API
- Article search feature
- Reader mode (modal full article)
- Copy headlines directly from events

### 🔎 Advanced Filtering
- Filter by:
- Country
- Event type
- Time range (From / To)
- Auto-resolve country & region names

### 🔑 API Key System
- Users must enter a War Era API key
- Stored in `localStorage`
- Modal API key input

### 🌙 Theme System
- Light / Dark mode toggle
- Stored in localStorage

### 🔄 Auto Refresh
- Timeline auto-refreshes every 30 seconds
- Load more pagination support

---

## 🧠 Core Concept

This application works as a **real-time journalist dashboard**:

1. Fetch event data from:
https://gateway.warera.io/trpc/event.getEventsPaginated

2. Fetch article data dari:
https://gateway.warera.io/trpc/article.getArticlesPaginated
3. Resolve additional data:
- Country names
- Region names
- Usernames
- Battle metadata

4. Render to UI card-based timeline

---

## 🛠 Tech Stack

- HTML5 (semantic templates + modal system)
- CSS3 (custom variables + dark mode system)
- Vanilla JavaScript (no framework)
- War Era TRPC API

---

## 📁 Project Structure
/index.html # Main UI structure
/style.css # Full styling (light + dark theme)
/script.js # Core application logic

## ⚙️ How It Works

1. Initialization
js
init()
Load API key from localStorage
Set theme
Populate event types
Start auto refresh if API key is available

2. Event System
loadEvents({ reset: true })
Fetch paginated events
Resolve:
countries
regions
battles
users
Render event cards

3. Article System
loadArticles(true)
Fetch article list
Resolve author usernames
Render article cards
Support search filtering

4. Auto Refresh Engine
setInterval(() => loadEvents({ reset: true }), 30000)
Automatically update timeline every 30 seconds
Only active if API key is available

🎯 Key Features Explained
🧾 Event Intelligence Rendering

Events are not only displayed as raw JSON, but are processed into sentences:

Example:

France declared war on Germany
Tokyo opened a battle in Kanto
🧠 Data Resolution Layer

Script automatically resolves:

countryId → country name
regionId → region name
userId → username
battleId → battle metadata
📖 Reader Mode

Articles can be read in modal:

Full content rendering
iframe auto-resize (YouTube supported)
External links open in new tab
🔐 API Requirements

This project requires a War Era API key.

How to use:

Click the 🔑 button
Enter API key
The system automatically saves to localStorage

🌐 Deployments

Can be deployed to:

GitHub Pages
Netlify
Vercel (static hosting)
📌 Credits
Data source: War Era API
UI/Engine: rooster
Project: War Era Journalist Tool

## License

This project is licensed under the MIT License. See the LICENSE file for details.
