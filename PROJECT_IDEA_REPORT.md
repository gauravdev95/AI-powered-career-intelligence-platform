# Grafted — Project Idea Report
### "Meri soch se lekar kaam karne tak" — ek developer ka career intelligence platform

*(Ye report idea se lekar current architecture tak ka safar hai — kya socha, kya use kiya, data kaha se aata hai, aur ye actually kaise kaam karta hai.)*

---

## Page 1 — Idea kaise aaya (The Thought)

### Problem jo maine notice ki

Main ek Indian developer hoon (ya student). Mere paas ek problem hai jo baar-baar aati hai:

- Mujhe nahi pata **meri current skills (React, Node, Python...) se main kis company me fit hoon.**
- Har baar naye job description padhta hoon, LinkedIn kholta hoon, phir sab bhool jaata hoon.
- Koi **ek jagah nahi** jahan meri poori career journey ek screen pe dikhe — meri skills, mere gaps, meri target companies, upcoming hackathons.
- Aur sabse badi baat — koi tool mujhe **yaad nahi rakhta**. Aaj kuch dhundo, kal wapas aao, sab reset.

### To maine socha

> "Kyun na ek aisa platform banau jo mera **career ka Google Maps** ban jaye? Ek live map jisme main center me hoon, aur mere charo taraf meri skills, companies, hackathons, aur skill-gaps nodes ki tarah jude hue hain. Aur sabse important — **ye mujhe har baar yaad rakhe.**"

Isko naam diya: **Grafted** — *"Your career. One screen. Always remembered."*

### Core idea ek line me

Ek AI-powered platform jo:
1. Meri tech stack ko ek **live knowledge graph** me convert kare,
2. Mujhe **top Indian startups** se match kare,
3. Relevant **hackathons** dikhaye,
4. Mere **skill gaps** identify kare (salary impact ke saath),
5. Meri apni career-wiki se **chat** karne de,
6. Aur ye **sab kuch permanently yaad rakhe.**

---

## Page 2 — Kya use kiya (The Tech Choices)

### 1. Frontend (jo user dekhega)
- **React 18 + Vite** — fast, modern UI.
- **vis-network** — mera "career graph" — nodes (You, skills, companies, hackathons) aur edges. Ye hero feature hai.
- **Deploy:** Vercel pe.

### 2. Backend (jo dimaag hai)
- **Node.js 20 + Express (ESM)** — REST API, ~18 endpoints.
- Server sirf ek **thin layer** hai: input validate karo, memory engine ka ek method call karo, response bhejo. Koi business logic yahan nahi.
- **Deploy:** Render pe.

### 3. Memory (jo yaad rakhta hai) — **sabse important part**

Yahan sabse bada decision liya. Pehle plan tha ki koi ready-made memory SDK use karenge. Problem ye thi ki wo ek **single JSON blob** hota — na search kar sakte, na rank, na relationships bana sakte. Aur agar wo service down ho jaye to poora "always remembered" promise toot jata.

To maine apna **Career Memory Engine** banaya:

```
Career Memory Engine
├── Memory Store         → PostgreSQL me durable storage
├── Memory Retriever     → vector + keyword hybrid search
├── Memory Ranker        → 6 signals se scoring
├── Memory Extractor     → raw content se memories banata hai
├── Memory Deduplicator  → duplicate/conflict handle karta hai
├── Context Builder      → prompt ke liye budgeted context
└── Memory Graph         → relationships aur wikilinks
```

- **PostgreSQL** — source of truth. Restart, redeploy, free-tier sleep — data kabhi nahi jaata.
- **pgvector** — semantic search. Har memory ka embedding store hota hai, HNSW index ke saath.
- **Redis** — sirf cache (optional). Iske bina bhi app 100% correct chalta hai, bas thoda slow.

### 4. AI ka dimaag
- **Gemini API** — entity extraction, wiki generation, chat, roadmap, aur memory extraction ke liye.
- Ye ek **`aiService` abstraction** ke peeche hai. Matlab kal provider badalna ho to ek naya file add karo aur `AI_PROVIDER` env var change karo — baaki code ko pata bhi nahi chalega.
- **Key na ho tab bhi?** App chalta hai. Matching, storage, retrieval, ranking, graph, journey — sab kaam karte hain. Embeddings ek deterministic local encoder pe chale jaate hain, aur generative features honest fallback dete hain.

### Why ye combination?

| Zaroorat | Choice | Reason |
|---|---|---|
| Graph dikhana | vis-network | Native, interactive graph rendering |
| Data kabhi na khoye | PostgreSQL | Real database, real durability |
| "Meaning" se search | pgvector | Cosine similarity, ANN index |
| AI intelligence | Gemini | JSON mode + schema = reliable structured output |
| Provider lock-in na ho | aiService | Ek file badlo, provider badal jaye |

---

## Page 3 — Data kaha se aata hai (The Data Sources)

Data ko **3 buckets** me divide kiya:

### Bucket 1 — Curated static data (maine khud banaya)
`backend/data/` me JSON files:
- **`startups.json` — 20 Indian startups.** Naam, type, stage, location, `skills_required`, salary range (LPA), interview topics, hiring status.
- **`hackathons.json` — 15 hackathons.** Organizer, deadline, prize pool, relevant skills.
- **`skills.json` — 30 skills.** Demand score, learning time (weeks), difficulty, **salary premium %**, free resource URL.

> Ye mera "ground truth" hai — researched aur verified.

