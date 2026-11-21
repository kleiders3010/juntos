// Every key Juntos keeps starts with "juntos." (audit R11: the GitHub Pages copy shares its storage with our other
// apps). What an older version kept under a bare name moves over once, before anything reads it (app.js imports this
// first); "name" is only copied, since another app on the same site may use it.
try {
  for (const k of ["name", "micId", "camId", "sinkId", "chatEmoji", "bg"]) {
    const old = localStorage.getItem(k);
    if (old == null || localStorage.getItem("juntos." + k) != null) continue;
    localStorage.setItem("juntos." + k, old);
    if (k !== "name") localStorage.removeItem(k);
  }
} catch {}
