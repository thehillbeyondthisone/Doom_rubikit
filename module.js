// module.js — adds *default recursive scan* of RubiKit/modules/doom via same-origin HTTP,
// falls back to the existing Pick Folder flow. Only this file changed.

(() => {
  const $ = (s, c=document) => c.querySelector(s);
  const $$ = (s, c=document) => Array.from(c.querySelectorAll(s));

  const frame = $("#frame");
  const btnPower = $("#btnPower");
  const btnFullscreen = $("#btnFullscreen");
  const btnSettings = $("#btnSettings");
  const drawer = $("#settings");
  const btnCloseSettings = $("#btnCloseSettings");

  const chips = $$(".chip");
  const portPathInput = $("#portPath");
  const btnPickFolder = $("#btnPickFolder");
  const inputDir = $("#inputDir");
  const folderStatus = $("#folderStatus");
  const exeSelect = $("#exeSelect");
  const wadSelect = $("#wadSelect");
  const autostartInput = $("#autostart");
  const btnRescan = $("#btnRescan");
  const btnTestStart = $("#btnTestStart");
  const btnOpenEngineIndex = $("#btnOpenEngineIndex");

  const LS = "rk-doom-runner-v2";
  const defaults = {
    theme: "notum-blue",
    portPath: "engine/ports/jsdos/index.html",
    autostart: true,
    exePick: null,        // { name, path, handle?|file?|url? }
    wadPick: null,        // { name, path, handle?|file?|url? }
    hasHandle: false,
    onboarded: false,
    scaleMode: "fit",     // "fit" | "2x" | "4x"
  };
  const state = Object.assign({}, defaults, JSON.parse(localStorage.getItem(LS) || "{}"));
  const persist = () => localStorage.setItem(LS, JSON.stringify(state));

  function applyTheme(name){
    document.body.classList.remove("theme-notum-blue","theme-onyx","theme-monokai");
    document.body.classList.add("theme-" + name);
    chips.forEach(c => c.classList.toggle("selected", c.dataset.theme === name));
    state.theme = name; persist();
  }

  // init
  applyTheme(state.theme);
  portPathInput.value = state.portPath;
  autostartInput.checked = !!state.autostart;

  // drawer
  btnSettings.addEventListener("click", async ()=> { drawer.classList.add("open"); await quickScan(); });
  btnCloseSettings.addEventListener("click", ()=> drawer.classList.remove("open"));
  chips.forEach(ch => ch.addEventListener("click", ()=> applyTheme(ch.dataset.theme)));
  portPathInput.addEventListener("change", ()=> { state.portPath = portPathInput.value.trim(); persist(); });
  autostartInput.addEventListener("change", ()=> { state.autostart = autostartInput.checked; persist(); });
  btnOpenEngineIndex.addEventListener("click", ()=> openPort("engine/index.html"));
  btnFullscreen.addEventListener("click", ()=> {
    const host = $(".engine-host");
    if (!document.fullscreenElement && host?.requestFullscreen) host.requestFullscreen();
  });

  // ---------- Compact resolution selector (Fit / 2× / 4×)
  (function injectScaleControls(){
    if (!drawer || $("#scaleMode")) return;
    const row = document.createElement("div");
    row.className = "form-row";
    row.innerHTML = `
      <label for="scaleMode" class="label">Resolution</label>
      <select id="scaleMode" class="input">
        <option value="fit">Fit to window</option>
        <option value="2x">2× (640×480)</option>
        <option value="4x">4× (1280×960)</option>
      </select>
    `;
    drawer.appendChild(row);
    const sel = $("#scaleMode");
    sel.value = (["fit","2x","4x"].includes(state.scaleMode) ? state.scaleMode : "fit");
    sel.addEventListener("change", () => {
      state.scaleMode = sel.value; persist();
      fitFrame(true);
    });
  })();

  // -------------------- Folder scan & persistence
  const EXE_REGEX = /(DOOM|DOOM1|DOOM2)\.EXE$/i;
  const WAD_REGEX = /(DOOM|DOOM1|DOOM2|FREEDOOM1|FREEDOOM2|FREEDOOM)\.WAD$/i;

  let dirHandle=null, fileIndex=[], exeList=[], wadList=[];

  function indexFromFileList(files){
    fileIndex=[]; exeList=[]; wadList=[];
    files.forEach(f => {
      const path = f.webkitRelativePath || f.name;
      const name = path.split("/").pop();
      const rec = { name, path, file: f };
      fileIndex.push(rec);
      if (EXE_REGEX.test(name)) exeList.push(rec);
      if (WAD_REGEX.test(name)) wadList.push(rec);
    });
  }

  async function scanWithHandle(root){
    fileIndex=[]; exeList=[]; wadList=[];
    async function walk(dir, prefix=""){
      for await (const entry of dir.values()){
        try{
          if (entry.kind === "file"){
            const path = prefix + entry.name;
            const name = entry.name;
            const rec = { name, path, handle: entry };
            fileIndex.push(rec);
            if (EXE_REGEX.test(name)) exeList.push(rec);
            if (WAD_REGEX.test(name)) wadList.push(rec);
          } else if (entry.kind === "directory"){
            await walk(entry, prefix + entry.name + "/");
          }
        }catch{}
      }
    }
    await walk(root, "");
  }

  // ---------- NEW: Same-origin HTTP recursive scan of /RubiKit/modules/doom at boot
  async function tryServerScanDefault(){
    // Derive base to /RubiKit/
    const path = location.pathname;
    const ix = path.toLowerCase().indexOf("/rubikit/");
    const base = ix >= 0 ? path.slice(0, ix + "/rubikit/".length) : "/RubiKit/";
    const doomRoot = new URL("modules/doom/", new URL(base, location.origin)).toString();

    // Helpers
    const tryFetchJson = async (p) => {
      try{
        const res = await fetch(p, { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) return null;
        return await res.json();
      }catch{ return null; }
    };
    const headExists = async (p) => {
      try{
        const r = await fetch(p, { method: "HEAD", credentials: "same-origin", cache: "no-store" });
        return r.ok;
      }catch{ return false; }
    };

    // Strategy:
    // 1) Try list files from a known JSON (any of these names work):
    const catalogs = ["files.json","manifest.json","doom.files.json","dir.json","list.json"];
    let listing = null;
    for (const name of catalogs){
      const url = doomRoot + name;
      const j = await tryFetchJson(url);
      if (j && (Array.isArray(j) || Array.isArray(j.files))) { listing = Array.isArray(j) ? j : j.files; break; }
    }

    // 2) If no catalog, probe a few common filenames w/ case variants (cheap + safe).
    if (!listing){
      const candidates = [
        "DOOM/DOOM.EXE","DOOM/DOOM1.EXE","DOOM/DOOM2.EXE","DOOM.EXE","DOOM1.EXE","DOOM2.EXE",
        "WADS/DOOM.WAD","WADS/DOOM1.WAD","WADS/DOOM2.WAD","DOOM.WAD","DOOM1.WAD","DOOM2.WAD",
        "FREEDOOM/FREEDOOM1.WAD","FREEDOOM/FREEDOOM2.WAD","freedoom1.wad","freedoom2.wad"
      ];
      const found = [];
      for (const rel of candidates){
        const tryUrls = [rel, rel.toLowerCase(), rel.toUpperCase()];
        for (const r of tryUrls){
          const u = doomRoot + r;
          if (await headExists(u)) { found.push(r); break; }
        }
      }
      listing = found;
    }

    if (!listing || !listing.length) return false;

    // Build exe/wad indexes from the listing
    fileIndex=[]; exeList=[]; wadList=[];
    for (const rel of listing){
      const name = String(rel).split("/").pop();
      const url = doomRoot + rel;
      const rec = { name, path: rel, url };
      fileIndex.push(rec);
      if (EXE_REGEX.test(name)) exeList.push(rec);
      if (WAD_REGEX.test(name)) wadList.push(rec);
    }

    if (!exeList.length && !wadList.length) return false;

    buildSelects();
    // If nothing picked yet, auto-pick the first detected pair
    if (!state.exePick && exeList[0]) state.exePick = { name: exeList[0].name, path: exeList[0].path };
    if (!state.wadPick && wadList[0]) state.wadPick = { name: wadList[0].name, path: wadList[0].path };
    persist();
    folderStatus.textContent = `Scanned RubiKit/modules/doom (HTTP) — ${exeList.length} EXEs, ${wadList.length} WADs`;
    return true;
  }

  function buildSelects(){
    // EXE
    exeSelect.innerHTML = exeList.length ? "" : `<option value="">(none detected)</option>`;
    exeList.forEach((rec, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = rec.path;
      exeSelect.appendChild(opt);
    });
    // WAD
    wadSelect.innerHTML = wadList.length ? "" : `<option value="">(none detected)</option>`;
    wadList.forEach((rec, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = rec.path;
      wadSelect.appendChild(opt);
    });

    // Reselect saved picks if present
    if (state.exePick){
      const idx = exeList.findIndex(r => r.path === state.exePick.path);
      if (idx >= 0) exeSelect.value = String(idx);
    }
    if (state.wadPick){
      const idx = wadList.findIndex(r => r.path === state.wadPick.path);
      if (idx >= 0) wadSelect.value = String(idx);
    }

    const found = `${exeList.length} EXEs, ${wadList.length} WADs`;
    folderStatus.textContent = (state.hasHandle || inputDir.files?.length) ? `Scanned: ${found}` : `No folder selected (${found})`;
  }

  function updatePicksFromSelects(){
    const ei = parseInt(exeSelect.value, 10);
    state.exePick = Number.isFinite(ei) && exeList[ei] ? { name: exeList[ei].name, path: exeList[ei].path } : null;

    const wi = parseInt(wadSelect.value, 10);
    state.wadPick = Number.isFinite(wi) && wadList[wi] ? { name: wadList[wi].name, path: wadList[wi].path } : null;

    if (state.exePick && state.wadPick) { state.onboarded = true; }
    persist();
  }

  exeSelect.addEventListener("change", updatePicksFromSelects);
  wadSelect.addEventListener("change", updatePicksFromSelects);

  async function quickScan(){
    // NEW: try HTTP scan of RubiKit/modules/doom first
    const ok = await tryServerScanDefault();
    if (ok) return;

    // If we have a saved directory handle, prefer that
    if (dirHandle) {
      try {
        const perm = await dirHandle.queryPermission({ mode: "read" });
        if (perm !== "granted") await dirHandle.requestPermission({ mode: "read" });
      } catch {}
      try {
        await scanWithHandle(dirHandle);
        buildSelects();
        return;
      } catch {}
    }
    // Otherwise, try to restore handle from IDB
    if (window.showDirectoryPicker){
      const h = await loadHandle();
      if (h){
        try{
          const perm = await h.queryPermission({ mode: "read" });
          if (perm === "granted" || (await h.requestPermission({ mode: "read" })) === "granted"){
            dirHandle = h; state.hasHandle = true; persist();
            await scanWithHandle(dirHandle);
            buildSelects();
            return;
          }
        }catch{}
      }
    }
    // Fallback: if user had picked via webkitdirectory, reuse that temporary list
    if (inputDir.files?.length) {
      indexFromFileList(Array.from(inputDir.files));
      buildSelects();
    }
  }

  async function pickFolder(){
    if (window.showDirectoryPicker) {
      try {
        const h = await window.showDirectoryPicker({ id: "doom-folder", mode: "read" });
        dirHandle = h; state.hasHandle = true; persist();
        await saveHandle(h);
        await scanWithHandle(h);
        buildSelects(); updatePicksFromSelects();
        return;
      } catch {}
    }
    // Fallback
    inputDir.click();
  }
  btnPickFolder.addEventListener("click", pickFolder);

  inputDir.addEventListener("change", async (ev) => {
    const files = Array.from(ev.target.files || []);
    folderStatus.textContent = files.length ? `Selected ${files.length} files (temporary)` : "No folder selected";
    indexFromFileList(files);
    buildSelects(); updatePicksFromSelects();
  });

  btnRescan.addEventListener("click", quickScan);

  // -------------------- Persist directory handle in IDB
  const DB_NAME = "rk-doom"; const STORE = "handles"; let idb = null;
  async function openDB(){ return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
  async function saveHandle(handle){ try{ idb=idb||await openDB(); await new Promise((res,rej)=>{const tx=idb.transaction(STORE,"readwrite");tx.objectStore(STORE).put(handle,"dir");tx.oncomplete=res;tx.onerror=()=>rej(tx.error);}); }catch{} }
  async function loadHandle(){ try{ idb=idb||await openDB(); return await new Promise((res,rej)=>{const tx=idb.transaction(STORE,"readonly");const req=tx.objectStore(STORE).get("dir");req.onsuccess=()=>res(req.result||null);req.onerror=()=>rej(req.error);}); }catch{ return null; } }

  async function resolvePathHandle(dir, relPath){
    const parts = relPath.split("/").filter(Boolean);
    let cur = dir;
    for (let i=0;i<parts.length;i++){
      const name = parts[i];
      if (i===parts.length-1){ return await cur.getFileHandle(name); }
      else { cur = await cur.getDirectoryHandle(name); }
    }
  }

  // On load: try to restore handle & rebind saved picks
  (async () => {
    if (window.showDirectoryPicker){
      const h = await loadHandle();
      if (h){
        try{
          const perm = await h.queryPermission({ mode:"read" });
          if (perm==="granted" || (await h.requestPermission({mode:"read"}))==="granted"){
            dirHandle = h; state.hasHandle=true; persist();
            await scanWithHandle(dirHandle); buildSelects();

            if (state.exePick) {
              try { const fh=await resolvePathHandle(dirHandle,state.exePick.path); const rec={ name:state.exePick.name,path:state.exePick.path,handle:fh };
                const i=exeList.findIndex(r=>r.path===rec.path); if(i>=0) exeList[i]=rec; else exeList.unshift(rec); } catch {}
            }
            if (state.wadPick) {
              try { const fh=await resolvePathHandle(dirHandle,state.wadPick.path); const rec={ name:state.wadPick.name,path:state.wadPick.path,handle:fh };
                const i=wadList.findIndex(r=>r.path===rec.path); if(i>=0) wadList[i]=rec; else wadList.unshift(rec); } catch {}
            }
            buildSelects();
          }
        }catch{}
      }
    }
  })();

  // -------------------- Sizing (Fit / 2× / 4×)
  const BASE_W=320, BASE_H=240, AR=4/3;
  const getContainer = () => $(".engine-host") || frame?.parentElement || document.body;

  function visibleContentBox(el){
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft||0)+parseFloat(cs.paddingRight||0);
    const padY = parseFloat(cs.paddingTop||0)+parseFloat(cs.paddingBottom||0);
    const maxW = Math.max(0, Math.min(rect.width, window.innerWidth - rect.left)) - padX;
    const maxH = Math.max(0, Math.min(rect.height, window.innerHeight - rect.top)) - padY;
    return { w: Math.floor(maxW), h: Math.floor(maxH) };
  }

  function computeSize(mode, availW, availH){
    if (mode === "fit"){
      let w = Math.floor(availW), h = Math.floor(w / AR);
      if (h > availH) { h = Math.floor(availH); w = Math.floor(h * AR); }
      return { w, h };
    }
    const mult = mode === "4x" ? 4 : 2;
    let w = BASE_W * mult, h = BASE_H * mult;
    if (w > availW || h > availH){
      return computeSize("fit", availW, availH); // graceful fallback
    }
    return { w, h };
  }

  function applyInnerPortNudge(){
    try{
      const cw = frame.contentWindow;
      const cd = frame.contentDocument;
      cw?.dispatchEvent(new Event("resize"));
      if (cd && !cd.getElementById("rk-fit-style")){
        const st = cd.createElement("style");
        st.id = "rk-fit-style";
        st.textContent = `
          html, body { width:100%; height:100%; margin:0; box-sizing:border-box; }
          canvas, #canvas, .dosbox-container, .emulator, #root, #app {
            width:100% !important; height:100% !important; box-sizing:border-box;
            image-rendering: pixelated; image-rendering: crisp-edges;
          }
        `;
        (cd.head || cd.documentElement).appendChild(st);
      }
    }catch{}
  }

  function fitFrame(){
    if (!frame) return;
    const container = getContainer();
    if (!container) return;
    const { w:vw, h:vh } = visibleContentBox(container);
    if (vw<=0 || vh<=0) return;

    const mode = state.scaleMode || "fit";
    const { w, h } = computeSize(mode, vw, vh);

    frame.style.display = "block";
    frame.style.width   = w + "px";
    frame.style.height  = h + "px";
    frame.style.maxWidth = "100%";
    frame.style.maxHeight= "100%";
    frame.style.margin  = "0 auto";

    applyInnerPortNudge();
  }

  let ro;
  function bindFitObservers(){
    if (ro) return;
    const container = getContainer();
    if (!container) return;
    ro = new ResizeObserver(() => fitFrame());
    ro.observe(container);
    window.addEventListener("resize", fitFrame, { passive:true });
    frame?.addEventListener("load", () => {
      requestAnimationFrame(fitFrame);
      setTimeout(fitFrame, 80);
      setTimeout(fitFrame, 200);
    }, { passive:true });
  }

  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  function firstFitSoon(){
    requestAnimationFrame(() => {
      fitFrame();
      requestAnimationFrame(fitFrame);
    });
    fontsReady.then(()=>requestAnimationFrame(fitFrame));
  }

  // -------------------- Power control
  let powerOn=false;
  function setPowerUI(on){
    powerOn = on;
    btnPower.textContent = on ? "⭘ Power Off" : "⏻ Power";
    btnPower.classList.toggle("ghost", on);
  }
  const openPort = (path)=>{ frame.src = path; };

  async function readEntry(rec){
    if (rec.handle){ const f=await rec.handle.getFile(); return { name: rec.name.toUpperCase(), bytes: new Uint8Array(await f.arrayBuffer()) }; }
    if (rec.file){ const b=await rec.file.arrayBuffer(); return { name: rec.name.toUpperCase(), bytes: new Uint8Array(b) }; }
    // NEW: allow server-side URLs discovered by tryServerScanDefault()
    if (rec.url){
      const res = await fetch(rec.url, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error("HTTP fetch failed for " + rec.url);
      const buf = await res.arrayBuffer();
      return { name: rec.name.toUpperCase(), bytes: new Uint8Array(buf) };
    }
    throw new Error("No readable handle for " + rec.path);
  }

  async function powerStart(){
    await quickScan();
    const port = (state.portPath || portPathInput.value || defaults.portPath).trim();
    if (!state.exePick || !state.wadPick){ drawer.classList.add("open"); alert("Pick a folder and choose EXE/WAD in Settings first."); return; }

    let _exe = exeList.find(r=>r.path===state.exePick.path) || exeList[0];
    let _wad = wadList.find(r=>r.path===state.wadPick.path) || wadList[0];
    if (!_exe || !_wad){ drawer.classList.add("open"); alert("Couldn’t locate your EXE/WAD. Please rescan/pick again."); return; }

    fitFrame(); // pre-fit
    openPort(port);

    const once=(t,fn)=>{const h=(e)=>{if(e.source===frame.contentWindow){window.removeEventListener(t,h);fn(e);}};window.addEventListener(t,h);};
    once("message", async (e)=>{
      if (!e.data || e.data.type!=="jsdos-ready") return;
      try{
        const exe=await readEntry(_exe);
        const wad=await readEntry(_wad);
        frame.contentWindow.postMessage({
          type:"jsdos-start",
          exeName:exe.name,
          exeData:exe.bytes.buffer,
          wadName:"DOOM.WAD",
          wadData:wad.bytes.buffer
        },"*",[exe.bytes.buffer, wad.bytes.buffer]);
        setPowerUI(true);
        requestAnimationFrame(fitFrame);
      }catch(err){ console.error(err); alert("Could not read files. Re-pick folder if needed."); }
    });
  }

  function powerStop(){
    try { frame.contentWindow?.postMessage({ type:"jsdos-exit" }, "*"); } catch {}
    setTimeout(()=>{ frame.src="about:blank"; setPowerUI(false); }, 200);
  }

  btnPower.addEventListener("click", async ()=>{ if (!powerOn) await powerStart(); else powerStop(); });
  btnTestStart.addEventListener("click", powerStart);

  // -------------------- Boot
  window.addEventListener("DOMContentLoaded", async ()=>{
    bindFitObservers();
    firstFitSoon();
    // Kick a background attempt to pre-scan RubiKit/modules/doom so the user can just hit Power.
    await tryServerScanDefault();
    if (!state.onboarded) { drawer.classList.add("open"); }
    if (state.autostart && state.onboarded) { await powerStart(); }
  });
})();
