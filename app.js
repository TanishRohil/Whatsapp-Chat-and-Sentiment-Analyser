(() => {
  "use strict";

  /* ---------------- DOM refs ---------------- */
  const viewHero = document.getElementById("view-hero");
  const viewLoading = document.getElementById("view-loading");
  const viewDash = document.getElementById("view-dashboard");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const errorMsg = document.getElementById("error-msg");
  const newChatBtn = document.getElementById("new-chat-btn");
  const loadingText = document.getElementById("loading-text");

  let charts = {}; // keep refs so we can destroy on re-run

  /* ---------------- Stopwords ---------------- */
  const STOPWORDS = new Set(("i,me,my,myself,we,our,ours,ourselves,you,you're,you've,you'll,you'd,your,yours," +
    "yourself,yourselves,he,him,his,himself,she,she's,her,hers,herself,it,it's,its,itself,they,them,their," +
    "theirs,themselves,what,which,who,whom,this,that,that'll,these,those,am,is,are,was,were,be,been,being," +
    "have,has,had,having,do,does,did,doing,a,an,the,and,but,if,or,because,as,until,while,of,at,by,for,with," +
    "about,against,between,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over," +
    "under,again,further,then,once,here,there,when,where,why,how,all,any,both,each,few,more,most,other,some," +
    "such,no,nor,not,only,own,same,so,than,too,very,s,t,can,will,just,don,don't,should,should've,now,d,ll,m," +
    "o,re,ve,y,ain,aren,aren't,couldn,couldn't,didn,didn't,doesn,doesn't,hadn,hadn't,hasn,hasn't,haven,haven't," +
    "isn,isn't,ma,mightn,mightn't,mustn,mustn't,needn,needn't,shan,shan't,shouldn,shouldn't,wasn,wasn't,weren," +
    "weren't,won,won't,wouldn,wouldn't,media,omitted,ok,okay,yeah,yes,no,haha,lol,hai,ha,gif,image,sticker," +
    "video,audio,message,deleted,this,null").split(","));

  /* ---------------- Parsing ---------------- */
  // Handles common WhatsApp export line formats:
  //  "12/31/22, 11:59 PM - Name: message"
  //  "31/12/2022, 23:59 - Name: message"
  //  "[12/31/22, 11:59:59 PM] Name: message"
  const LINE_RE = /^\u200e?\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s?[-–]\s?(.*)$/;

  function parseChat(raw) {
    const lines = raw.split(/\r?\n/);
    const rows = [];
    let current = null;

    for (let rawLine of lines) {
      const line = rawLine.replace(/\u200e/g, "").trim();
      if (!line) continue;
      const m = LINE_RE.exec(line);
      if (m) {
        if (current) rows.push(current);
        const [, datePart, timePart, rest] = m;
        const dt = parseDateTime(datePart, timePart);
        let author = "System";
        let message = rest;
        const sep = rest.indexOf(": ");
        if (sep > -1 && sep < 60) {
          author = rest.slice(0, sep);
          message = rest.slice(sep + 2);
        } else {
          author = "System";
          message = rest;
        }
        current = { dt, author, message: message.trim() };
      } else if (current) {
        current.message += "\n" + line;
      }
    }
    if (current) rows.push(current);
    return rows.filter(r => r.dt);
  }

  function parseDateTime(datePart, timePart) {
    const dparts = datePart.split("/").map(Number);
    let [a, b, y] = dparts;
    if (y < 100) y += 2000;
    // WhatsApp is usually DD/MM/YY outside US, MM/DD/YY in the US.
    // Heuristic: if first part > 12 it must be a day.
    let day, month;
    if (a > 12) { day = a; month = b; } else { month = a; day = b; }
    if (month > 12) { const t = month; month = day; day = t; }

    let ampm = null;
    let tm = timePart.trim();
    const ampmMatch = /([APap][Mm])$/.exec(tm);
    if (ampmMatch) { ampm = ampmMatch[1].toUpperCase(); tm = tm.slice(0, -2).trim(); }
    const tparts = tm.split(":").map(Number);
    let hour = tparts[0] || 0;
    const minute = tparts[1] || 0;
    const second = tparts[2] || 0;
    if (ampm) {
      if (ampm === "PM" && hour < 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;
    }
    const date = new Date(y, month - 1, day, hour, minute, second);
    if (isNaN(date.getTime())) return null;
    return date;
  }

  /* ---------------- Emoji ---------------- */
  const EMOJI_RE = /\p{Extended_Pictographic}/gu;
  function extractEmoji(text) {
    return text.match(EMOJI_RE) || [];
  }

  /* ---------------- Analytics ---------------- */
  function analyze(rows) {
    const real = rows.filter(r => r.author !== "System");
    const perUser = new Map();
    const mediaPerUser = new Map();
    const byHour = new Array(24).fill(0);
    const byDay = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    const byMonth = {};
    const emojiCounts = new Map();
    const wordCounts = new Map();
    let mediaCount = 0;

    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    MONTH_NAMES.forEach(m => byMonth[m] = 0);

    for (const r of real) {
      perUser.set(r.author, (perUser.get(r.author) || 0) + 1);
      byHour[r.dt.getHours()]++;
      byDay[DAY_NAMES[r.dt.getDay()]]++;
      byMonth[MONTH_NAMES[r.dt.getMonth()]]++;

      const isMedia = /<Media omitted>|<attached:|omitted>/i.test(r.message);
      if (isMedia) {
        mediaCount++;
        mediaPerUser.set(r.author, (mediaPerUser.get(r.author) || 0) + 1);
      } else {
        for (const e of extractEmoji(r.message)) {
          emojiCounts.set(e, (emojiCounts.get(e) || 0) + 1);
        }
        const cleanText = r.message.replace(/https?:\/\/\S+|www\.\S+/g, "");
        const words = cleanText.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/);
        for (let w of words) {
          w = w.trim();
          if (w.length < 3) continue;
          if (STOPWORDS.has(w)) continue;
          if (/^\d+$/.test(w)) continue;
          wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
        }
      }
    }

    // group name detection
    let groupName = null;
    for (const r of rows) {
      if (r.author !== "System") continue;
      let gm = /changed the subject (?:to|from ".*?" to) "(.+?)"/.exec(r.message)
             || /created group "(.+?)"/.exec(r.message)
             || /created the group "(.+?)"/.exec(r.message);
      if (gm) groupName = gm[1];
    }
    const users = Array.from(perUser.keys());
    if (!groupName) {
      groupName = users.length === 2 ? `${users[0]} & ${users[1]}` : "Your WhatsApp Chat";
    }

    let mostEmoji = null, mostEmojiCount = 0;
    for (const [e, c] of emojiCounts) if (c > mostEmojiCount) { mostEmoji = e; mostEmojiCount = c; }

    return {
      rows: real,
      groupName,
      users,
      perUser,
      mediaPerUser,
      byHour,
      byDay,
      byMonth,
      emojiCounts,
      wordCounts,
      mediaCount,
      totalMessages: real.length,
      emojiTotal: Array.from(emojiCounts.values()).reduce((a, b) => a + b, 0),
      uniqueEmoji: emojiCounts.size,
      mostEmoji,
      startDate: real.length ? real[0].dt : null,
      endDate: real.length ? real[real.length - 1].dt : null,
    };
  }

  /* ---------------- Sentiment (AFINN-based) ---------------- */
  function scoreMessage(text) {
    const words = text.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
    let score = 0, hits = 0;
    for (const w of words) {
      if (Object.prototype.hasOwnProperty.call(AFINN_LEXICON, w)) {
        score += AFINN_LEXICON[w];
        hits++;
      }
    }
    return { score, hits, len: words.length };
  }

  function sentimentAnalysis(rows, startDt, endDt) {
    let subset = rows.filter(r => !/<Media omitted>|<attached:/i.test(r.message));
    if (startDt) subset = subset.filter(r => r.dt >= startDt);
    if (endDt) subset = subset.filter(r => r.dt <= endDt);
    subset = subset.filter(r => r.message.length > 8);

    const scored = subset.map(r => ({ ...r, ...scoreMessage(r.message) }));
    let pos = 0, neg = 0, neu = 0;
    for (const s of scored) {
      if (s.score > 0) pos++;
      else if (s.score < 0) neg++;
      else neu++;
    }
    let verdict = "Neutral";
    if (pos > neg && pos > neu) verdict = "Positive";
    else if (neg > pos && neg > neu) verdict = "Negative";

    const positive = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    const negative = scored.filter(s => s.score < 0).sort((a, b) => a.score - b.score).slice(0, 5);
    const neutral = scored.filter(s => s.score === 0 && s.hits === 0).sort((a, b) => b.len - a.len).slice(0, 5);

    return { pos, neg, neu, verdict, positive, negative, neutral, total: scored.length };
  }

  /* ---------------- Chart helpers ---------------- */
  // Bootstrap 5 default theme colors (success, primary, warning, danger, info, secondary...)
  const PALETTE = ["#198754", "#0d6efd", "#ffc107", "#dc3545", "#6f42c1", "#0dcaf0", "#d63384", "#20c997"];

  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  function baseGrid() {
    return {
      grid: { color: "rgba(0,0,0,0.08)" },
      ticks: { color: "#6c757d", font: { size: 11 } }
    };
  }

  function renderUsersChart(analysis) {
    destroyChart("users");
    const entries = Array.from(analysis.perUser.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const ctx = document.getElementById("chart-users");
    charts.users = new Chart(ctx, {
      type: "bar",
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]),
          borderRadius: 6,
          maxBarThickness: 46,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: baseGrid(), y: baseGrid() }
      }
    });
  }

  function renderHoursChart(analysis) {
    destroyChart("hours");
    const ctx = document.getElementById("chart-hours");
    charts.hours = new Chart(ctx, {
      type: "line",
      data: {
        labels: analysis.byHour.map((_, h) => h + "h"),
        datasets: [{
          data: analysis.byHour,
          borderColor: "#198754",
          backgroundColor: "rgba(25,135,84,0.15)",
          fill: true, tension: 0.35, pointRadius: 0,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: baseGrid(), y: baseGrid() }
      }
    });
  }

  function renderDaysChart(analysis) {
    destroyChart("days");
    const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const ctx = document.getElementById("chart-days");
    charts.days = new Chart(ctx, {
      type: "bar",
      data: {
        labels: order.map(d => d.slice(0, 3)),
        datasets: [{
          data: order.map(d => analysis.byDay[d] || 0),
          backgroundColor: "#0d6efd",
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: baseGrid(), y: baseGrid() }
      }
    });
  }

  function renderMonthsChart(analysis) {
    destroyChart("months");
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const ctx = document.getElementById("chart-months");
    charts.months = new Chart(ctx, {
      type: "bar",
      data: {
        labels: months.map(m => m.slice(0, 3)),
        datasets: [{
          data: months.map(m => analysis.byMonth[m] || 0),
          backgroundColor: "#ffc107",
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: baseGrid(), y: baseGrid() }
      }
    });
  }

  function renderMediaChart(analysis) {
    destroyChart("media");
    const entries = Array.from(analysis.mediaPerUser.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const ctx = document.getElementById("chart-media");
    if (!entries.length) {
      ctx.getContext("2d").clearRect(0,0,ctx.width,ctx.height);
      const p = ctx.parentElement;
      p.innerHTML = '<p style="color:#6c757d;font-size:.85rem;text-align:center;padding-top:100px;">No media messages found</p>';
      return;
    }
    charts.media = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "right", labels: { color: "#212529", font: { size: 11 } } } }
      }
    });
  }

  function renderEmojiChart(analysis) {
    destroyChart("emoji");
    const entries = Array.from(analysis.emojiCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const ctx = document.getElementById("chart-emoji");
    if (!entries.length) {
      const p = ctx.parentElement;
      p.innerHTML = '<p style="color:#6c757d;font-size:.85rem;text-align:center;padding-top:100px;">No emoji found</p>';
      return;
    }
    charts.emoji = new Chart(ctx, {
      type: "pie",
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "right", labels: { color: "#212529", font: { size: 16 } } } }
      }
    });
  }

  function renderSentimentChart(canvasId, verdictId, s) {
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId);
    charts[canvasId] = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Positive", "Neutral", "Negative"],
        datasets: [{ data: [s.pos, s.neu, s.neg], backgroundColor: ["#198754", "#ffc107", "#dc3545"], borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "72%",
        plugins: { legend: { position: "bottom", labels: { color: "#212529", font: { size: 11 } } } }
      }
    });
    document.getElementById(verdictId).innerHTML = `overall<br><b>${s.verdict}</b>`;
  }

  function renderWordCloud(analysis) {
    const container = document.getElementById("wordcloud");
    container.innerHTML = "";
    const entries = Array.from(analysis.wordCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 45);
    if (!entries.length) {
      container.innerHTML = '<p style="color:#6c757d;font-size:.85rem;">Not enough text to build a word cloud</p>';
      return;
    }
    const max = entries[0][1], min = entries[entries.length - 1][1];
    entries.forEach(([word, count], i) => {
      const t = max === min ? 1 : (count - min) / (max - min);
      const size = 0.85 + t * 2.3; // rem
      const span = document.createElement("span");
      span.className = "wc-word";
      span.textContent = word;
      span.style.fontSize = size.toFixed(2) + "rem";
      span.style.color = PALETTE[i % PALETTE.length];
      span.title = `${word} — ${count} times`;
      container.appendChild(span);
    });
  }

  function renderSentimentLists(prefix, s) {
    const fill = (id, arr, emptyMsg) => {
      const ul = document.getElementById(id);
      ul.innerHTML = "";
      if (!arr.length) {
        const li = document.createElement("li");
        li.textContent = emptyMsg;
        ul.appendChild(li);
        return;
      }
      for (const item of arr) {
        const li = document.createElement("li");
        li.textContent = item.message.length > 140 ? item.message.slice(0, 140) + "…" : item.message;
        ul.appendChild(li);
      }
    };
    fill(prefix + "-positive", s.positive, "No standout positive messages");
    if (document.getElementById(prefix + "-neutral")) fill(prefix + "-neutral", s.neutral, "No standout neutral messages");
    fill(prefix + "-negative", s.negative, "No standout negative messages");
  }

  /* ---------------- Bento stats ---------------- */
  function renderBento(analysis) {
    const el = document.getElementById("bento-stats");
    const stats = [
      { num: analysis.totalMessages.toLocaleString(), label: "Total messages" },
      { num: analysis.users.length, label: "Participants" },
      { num: analysis.mediaCount.toLocaleString(), label: "Media shared" },
      { num: analysis.emojiTotal.toLocaleString(), label: "Emoji sent" },
      { num: (analysis.mostEmoji || "—") + "", label: "Most-used emoji" },
    ];
    el.innerHTML = stats.map(s => `
      <div class="col-6 col-md-4 col-lg">
        <div class="card text-center h-100 border-success-subtle">
          <div class="card-body py-3">
            <div class="fs-4 fw-bold">${s.num}</div>
            <div class="text-secondary small">${s.label}</div>
          </div>
        </div>
      </div>`).join("");
  }

  /* ---------------- Orchestration ---------------- */
  function showView(view) {
    [viewHero, viewLoading, viewDash].forEach(v => v.hidden = true);
    view.hidden = false;
    newChatBtn.hidden = view !== viewDash;
  }

  function fmtDate(d) {
    if (!d) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function toLocalInputValue(d) {
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let fullAnalysis = null;
  let allRows = [];

  function runFullDashboard(analysis) {
    document.getElementById("group-eyebrow").textContent = analysis.users.length === 2 ? "› DIRECT CHAT" : "› GROUP";
    document.getElementById("group-name").textContent = analysis.groupName;
    document.getElementById("group-range").textContent = `${fmtDate(analysis.startDate)} → ${fmtDate(analysis.endDate)} · ${analysis.users.length} people`;

    renderBento(analysis);
    renderUsersChart(analysis);
    renderHoursChart(analysis);
    renderDaysChart(analysis);
    renderMonthsChart(analysis);
    renderMediaChart(analysis);
    renderEmojiChart(analysis);
    renderWordCloud(analysis);

    const s = sentimentAnalysis(analysis.rows, null, null);
    renderSentimentChart("chart-sentiment", "sentiment-verdict", s);
    renderSentimentLists("list", s);

    if (analysis.startDate && analysis.endDate) {
      document.getElementById("range-start").value = toLocalInputValue(analysis.startDate);
      document.getElementById("range-end").value = toLocalInputValue(analysis.endDate);
    }
  }

  function handleFile(file) {
    if (!file) return;
    errorMsg.hidden = true;
    if (!file.name.toLowerCase().endsWith(".txt")) {
      errorMsg.textContent = "Please upload the .txt file exported from WhatsApp.";
      errorMsg.hidden = false;
      return;
    }
    showView(viewLoading);
    loadingText.textContent = "Reading messages…";

    const reader = new FileReader();
    reader.onload = (e) => {
      setTimeout(() => {
        try {
          loadingText.textContent = "Parsing conversation…";
          const rows = parseChat(e.target.result);
          if (!rows.length) {
            showView(viewHero);
            errorMsg.textContent = "Couldn't find any messages in that file — make sure it's an unedited WhatsApp export.";
            errorMsg.hidden = false;
            return;
          }
          loadingText.textContent = "Crunching the numbers…";
          setTimeout(() => {
            try {
              allRows = rows;
              fullAnalysis = analyze(rows);
              runFullDashboard(fullAnalysis);
              showView(viewDash);
              window.scrollTo(0, 0);
            } catch (err2) {
              console.error(err2);
              showView(viewHero);
              errorMsg.textContent = "Something went wrong analyzing that chat: " + (err2 && err2.message ? err2.message : err2) + " — please open the browser console (F12) for details.";
              errorMsg.hidden = false;
            }
          }, 250);
        } catch (err) {
          console.error(err);
          showView(viewHero);
          errorMsg.textContent = "Something went wrong reading that file. Please check it's an unedited WhatsApp .txt export.";
          errorMsg.hidden = false;
        }
      }, 200);
    };
    reader.onerror = () => {
      showView(viewHero);
      errorMsg.textContent = "Couldn't read that file — please try again.";
      errorMsg.hidden = false;
    };
    reader.readAsText(file, "utf-8");
  }

  /* ---------------- Event wiring ---------------- */
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

  ["dragenter", "dragover"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    handleFile(file);
  });

  newChatBtn.addEventListener("click", () => {
    fileInput.value = "";
    errorMsg.hidden = true;
    showView(viewHero);
  });

  document.getElementById("range-run").addEventListener("click", () => {
    const startVal = document.getElementById("range-start").value;
    const endVal = document.getElementById("range-end").value;
    if (!startVal || !endVal || !allRows.length) return;
    const start = new Date(startVal);
    const end = new Date(endVal);
    const s = sentimentAnalysis(allRows, start, end);
    document.getElementById("range-results").hidden = false;
    renderSentimentChart("chart-range-sentiment", "range-verdict", s);
    renderSentimentLists("range-list", s);
  });
})();