**Important:** In par matching **AI se nahi** hoti. Skill list ko requirement list se match karna simple arithmetic hai. Deterministic rakhne se result stable, instant, free hai — aur API key ho ya na ho, same rehta hai. AI wahan lagti hai jahan arithmetic kaam nahi karti.

### Bucket 2 — User ka apna data
4-step onboarding wizard. Ye data **columns me nahi** jaata — ye **memories ban jaata hai**:
- Har skill → ek `SKILL` memory
- Har goal → ek `GOAL` memory
- Har target company → ek `TARGET_COMPANY` memory

Isliye har skill ranking, deduplication aur graph me participate karta hai.

### Bucket 3 — Live ingested data
- User job description **paste** karta hai, ya ek **URL** deta hai.
- URL ho to backend usko **safely fetch** karta hai (private IPs, cloud metadata endpoints, redirects — sab blocked), HTML ko markdown me convert karta hai.
- Phir **Gemini** usme se companies, skills, hackathons, gaps extract karta hai.
- Ye sab memories ban jaate hain **aur** wiki pages ban jaate hain.

---

## Page 4 — Ye kaise kaam karta hai (How It Works)

### Step 1 — Onboarding
`localStorage` check → koi userId nahi → 4-step wizard → `POST /api/user/init` → PostgreSQL me user + memories create.

### Step 2 — Career Graph
Live knowledge graph. Center me "You", charo taraf known skills (green), gaps (red), matched startups (orange), hackathons (purple).

### Step 3 — Matching & Analysis
- **`POST /api/analyze`** — har startup ka score. Agar wo meri target company hai to +20 boost.
- **`POST /api/gaps`** — konsi skills sabse zyada targets maangte hain, learning time aur salary impact ke saath.
- **`GET /api/hackathons/:userId`** — stack ke hisaab se rank, deadline urgency badges ke saath.

### Step 4 — Ingest → Wiki → Chat (the magic)

**Write path:**
```
content → Gemini extraction → candidates → embed → deduplicate → PostgreSQL → relate
```

Deduplicator ka kaam sabse interesting hai. Same fact dobara aaye to 5 me se ek decision:
- **skip** — bilkul same hai, kuch mat karo
- **reinforce** — same baat alag words me, confidence badha do
- **supersede** — nayi info hai, purani ko `SUPERSEDED` mark karo (delete nahi — history rehti hai)
- **conflict** — contradiction hai aur purani memory zyada strong evidence pe hai → dono ko flag karo
- **insert** — bilkul nayi baat hai

**Read path (chat):**
```
question → embed → pgvector search → rank (6 signals) → budget → Gemini → citations verify
```

Ranking me 6 signals hain: semantic similarity, importance, recency, confidence, source quality, access frequency. Har weight ek env var hai — code change kiye bina tune kar sakte ho.

**Sabse important:** poori wiki kabhi Gemini ko nahi bhejte. Ek **hard character budget** hai (6000 chars). Chahe 5 pages ho ya 500 — prompt ka size same rehta hai, bas content best-first bharta hai.

**Citations:** model jo keys cite karta hai, unko verify kiya jaata hai. Jo key context me thi hi nahi, wo drop ho jaati hai. Matlab **fabricated citation UI tak pahunch hi nahi sakti.**

### Step 5 — Sab kuch yaad rehta hai
Har action journey me record hota hai. Wapas aane pe `GET /api/return-context` → personalised welcome: *"Welcome back! Last time you explored Razorpay. Your top gap was TypeScript..."*

### Poora flow
```
Onboarding → memories → Career Graph
     ↓
  Ingest (JD/URL) → Gemini → memories + wiki pages → chunked → embedded → pgvector
     ↓
  Career Chat → retrieve → rank → budget → Gemini → verified citations
     ↓
  Sab PostgreSQL me → returning user ko personalised welcome
```

### Graceful degradation
- Gemini key nahi? → matching, storage, retrieval, graph sab chalte hain; local encoder embeddings karta hai.
- Redis nahi? → in-process cache.
- URL scrape nahi hua? → clear message: "text paste kar do".
- Private/internal URL diya? → block, kyunki wo SSRF hota.

---

## Page 5 — Security (jo demo me nahi dikhta par zaroori hai)

- **SQL injection** — har query parameterised. Koi string interpolation nahi.
- **User isolation** — har memory function me `user_id` mandatory parameter hai aur har `WHERE` clause me aata hai. Ek user dusre ka data pad hi nahi sakta — ye database-level guarantee hai, convention nahi.
- **SSRF** — URL ingestion pe: scheme allowlist, private/loopback/link-local/cloud-metadata IPs blocked, redirects re-validated, real timeout, response size cap.
- **Rate limiting** — global bucket + AI routes ke liye alag tighter bucket.
- **Secrets** — logs me kabhi nahi. API key header me jaati hai, URL me nahi.

---

## Summary — Ek line me

> Grafted ek aisa platform hai jisme **React + vis-network** se graph banta hai, **Node/Express** API hai, **PostgreSQL + pgvector** ka custom Career Memory Engine sab kuch permanently yaad rakhta hai, aur **Gemini** extraction, chat aur roadmap sambhalta hai — sab milke ek personal career-Wikipedia jo har session me smarter hoti jaati hai, aur jiske har jawab ke peeche ek verify ki hui citation hoti hai.

Technical detail ke liye: **[ARCHITECTURE.md](ARCHITECTURE.md)**
