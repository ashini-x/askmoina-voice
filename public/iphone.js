(() => {
  "use strict";
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const phoneOS = $("#phoneOS");
  const phoneScreen = $("#phoneScreen");
  const appShell = $("#askmoinaApp");
  const appSheet = $("#appSheet");
  const appContent = $("#appContent");
  const appTitle = $("#appTitle");
  const returnHome = $("#returnHome");
  const controlCenter = $("#controlCenter");
  const notificationCenter = $("#notificationCenter");
  const searchPanel = $("#searchPanel");
  const searchInput = $("#appSearchInput");
  let currentApp = "";
  let cameraStream = null;
  let stopwatchTimer = null;
  let stopwatchStarted = 0;
  let stopwatchElapsed = 0;
  let messageItems = load("moina.demo.messages", [
    { mine: false, text: "Welcome to your little demo space.", time: "Now" },
    { mine: true, text: "Everything here is a local interactive preview.", time: "Now" }
  ]);
  let reminders = load("moina.demo.reminders", []);
  let calendarEvents = load("moina.demo.events", []);
  let calendarOffset = 0;
  let selectedCalendarDate = dateKey(new Date());
  let dialNumber = "";
  let musicPlaying = false;
  let musicContext = null;
  let musicOscillator = null;
  let musicGain = null;
  let musicToneTimer = null;
  let searchActive = false;
  let touchStartX = null;
  let touchStartY = null;

  const settings = { wifi: true, bluetooth: true, airplane: false, focus: false, dark: false };
  const apps = [
    { id:"askmoina", name:"AskMoina", className:"art-moina", glyph:"m", description:"Your voice companion" },
    { id:"photos", name:"Photos", className:"art-photos", glyph:"✿", description:"Illustrative gallery" },
    { id:"camera", name:"Camera", className:"art-camera", glyph:"◉", description:"Camera preview" },
    { id:"messages", name:"Messages", className:"art-messages", glyph:"●", description:"Local-only sample messages" },
    { id:"calendar", name:"Calendar", className:"art-calendar", glyph:"12", description:"Calendar and demo events" },
    { id:"clock", name:"Clock", className:"art-clock", glyph:"◷", description:"Clock and stopwatch" },
    { id:"settings", name:"Settings", className:"art-settings", glyph:"⚙", description:"Simulated device controls" },
    { id:"notes", name:"Notes", className:"art-notes", glyph:"≡", description:"Saved in this browser" },
    { id:"safari", name:"Browser", className:"art-safari", glyph:"⌖", description:"Open web pages in a new tab" },
    { id:"maps", name:"Maps", className:"art-maps", glyph:"⌖", description:"Open map searches" },
    { id:"music", name:"Music", className:"art-music", glyph:"♫", description:"Short synthetic tone demo" },
    { id:"reminders", name:"Reminders", className:"art-reminders", glyph:"✓", description:"Local reminder list" },
    { id:"phone", name:"Phone", className:"art-phone", glyph:"☎", description:"Dial a number" },
    { id:"mail", name:"Mail", className:"art-mail", glyph:"✉", description:"Open your mail app" },
    { id:"files", name:"Files", className:"art-files", glyph:"▰", description:"About files in this demo" },
    { id:"store", name:"Discover", className:"art-store", glyph:"A", description:"Explore demo apps" }
  ];

  function load(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (_) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[char]);
  }
  function dateKey(date) {
    return date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
  }
  function humanDate(date) {
    return new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(date);
  }
  function updateTime() {
    const now = new Date();
    const time = new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit",hour12: true}).format(now).replace(/\s/g,"").toLowerCase();
    $$("[data-time]").forEach(node => node.textContent = time);
    const weekday = $("#phoneWeekday");
    const phoneDate = $("#phoneDate");
    const calendarAppDate = $("#calendarAppDate");
    if (weekday) weekday.textContent = new Intl.DateTimeFormat(undefined,{weekday:"long"}).format(now).toUpperCase();
    if (phoneDate) phoneDate.textContent = new Intl.DateTimeFormat(undefined,{day:"numeric",month:"long"}).format(now).toUpperCase();
    if (calendarAppDate) calendarAppDate.textContent = String(now.getDate());
    const status = $("#phoneStatusDate");
    if (status) status.textContent = humanDate(now);
    const display = $("#clockLiveDisplay");
    if (display) display.textContent = new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit",second:"2-digit",hour12:true}).format(now);
  }

  function openAskMoina() {
    closeApp();
    closePanels();
    phoneOS.hidden = true;
    appShell.classList.remove("is-app-hidden");
    returnHome.hidden = false;
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function goHome() {
    if (appShell && !appShell.classList.contains("is-app-hidden")) {
      appShell.classList.add("is-app-hidden");
      returnHome.hidden = true;
      phoneOS.hidden = false;
      closeApp();
      closePanels();
      window.scrollTo({top:0,behavior:"smooth"});
      return;
    }
    closeApp();
    closePanels();
    phoneOS.hidden = false;
  }
  function closeCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
  }
  function stopMusic() {
    musicPlaying = false;
    if (musicToneTimer) { clearInterval(musicToneTimer); musicToneTimer = null; }
    try { if (musicOscillator) musicOscillator.stop(); } catch (_) {}
    musicOscillator = null;
    if (musicContext && musicContext.state !== "closed") musicContext.close().catch(()=>{});
    musicContext = null;
    musicGain = null;
  }
  function closeApp() {
    appSheet.hidden = true;
    closeCamera();
    if (stopwatchTimer) { clearInterval(stopwatchTimer); stopwatchTimer = null; }
    stopMusic();
    currentApp = "";
  }
  function closePanels() {
    controlCenter.hidden = true;
    notificationCenter.hidden = true;
    searchPanel.hidden = true;
    searchActive = false;
  }
  function openPanel(panel) {
    closePanels();
    closeApp();
    if (panel === "control") {
      updateControlToggles();
      controlCenter.hidden = false;
    } else if (panel === "notifications") {
      notificationCenter.hidden = false;
    } else {
      searchPanel.hidden = false;
      searchActive = true;
      renderSearch("");
      window.setTimeout(() => searchInput && searchInput.focus(), 80);
    }
  }
  function toggleSetting(key) {
    if (!(key in settings)) return;
    settings[key] = !settings[key];
    if (key === "airplane" && settings.airplane) {
      settings.wifi = false;
      settings.bluetooth = false;
    }
    if (key === "wifi" && settings.wifi) settings.airplane = false;
    if (key === "bluetooth" && settings.bluetooth) settings.airplane = false;
    phoneScreen.classList.toggle("is-dark", settings.dark);
    updateControlToggles();
    if (currentApp === "settings") appContent.innerHTML = renderSettings();
  }
  function updateControlToggles() {
    $$("[data-toggle]").forEach(button => {
      const key = button.dataset.toggle;
      button.classList.toggle("is-on", Boolean(settings[key]));
      button.setAttribute("aria-pressed", String(Boolean(settings[key])));
    });
    const appearance = $("#appearanceState");
    if (appearance) appearance.textContent = settings.dark ? "Dark" : "Light";
  }
  function toggleMarkup(key, title, sub, glyph, color) {
    return '<div class="settings-row"><span class="setting-icon" style="background:'+color+'">'+glyph+'</span><span class="setting-copy"><strong>'+title+'</strong><small>'+sub+'</small></span><button class="sim-toggle" type="button" role="switch" aria-checked="'+String(Boolean(settings[key]))+'" data-setting="'+key+'" aria-label="Toggle '+title+'"></button></div>';
  }
  function renderSettings() {
    return '<h3>Settings</h3><p class="app-lead">A familiar controls layout for this interactive browser demo.</p><div class="settings-group">'+
      toggleMarkup("airplane","Airplane mode","Simulated; does not disconnect your device","✈","#f1a23a")+
      toggleMarkup("wifi","Wi-Fi","A visual setting for this demo","⌁","#1685f8")+
      toggleMarkup("bluetooth","Bluetooth","A visual setting for this demo","ᛒ","#2978e9")+
      toggleMarkup("focus","Focus","Reduce visual distractions in this demo","◐","#8970f5")+
      toggleMarkup("dark","Dark appearance","Change the simulator appearance","◑","#596171")+
      '</div><div class="app-section-label">About</div><div class="settings-group">'+
      '<div class="settings-row"><span class="setting-icon" style="background:#7a8ca5">◉</span><span class="setting-copy"><strong>AskMoina Phone Concept</strong><small>Browser-based interaction prototype</small></span></div>'+
      '<div class="settings-row"><span class="setting-icon" style="background:#41a981">✓</span><span class="setting-copy"><strong>Privacy</strong><small>Notes and demo messages stay in this browser storage.</small></span></div></div>'+
      '<div class="demo-banner">These switches only change the mock interface. A website cannot toggle your phone’s real Wi-Fi, Bluetooth, Airplane Mode or system appearance.</div>';
  }
  function renderPhotos() {
    const photos = [
      ["Aurora","linear-gradient(150deg,#14244b,#729dd9 36%,#f4c2db 68%,#fdf3dd)"],
      ["Afterglow","linear-gradient(135deg,#ea8f98,#f0c8ab 44%,#5b638f)"],
      ["Ocean","linear-gradient(165deg,#172f68,#297da7 45%,#91dfdb)"],
      ["Wildflower","radial-gradient(circle at 25% 30%,#ffdf91 0 5%,transparent 6%),radial-gradient(circle at 65% 58%,#b7f0df 0 12%,transparent 13%),linear-gradient(140deg,#719f7e,#e0ccba,#df96bb)"],
      ["Dusk","linear-gradient(140deg,#291d55,#8469ba 47%,#f5a6c2)"],
      ["Misty morning","linear-gradient(150deg,#b9d5de,#e8e8db 46%,#84adad)"]
    ];
    return '<h3>Photos</h3><p class="app-lead">A small collection of abstract sample images created in this demo.</p><div class="photo-grid">'+photos.map((p,i)=>'<button type="button" class="photo-tile" data-photo="'+i+'" aria-label="View '+p[0]+'" style="background:'+p[1]+'"></button>').join("")+'</div><p class="photo-caption">Illustrative tiles only — no private photos are accessed.</p><div id="photoPreview" hidden></div>';
  }
  function renderMessages() {
    return '<h3>Messages</h3><p class="app-lead">A local chat preview. Sending here does not send an SMS or contact anyone.</p><div id="messageList" class="message-list">'+messageItems.map(m=>'<div class="message-bubble '+(m.mine?"mine":"theirs")+'">'+escapeHTML(m.text)+'</div>').join("")+'</div><form class="composer" data-form="message"><input id="messageInput" maxlength="500" placeholder="Message" aria-label="Write a demo message" autocomplete="off"><button type="submit" aria-label="Send demo message">↑</button></form><p class="note-saved">Sample messages are stored only in this browser.</p>';
  }
  function renderNotes() {
    const value = load("moina.demo.notes", "");
    return '<h3>Notes</h3><p class="app-lead">A little place for your thoughts.</p><textarea class="app-textarea" id="noteText" maxlength="12000" placeholder="Write a note…">'+escapeHTML(value)+'</textarea><p class="note-saved" id="noteSaveState">Saved locally in this browser.</p><button class="neutral-button full-button" type="button" data-action="clear-note">Clear note</button>';
  }
  function renderCalendar() {
    const month = new Date();
    month.setDate(1);
    month.setMonth(month.getMonth()+calendarOffset);
    const monthName = new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric"}).format(month);
    const offset = month.getDay();
    const days = new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
    const today = dateKey(new Date());
    let grid = ["S","M","T","W","T","F","S"].map(d=>'<div class="calendar-weekday">'+d+'</div>').join("");
    for(let i=0;i<offset;i++) grid += '<button class="calendar-day" disabled aria-hidden="true"></button>';
    for(let day=1;day<=days;day++) {
      const date = new Date(month.getFullYear(),month.getMonth(),day);
      const key = dateKey(date);
      const classes = "calendar-day"+(key===selectedCalendarDate?" is-selected":"")+(key===today?" is-today":"");
      grid += '<button type="button" class="'+classes+'" data-date="'+key+'">'+day+'</button>';
    }
    const todaysEvents = calendarEvents.filter(e=>e.date===selectedCalendarDate);
    return '<h3>Calendar</h3><p class="app-lead">Choose a date and add a local demo event.</p><div class="calendar-top"><strong class="calendar-month">'+monthName+'</strong><div class="calendar-nav"><button type="button" data-calendar-month="-1" aria-label="Previous month">‹</button><button type="button" data-calendar-month="1" aria-label="Next month">›</button></div></div><div class="calendar-grid">'+grid+'</div><h4>'+humanDate(new Date(selectedCalendarDate+"T12:00:00"))+'</h4>'+(todaysEvents.length?todaysEvents.map(e=>'<div class="calendar-event">'+escapeHTML(e.text)+'</div>').join(""):'<p class="app-lead">No events for this day.</p>')+'<form data-form="event"><input class="app-input" name="eventText" maxlength="140" required placeholder="Add an event"><button class="blue-button full-button" type="submit">Add to calendar</button></form><p class="note-saved">Demo events stay in this browser.</p>';
  }
  function renderClock() {
    return '<h3>Clock</h3><p class="app-lead">Local time from your browser.</p><div id="clockLiveDisplay" class="clock-display">--:--</div><div id="phoneStatusDate" class="clock-date">'+humanDate(new Date())+'</div><div class="app-section-label">Stopwatch</div><div id="stopwatchDisplay" class="stopwatch-display">00:00.0</div><div class="stopwatch-controls"><button type="button" class="neutral-button" data-action="stopwatch-reset">Reset</button><button type="button" id="stopwatchStart" class="blue-button" data-action="stopwatch-start">Start</button></div>';
  }
  function renderReminders() {
    return '<h3>Reminders</h3><p class="app-lead">Make a list. Items are kept on this browser only.</p><form data-form="reminder"><input class="app-input" name="reminderText" maxlength="180" required placeholder="What needs doing?"><button class="blue-button full-button" type="submit">Add reminder</button></form><div class="app-section-label">Your list</div><div class="list-card">'+(reminders.length?reminders.map((r,i)=>'<div class="simple-row"><button type="button" class="sim-toggle" role="switch" aria-checked="'+String(Boolean(r.done))+'" data-reminder="'+i+'" aria-label="Mark '+escapeHTML(r.text)+' complete"></button><span class="setting-copy"><strong style="'+(r.done?"text-decoration:line-through;color:#858790":"")+'">'+escapeHTML(r.text)+'</strong></span><button type="button" class="neutral-button" data-delete-reminder="'+i+'" aria-label="Delete reminder">×</button></div>').join(""):'<div class="simple-row"><span class="setting-copy"><strong>Nothing here yet</strong><small>Add your first reminder above.</small></span></div>')+'</div>';
  }
  function renderPhone() {
    return '<h3>Phone</h3><p class="app-lead">Enter a number. Calls are handed to your device and only work where telephony is supported.</p><div class="dial-display" id="dialDisplay">'+(dialNumber||"Enter number")+'</div><div class="dial-grid">'+["1","2","3","4","5","6","7","8","9","*","0","#"].map(n=>'<button class="dial-key" type="button" data-dial="'+n+'">'+n+'</button>').join("")+'</div><div class="stopwatch-controls"><button type="button" class="neutral-button" data-action="dial-clear">Clear</button><button type="button" class="blue-button" data-action="dial-call">Call</button></div><p class="note-saved">No call is placed until you tap Call and your device confirms the handoff.</p>';
  }
  function renderSafari() {
    return '<h3>Browser</h3><p class="app-lead">Search the web or open a website in a new browser tab.</p><form data-form="web-search"><input class="app-input" name="query" required maxlength="220" placeholder="Search or enter a website"><button class="blue-button full-button" type="submit">Open</button></form><div class="app-section-label">Quick links</div><div class="app-link-list"><button class="app-link-row" data-url="https://www.apple.com/"><span class="link-symbol">↗</span><span><strong>Apple</strong><small>Open Apple’s public website</small></span></button><button class="app-link-row" data-url="https://www.google.com/"><span class="link-symbol">⌕</span><span><strong>Search</strong><small>Open a web search</small></span></button></div><p class="note-saved">Websites open outside this simulator; it does not replace your browser.</p>';
  }
  function renderMaps() {
    return '<h3>Maps</h3><p class="app-lead">Open a real map search in a new browser tab. The decorative map below is not live navigation.</p><div style="height:210px;position:relative;overflow:hidden;border-radius:19px;background:linear-gradient(30deg,#bfd9c3,#e4e4cf 34%,#ccdfd8 54%,#e6d8b3)"><span style="position:absolute;inset:-20%;background:repeating-linear-gradient(37deg,transparent 0 23px,rgba(255,255,255,.9) 24px 29px,transparent 30px 55px);transform:rotate(-15deg)"></span><span style="position:absolute;inset:-20%;background:repeating-linear-gradient(120deg,transparent 0 37px,rgba(255,255,255,.8) 38px 42px,transparent 43px 69px);transform:rotate(6deg)"></span><span style="position:absolute;left:51%;top:37%;font-size:37px;color:#ed514e;text-shadow:0 2px 6px #0002">●</span><span style="position:absolute;bottom:12px;left:12px;padding:7px 10px;border-radius:11px;background:#ffffffdc;font-size:10px;color:#555">Illustrative map pattern</span></div><form data-form="map-search"><input class="app-input" name="place" required maxlength="140" placeholder="Search a place"><button class="blue-button full-button" type="submit">Open in Maps</button></form>';
  }
  function renderCamera() {
    return '<h3>Camera</h3><p class="app-lead">Camera access starts only after you press the button and approve the browser permission prompt.</p><div class="camera-stage" id="cameraStage"><div class="camera-placeholder"><div class="camera-lens-demo">◉</div><strong>Camera preview</strong><p>Your camera stays off until you choose to enable the preview. Frames are not uploaded by this demo.</p></div></div><button class="blue-button full-button" type="button" data-action="camera-start">Enable camera preview</button><button class="neutral-button full-button" type="button" data-action="camera-stop">Turn camera off</button><p class="note-saved">Camera access depends on your device, browser and permissions.</p>';
  }
  function renderMusic() {
    return '<h3>Music</h3><p class="app-lead">A tiny local sound preview — no music library or streaming account is connected.</p><div style="display:flex;flex-direction:column;align-items:center;padding:20px 0"><div style="width:170px;height:170px;border-radius:25px;background:linear-gradient(145deg,#fd83b5,#c05ce1 48%,#6973f6);display:grid;place-items:center;color:white;font-size:72px;box-shadow:0 12px 30px #a75fbd33">♫</div><strong style="font-size:17px;margin-top:20px">Little glass tones</strong><span style="color:#898b92;font-size:11px;margin-top:6px">Generated locally · no recording</span><button type="button" class="blue-button full-button" id="musicToggle" data-action="music-toggle" style="max-width:180px;margin-top:22px">'+(musicPlaying?"Stop preview":"Play preview")+'</button></div>';
  }
  function renderMail() {
    return '<h3>Mail</h3><p class="app-lead">Create a draft in the email app configured on your device.</p><div class="settings-group"><div class="settings-row"><span class="setting-icon" style="background:#1685f8">✉</span><span class="setting-copy"><strong>New message</strong><small>Nothing is sent by this page.</small></span></div></div><button type="button" class="blue-button full-button" data-action="compose-mail">Compose email</button>';
  }
  function renderFiles() {
    return '<h3>Files</h3><p class="app-lead">This is a local demo, not a view of your actual device files.</p><div class="settings-group"><div class="settings-row"><span class="setting-icon" style="background:#1685f8">▰</span><span class="setting-copy"><strong>On this demo</strong><small>No uploaded files</small></span></div><div class="settings-row"><span class="setting-icon" style="background:#55a5ee">☁</span><span class="setting-copy"><strong>Cloud storage</strong><small>Not connected</small></span></div></div>';
  }
  function renderStore() {
    return '<h3>Discover</h3><p class="app-lead">Explore the working sample apps in this phone-style concept.</p><div class="app-link-list">'+apps.filter(a=>a.id!=="store").map(a=>'<button type="button" class="app-link-row" data-launch="'+a.id+'"><span class="link-symbol '+a.className+'">'+a.glyph+'</span><span><strong>'+a.name+'</strong><small>'+a.description+'</small></span><span style="margin-left:auto;color:#087df0;font-weight:700">Open</span></button>').join("")+'</div><p class="note-saved">This demo does not install software or copy Apple’s proprietary apps.</p>';
  }

  function renderApp(id) {
    switch(id) {
      case "settings": return renderSettings();
      case "photos": return renderPhotos();
      case "messages": return renderMessages();
      case "notes": return renderNotes();
      case "calendar": return renderCalendar();
      case "clock": return renderClock();
      case "reminders": return renderReminders();
      case "phone": return renderPhone();
      case "safari": return renderSafari();
      case "maps": return renderMaps();
      case "camera": return renderCamera();
      case "music": return renderMusic();
      case "mail": return renderMail();
      case "files": return renderFiles();
      case "store": return renderStore();
      default: return '<h3>'+escapeHTML(apps.find(a=>a.id===id)?.name || "App")+'</h3><p class="app-lead">This demo app is available for preview.</p>';
    }
  }
  function openApp(id) {
    closePanels();
    if (id === "askmoina") { openAskMoina(); return; }
    closeApp();
    currentApp = id;
    const definition = apps.find(app=>app.id===id);
    appTitle.textContent = definition ? definition.name : "App";
    appContent.innerHTML = renderApp(id);
    appSheet.hidden = false;
    updateTime();
    if (id === "clock") {
      stopwatchElapsed = 0;
      updateStopwatch();
    }
  }
  function updateStopwatch() {
    const display = $("#stopwatchDisplay");
    if (!display) return;
    const elapsed = stopwatchElapsed + (stopwatchTimer ? Date.now() - stopwatchStarted : 0);
    const tenths = Math.floor(elapsed/100)%10;
    const seconds = Math.floor(elapsed/1000)%60;
    const minutes = Math.floor(elapsed/60000);
    display.textContent = String(minutes).padStart(2,"0")+":"+String(seconds).padStart(2,"0")+"."+tenths;
    const button = $("#stopwatchStart");
    if (button) button.textContent = stopwatchTimer ? "Pause" : "Start";
  }
  function renderSearch(query) {
    const host = $("#searchResults");
    if (!host) return;
    const norm = query.trim().toLowerCase();
    const matches = apps.filter(app => !norm || app.name.toLowerCase().includes(norm) || app.description.toLowerCase().includes(norm));
    host.innerHTML = matches.map(app=>'<button type="button" class="search-result" data-launch="'+app.id+'"><span class="app-art '+app.className+'">'+escapeHTML(app.glyph)+'</span><span class="app-label">'+escapeHTML(app.name)+'</span></button>').join("") || '<p class="app-lead" style="grid-column:1/-1">No matching apps.</p>';
  }
  function externalOpen(value) {
    const raw = String(value || "").trim();
    if (!raw) return;
    let url;
    try {
      if (/^https?:\/\//i.test(raw)) url = new URL(raw);
      else if (/^[a-z0-9.-]+\\.[a-z]{2,}([/:?#].*)?$/i.test(raw) && !/\\s/.test(raw)) url = new URL("https://" + raw);
      else url = new URL("https://www.google.com/search?q=" + encodeURIComponent(raw));
      if (!["http:","https:"].includes(url.protocol)) throw new Error("Invalid URL");
      window.open(url.href,"_blank","noopener,noreferrer");
    } catch (_) {
      window.open("https://www.google.com/search?q="+encodeURIComponent(raw),"_blank","noopener,noreferrer");
    }
  }
  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraError("Camera preview is not available in this browser. Try a recent browser over HTTPS.");
      return;
    }
    navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false}).then(stream=>{
      cameraStream = stream;
      const stage = $("#cameraStage");
      if (!stage) { closeCamera(); return; }
      stage.innerHTML = '<video id="cameraVideo" autoplay playsinline muted></video>';
      const video = $("#cameraVideo",stage);
      if (video) video.srcObject = stream;
    }).catch(error=>{
      const name = error && error.name;
      showCameraError(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser settings and retry." : "Could not open the camera on this device.");
    });
  }
  function showCameraError(message) {
    const stage = $("#cameraStage");
    if (stage) stage.innerHTML = '<div class="camera-placeholder"><div class="camera-lens-demo">◉</div><strong>Camera unavailable</strong><p>'+escapeHTML(message)+'</p></div>';
  }
  function stopCameraUI() {
    closeCamera();
    const stage = $("#cameraStage");
    if (stage) stage.innerHTML = '<div class="camera-placeholder"><div class="camera-lens-demo">◉</div><strong>Camera preview off</strong><p>Tap Enable camera preview when you are ready.</p></div>';
  }
  function startMusic() {
    if (musicPlaying) { stopMusic(); if (currentApp==="music") appContent.innerHTML=renderMusic(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { alert("Audio preview is not supported in this browser."); return; }
    try {
      musicContext = new Ctx();
      musicGain = musicContext.createGain();
      musicGain.gain.value = .035;
      musicGain.connect(musicContext.destination);
      musicOscillator = musicContext.createOscillator();
      musicOscillator.type = "sine";
      musicOscillator.frequency.value = 392;
      musicOscillator.connect(musicGain);
      musicOscillator.start();
      musicPlaying = true;
      musicToneTimer = window.setInterval(()=>{
        if (musicOscillator && musicContext) {
          const tones = [392,440,523.25,440,349.23,392];
          musicOscillator.frequency.setTargetAtTime(tones[Math.floor(Date.now()/420)%tones.length],musicContext.currentTime,.04);
        }
      },420);
      if (currentApp==="music") appContent.innerHTML=renderMusic();
    } catch (_) {
      stopMusic();
      if (currentApp==="music") appContent.innerHTML=renderMusic();
    }
  }
  function updateDial() {
    const display=$("#dialDisplay");
    if(display) display.textContent=dialNumber || "Enter number";
  }
  function saveMessages() {
    save("moina.demo.messages",messageItems);
  }

  document.addEventListener("click", event => {
    const appButton = event.target.closest("[data-app]");
    if (appButton && phoneOS.contains(appButton)) {
      event.preventDefault();
      openApp(appButton.dataset.app);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (action && phoneOS.contains(action)) {
      const name = action.dataset.action;
      if(name==="control-center") openPanel("control");
      else if(name==="notifications") openPanel("notifications");
      else if(name==="search") openPanel("search");
      else if(name==="close-panel") closePanels();
      else if(name==="close-search") { searchPanel.hidden=true; searchActive=false; }
      else if(name==="close-app") closeApp();
      else if(name==="hide-photo"){ const preview=$("#photoPreview"); if(preview){preview.hidden=true;preview.innerHTML="";} }
      else if(name==="home") goHome();
      else if(name==="clear-note") { save("moina.demo.notes",""); appContent.innerHTML=renderNotes(); }
      else if(name==="camera-start") startCamera();
      else if(name==="camera-stop") stopCameraUI();
      else if(name==="stopwatch-start") {
        if(stopwatchTimer){ stopwatchElapsed += Date.now()-stopwatchStarted; clearInterval(stopwatchTimer); stopwatchTimer=null; }
        else { stopwatchStarted=Date.now(); stopwatchTimer=window.setInterval(updateStopwatch,100); }
        updateStopwatch();
      }
      else if(name==="stopwatch-reset"){ stopwatchElapsed=0; stopwatchStarted=Date.now(); updateStopwatch(); }
      else if(name==="dial-clear"){ dialNumber=""; updateDial(); }
      else if(name==="dial-call"){
        if(!dialNumber){ sayDemo("Enter a number first."); return; }
        window.location.href="tel:"+dialNumber.replace(/[^0-9+*#]/g,"");
      }
      else if(name==="compose-mail") window.location.href="mailto:?subject="+encodeURIComponent("Hello");
      else if(name==="music-toggle") startMusic();
      return;
    }
    const setting = event.target.closest("[data-setting]");
    if(setting && phoneOS.contains(setting)){
      toggleSetting(setting.dataset.setting);
      return;
    }
    const quick = event.target.closest("[data-toggle]");
    if(quick && phoneOS.contains(quick)){
      toggleSetting(quick.dataset.toggle);
      return;
    }
    const launch = event.target.closest("[data-launch]");
    if(launch && phoneOS.contains(launch)){
      openApp(launch.dataset.launch);
      return;
    }
    const photo = event.target.closest("[data-photo]");
    if(photo && phoneOS.contains(photo)){
      const photos = [
        ["Aurora","linear-gradient(150deg,#14244b,#729dd9 36%,#f4c2db 68%,#fdf3dd)"],
        ["Afterglow","linear-gradient(135deg,#ea8f98,#f0c8ab 44%,#5b638f)"],
        ["Ocean","linear-gradient(165deg,#172f68,#297da7 45%,#91dfdb)"],
        ["Wildflower","radial-gradient(circle at 25% 30%,#ffdf91 0 5%,transparent 6%),radial-gradient(circle at 65% 58%,#b7f0df 0 12%,transparent 13%),linear-gradient(140deg,#719f7e,#e0ccba,#df96bb)"],
        ["Dusk","linear-gradient(140deg,#291d55,#8469ba 47%,#f5a6c2)"],
        ["Misty morning","linear-gradient(150deg,#b9d5de,#e8e8db 46%,#84adad)"]
      ];
      const item=photos[Number(photo.dataset.photo)];
      const preview=$("#photoPreview");
      if(preview && item) {
        preview.hidden=false;
        preview.innerHTML='<div class="photo-preview" style="--preview:'+item[1]+'">'+item[0]+'</div><button type="button" class="neutral-button full-button" data-action="hide-photo">Back to gallery</button>';
      }
      return;
    }
    if(action && action.dataset.action==="hide-photo" && phoneOS.contains(action)){
      const preview=$("#photoPreview"); if(preview){preview.hidden=true;preview.innerHTML="";}
      return;
    }
    const dateButton = event.target.closest("[data-date]");
    if(dateButton && phoneOS.contains(dateButton)){
      selectedCalendarDate=dateButton.dataset.date;
      appContent.innerHTML=renderCalendar();
      return;
    }
    const monthButton=event.target.closest("[data-calendar-month]");
    if(monthButton && phoneOS.contains(monthButton)){
      calendarOffset += Number(monthButton.dataset.calendarMonth);
      const month=new Date();month.setDate(1);month.setMonth(month.getMonth()+calendarOffset);
      if(calendarOffset===0) selectedCalendarDate=dateKey(new Date());
      else selectedCalendarDate=dateKey(new Date(month.getFullYear(),month.getMonth(),1));
      appContent.innerHTML=renderCalendar();
      return;
    }
    const reminderCheck=event.target.closest("[data-reminder]");
    if(reminderCheck && phoneOS.contains(reminderCheck)){
      const index=Number(reminderCheck.dataset.reminder);
      if(reminders[index]){reminders[index].done=!reminders[index].done;save("moina.demo.reminders",reminders);appContent.innerHTML=renderReminders();}
      return;
    }
    const reminderDelete=event.target.closest("[data-delete-reminder]");
    if(reminderDelete && phoneOS.contains(reminderDelete)){
      reminders.splice(Number(reminderDelete.dataset.deleteReminder),1);save("moina.demo.reminders",reminders);appContent.innerHTML=renderReminders();return;
    }
    const dial=event.target.closest("[data-dial]");
    if(dial && phoneOS.contains(dial)){dialNumber+=dial.dataset.dial;updateDial();return;}
    const urlButton=event.target.closest("[data-url]");
    if(urlButton && phoneOS.contains(urlButton)){externalOpen(urlButton.dataset.url);return;}
    if(searchActive && !event.target.closest(".search-sheet") && !event.target.closest("[data-action='search']")) {
      searchPanel.hidden=true;searchActive=false;
    }
    if(controlCenter && !controlCenter.hidden && !event.target.closest("#controlCenter") && !event.target.closest("[data-action='control-center']")) controlCenter.hidden=true;
    if(notificationCenter && !notificationCenter.hidden && !event.target.closest("#notificationCenter") && !event.target.closest("[data-action='notifications']")) notificationCenter.hidden=true;
  });

  function sayDemo(message) {
    const old=$("#dialDisplay");
    if(old){old.textContent=message;window.setTimeout(updateDial,1500);}
  }

  appContent.addEventListener("click",event=>{
    const toggle=event.target.closest("[data-setting]");
    if(toggle){toggleSetting(toggle.dataset.setting);return;}
  });
  appContent.addEventListener("input",event=>{
    if(event.target && event.target.id==="noteText"){
      const saved=save("moina.demo.notes",event.target.value);
      const status=$("#noteSaveState");
      if(status) status.textContent=saved?"Saved locally in this browser.":"Browser storage is unavailable; this note may not persist.";
    }
  });
  appContent.addEventListener("submit",event=>{
    const form=event.target.closest("form[data-form]");
    if(!form)return;
    event.preventDefault();
    const type=form.dataset.form;
    const data=new FormData(form);
    if(type==="message"){
      const text=String(data.get("messageInput")||$("#messageInput")?.value||"").trim();
      const input=$("#messageInput");
      const value=(input?input.value:String(data.get("messageInput")||"")).trim();
      if(!value)return;
      messageItems.push({mine:true,text:value,time:"Now"});
      messageItems=messageItems.slice(-80);
      saveMessages();
      const scroll=$(".app-content");
      appContent.innerHTML=renderMessages();
      if(scroll) appContent.scrollTop=appContent.scrollHeight;
      return;
    }
    if(type==="event"){
      const value=String(data.get("eventText")||"").trim();
      if(!value)return;
      calendarEvents.push({date:selectedCalendarDate,text:value});
      save("moina.demo.events",calendarEvents);
      appContent.innerHTML=renderCalendar();
      return;
    }
    if(type==="reminder"){
      const value=String(data.get("reminderText")||"").trim();
      if(!value)return;
      reminders.push({text:value,done:false});
      save("moina.demo.reminders",reminders);
      appContent.innerHTML=renderReminders();
      return;
    }
    if(type==="web-search"){
      externalOpen(String(data.get("query")||""));
      return;
    }
    if(type==="map-search"){
      const place=String(data.get("place")||"").trim();
      if(place)window.open("https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(place),"_blank","noopener,noreferrer");
    }
  });

  if(searchInput)searchInput.addEventListener("input",()=>renderSearch(searchInput.value));
  $("#returnHome")?.addEventListener("click",goHome);
  $("#homeIndicator")?.addEventListener("click",goHome);
  const brightness=$("#brightnessSlider");
  if(brightness)brightness.addEventListener("input",()=>{
    const value=Number(brightness.value);
    phoneScreen.style.setProperty("--screen-brightness",String(value/100));
    const label=$("#brightnessLabel");if(label)label.textContent=value+"%";
  });

  phoneScreen.addEventListener("touchstart",event=>{
    const touch=event.changedTouches[0];touchStartX=touch.clientX;touchStartY=touch.clientY;
  },{passive:true});
  phoneScreen.addEventListener("touchend",event=>{
    if(touchStartX===null||touchStartY===null)return;
    const touch=event.changedTouches[0],dx=touch.clientX-touchStartX,dy=touch.clientY-touchStartY;
    if(dy>75 && touchStartY<125 && touchStartX>phoneScreen.clientWidth*.62) openPanel("control");
    else if(dy>80 && touchStartY<100 && touchStartX<phoneScreen.clientWidth*.38) openPanel("notifications");
    else if(dy>95 && touchStartY>phoneScreen.clientHeight-100) goHome();
    else if(dy<-80 && touchStartY>phoneScreen.clientHeight-120) goHome();
    touchStartX=null;touchStartY=null;
  },{passive:true});
  window.addEventListener("keydown",event=>{
    if(event.key==="Escape"){
      if(!searchPanel.hidden){searchPanel.hidden=true;searchActive=false;}
      else if(!controlCenter.hidden||!notificationCenter.hidden)closePanels();
      else if(!appSheet.hidden)closeApp();
      else if(!phoneOS.hidden)goHome();
    }
  });
  window.addEventListener("pagehide",()=>{closeCamera();stopMusic();});
  updateTime();
  window.setInterval(updateTime,1000);
  updateControlToggles();
})();