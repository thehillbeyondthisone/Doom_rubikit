(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const engineList = $("#engineList");
  const runnerFrame = $("#runnerFrame");
  const engCount = $("#engCount");
  const iwadHint = $("#iwadHint");
  const btnHelp = $("#btnHelp");
  const btnFullscreen = $("#btnFullscreen");

  // Your known port locations (add as needed)
  const candidates = [
    { id: "minishim", name: "MiniShim (Auto IWAD → Crispy)", path: "ports/minishim/index.html", supportsQuery: true },
    { id: "jsdos",    name: "js-dos (DOS DOOM.EXE)",         path: "ports/jsdos/index.html",     supportsQuery: false },
    { id: "crispy",   name: "Crispy Doom (WASM)",            path: "ports/crispy/index.html",    supportsQuery: true },
    { id: "prboom",   name: "PrBoom+ (WASM)",                path: "ports/prboom/index.html",    supportsQuery: true },
    { id: "gzdoom",   name: "GZDoom (WASM)",                 path: "ports/gzdoom/index.html",    supportsQuery: true },
    { id: "choco",    name: "Chocolate Doom (WASM)",         path: "ports/chocolate/index.html", supportsQuery: true }
  ];

  const iwadNames = ["doom.wad", "doom2.wad", "freedoom2.wad", "freedoom1.wad", "freedoom.wad"];

  // Robust "exists" that works in more environments than HEAD:
  async function exists(url) {
    try {
      // Try a GET first (works on more hosts than HEAD). We don’t need the body; we’ll just look at ok/status.
      const r = await fetch(url, { method: "GET", cache: "no-store" });
      // ok for 2xx; some file:// contexts report status 0 => treat as present if no exception thrown.
      return r.ok || r.status === 0;
    } catch {
      // Some environments (file://) disallow fetch entirely; treat as "unknown", not "absent".
      // We’ll still show the card so the user can try launching manually.
      return null; // null = unknown
    }
  }

  async function detectPorts() {
    const results = [];
    for (const c of candidates) {
      const ex = await exists(c.path);
      results.push({ ...c, present: ex === true || ex === null }); // present if explicitly true OR unknown
    }
    return results;
  }

  async function detectIWAD() {
    // Probe for common IWADs; same GET approach
    for (const n of iwadNames) {
      const p = "iwads/" + n;
      const ex = await exists(p);
      if (ex === true) return p;
    }
    return null;
  }

  function buildLaunchURL(port, iwadPath) {
    if (!iwadPath || !port.supportsQuery) return port.path;
    const full = `${port.path}?iwad=${encodeURIComponent(
      iwadPath.startsWith("/") ? iwadPath : "/modules/doom/engine/" + iwadPath
    )}`;
    return full;
  }

  function render(ports, iwadPath) {
    // Count only those we’re reasonably confident exist (ex===true). Unknown (null) still get cards.
    const confident = ports.filter(p => p.present).length;
    engCount.textContent = String(confident);

    engineList.innerHTML = "";

    // Quick Launch preference
    const prefOrder = ["minishim", "crispy", "prboom", "gzdoom", "choco", "jsdos"];
    const best = ports
      .filter(p => p.present)
      .sort((a, b) => prefOrder.indexOf(a.id) - prefOrder.indexOf(b.id))[0];

    if (best) {
      const quickUrl = buildLaunchURL(best, iwadPath);
      const quick = document.createElement("div");
      quick.className = "engine";
      quick.innerHTML = `
        <h4>Quick Launch</h4>
        <div class="path"><code>${best.name}</code>${iwadPath ? ` · <code>${iwadPath.split("/").pop()}</code>` : ""}</div>
        <div class="bar">
          <button class="btn" data-quick="${quickUrl}">Start</button>
        </div>`;
      engineList.appendChild(quick);
    }

    // Always render every candidate with a Launch button
    for (const e of ports) {
      const url = buildLaunchURL(e, iwadPath);
      const card = document.createElement("div");
      card.className = "engine";
      card.innerHTML = `
        <h4>${e.name}${e.present ? "" : " (untested)"}</h4>
        <div class="path"><code>${e.path}</code>${iwadPath ? ` · IWAD: <code>${iwadPath.split("/").pop()}</code>` : ""}</div>
        <div class="bar">
          <button class="btn" data-launch="${url}">Launch</button>
          <button class="btn ghost" data-open="${url}">Open in tab</button>
        </div>`;
      engineList.appendChild(card);
    }

    engineList.addEventListener("click", (ev) => {
      const quick = ev.target.closest("[data-quick]");
      const launch = ev.target.closest("[data-launch]");
      const open = ev.target.closest("[data-open]");
      if (quick) {
        runnerFrame.src = quick.getAttribute("data-quick");
      } else if (launch) {
        runnerFrame.src = launch.getAttribute("data-launch");
      } else if (open) {
        window.open(open.getAttribute("data-open"), "_blank", "noopener,noreferrer");
      }
    }, { once: true });
  }

  btnHelp.addEventListener("click", () => {
    alert([
      "Ports live in /ports/<name>/index.html.",
      "If detection shows 0, you can still try Launch — some environments block probing.",
      "IWADs go in /iwads/ (doom.wad, doom2.wad, freedoom1/2.wad).",
      "If a port ignores ?iwad=, use its in-page WAD picker."
    ].join("\n"));
  });

  btnFullscreen.addEventListener("click", () => {
    const host = document.querySelector(".runner");
    if (!document.fullscreenElement && host?.requestFullscreen) host.requestFullscreen();
  });

  (async () => {
    const [ports, iwad] = await Promise.all([detectPorts(), detectIWAD()]);
    render(ports, iwad);
    if (iwad) {
      iwadHint.textContent = iwad.split("/").pop() + " found";
      iwadHint.style.color = "var(--ok)";
    } else {
      iwadHint.textContent = "IWAD not detected (use engine’s file picker)";
      iwadHint.style.color = "var(--warn)";
    }
  })();
})();
